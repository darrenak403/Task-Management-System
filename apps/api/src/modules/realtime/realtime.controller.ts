import type { RequestHandler } from 'express';
import type { Logger } from 'pino';
import { z } from 'zod';
import { HttpError } from '../../shared/http/error-handler.js';
import { readSessionCookie } from '../../shared/http/cookie.js';
import type { RealtimeScopeAuthorization, RealtimeService } from './realtime.service.js';
import { SseStream } from './sse-stream.js';
import type { RealtimeScope } from './connection-registry.js';
import { isRealtimeEventType } from './event-catalog.js';

const HANDSHAKE_TIMEOUT_MS = 5_000;

const querySchema = z.object({
  workspaceId: z.uuid(),
  teamId: z.uuid().optional(),
  cursor: z.uuid().optional(),
}).strict();

function assertSameOrigin(request: Parameters<RequestHandler>[0], appOrigin: string): void {
  const origin = request.get('origin');
  const fetchSite = request.get('sec-fetch-site');
  if (origin === 'null' || (origin !== undefined && origin !== appOrigin) || fetchSite === 'cross-site') {
    throw new HttpError(403, 'ORIGIN_NOT_ALLOWED', 'The request origin is not allowed.');
  }
}

export function createRealtimeController(service: RealtimeService, appOrigin: string, logger: Logger): RequestHandler {
  return async (request, response, next) => {
    let handshakeTimedOut = false;
    let stream: SseStream | undefined;
    const handshakeTimer = setTimeout(() => {
      handshakeTimedOut = true;
      if (stream) {
        void stream.control('server.unavailable', undefined, { reason: 'handshake_timeout' });
        stream.end();
      } else if (!response.headersSent) {
        response.status(503).json({
          error: {
            code: 'REALTIME_HANDSHAKE_TIMEOUT',
            message: 'Realtime authentication did not complete in time.',
            requestId: request.requestId,
          },
        });
      }
    }, HANDSHAKE_TIMEOUT_MS);
    try {
      assertSameOrigin(request, new URL(appOrigin).origin);
      const parsedQuery = querySchema.safeParse(request.query);
      if (!parsedQuery.success) throw new HttpError(400, 'VALIDATION_ERROR', 'The realtime scope is invalid.');
      const { workspaceId, teamId, cursor: queryCursor } = parsedQuery.data;
      const scope: RealtimeScope = { workspaceId, ...(teamId ? { teamId } : {}) };

      const token = readSessionCookie(request);
      if (!token) throw new HttpError(401, 'UNAUTHENTICATED', 'Authentication is required.');
      const session = await service.authenticate(token);
      if (handshakeTimedOut) return;
      if (!session) throw new HttpError(401, 'UNAUTHENTICATED', 'Authentication is required.');
      const authorization = await service.authorizeScope(session.user.id, scope);
      if (handshakeTimedOut) return;
      if (!service.connections.isAvailable()) throw service.unavailableError();

      const identity = service.toIdentity(session);
      if (!service.connections.canRegister(identity)) {
        throw new HttpError(429, 'REALTIME_CONNECTION_LIMIT', 'The realtime connection limit has been reached.');
      }

      const cleanup = { unregister: undefined as (() => void) | undefined };
      stream = new SseStream(response, () => {
        cleanup.unregister?.();
        clearTimeout(handshakeTimer);
      });
      const unregister = service.connections.register(identity, scope, stream, (event) => service.canReceive(identity, scope, event));
      cleanup.unregister = unregister ?? undefined;
      if (!unregister) {
        clearTimeout(handshakeTimer);
        await stream.control('server.unavailable', undefined, { reason: 'connection_limit' });
        stream.end();
        return;
      }
      stream.startExpiry(session.expiresAt);

      const registeredSession = await service.authenticate(token);
      if (stream.isClosed || stream.isTerminal) return;
      if (!registeredSession || registeredSession.sessionId !== session.sessionId || registeredSession.sessionHash !== session.sessionHash) {
        clearTimeout(handshakeTimer);
        await stream.control('auth.expired', undefined, { reason: 'session_revoked' });
        stream.end();
        return;
      }
      let registeredAuthorization: RealtimeScopeAuthorization;
      try {
        registeredAuthorization = await service.authorizeScope(registeredSession.user.id, scope);
      } catch (error) {
        if (stream.isClosed || stream.isTerminal) return;
        if (error instanceof HttpError && error.statusCode === 404) {
          clearTimeout(handshakeTimer);
          await stream.control('resync_required', undefined, { reason: 'scope_changed' });
          stream.end();
          return;
        }
        throw error;
      }
      if (stream.isClosed || stream.isTerminal) return;
      if (registeredAuthorization.workspaceRole !== authorization.workspaceRole || registeredAuthorization.teamMember !== authorization.teamMember) {
        clearTimeout(handshakeTimer);
        await stream.control('resync_required', undefined, { reason: 'authorization_changed' });
        stream.end();
        return;
      }

      const headerCursor = request.get('last-event-id');
      const cursor = headerCursor !== undefined ? headerCursor : queryCursor;
      if (cursor === undefined) {
        const clock = await service.repository.getClock();
        if (stream.isClosed || stream.isTerminal) return;
        stream.prepareBarrier(clock.lastSeq);
        await stream.control('ready', clock.watermarkId, {
          mode: 'initial', checkpointId: clock.watermarkId,
          schemaVersion: 1,
        });
        if (stream.isClosed || stream.isTerminal) return;
        stream.activate();
        clearTimeout(handshakeTimer);
        return;
      }

      const cursorIsUuid = z.uuid().safeParse(cursor).success;
      if (!cursorIsUuid) {
        const clock = await service.repository.getClock();
        if (stream.isClosed || stream.isTerminal) return;
        clearTimeout(handshakeTimer);
        stream.prepareBarrier(clock.lastSeq);
        await stream.control('resync_required', clock.watermarkId, {
          reason: 'invalid_cursor', checkpointId: clock.watermarkId,
        });
        stream.activate();
        stream.end();
        return;
      }

      const snapshot = await service.repository.getReplaySnapshot(cursor);
      const { clock, reason } = snapshot;
      const replay = snapshot.events;
      if (stream.isClosed || stream.isTerminal) return;
      if (!replay) {
        clearTimeout(handshakeTimer);
        stream.prepareBarrier(clock.lastSeq);
        await stream.control('resync_required', clock.watermarkId, {
          reason: reason ?? 'outbox_gap', checkpointId: clock.watermarkId,
        });
        stream.activate();
        stream.end();
        return;
      }

      stream.prepareBarrier(clock.lastSeq);
      await stream.control('ready', undefined, { mode: 'resume', schemaVersion: 1 });
      if (stream.isClosed || stream.isTerminal) return;
      for (const event of replay) {
        if (event.schemaVersion !== 1 || !isRealtimeEventType(event.eventType)) {
          await stream.control('resync_required', clock.watermarkId, { reason: 'unknown_event_type' });
          stream.end();
          return;
        }
        const allowed = await service.canReceive(identity, scope, event);
        if (stream.isClosed || stream.isTerminal) return;
        if (!allowed) continue;
        await stream.sendReplay(event);
        if (stream.isClosed || stream.isTerminal) return;
      }
      await stream.control('ready', clock.watermarkId, { mode: 'resume_complete', checkpointId: clock.watermarkId, schemaVersion: 1 });
      if (stream.isClosed || stream.isTerminal) return;
      stream.activate();
      clearTimeout(handshakeTimer);
    } catch (error) {
      clearTimeout(handshakeTimer);
      if (handshakeTimedOut) return;
      if (response.headersSent) {
        const errorName = error instanceof Error ? error.name : 'UnknownError';
        logger.warn({ requestId: request.requestId, errorName }, 'Realtime stream setup failed after headers were sent');
        response.end();
        return;
      }
      next(error);
    }
  };
}
