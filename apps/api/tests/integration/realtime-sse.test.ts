import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import pino from 'pino';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { RealtimeConnectionRegistry } from '../../src/modules/realtime/connection-registry.js';
import { RealtimeDispatcher } from '../../src/modules/realtime/dispatcher.js';
import { createRealtimeCoreTestApp, createTestWorkspace, registerTestUser, trustedTestOrigin } from '../helpers/core-app.js';
import { createTestDatabase, resetTestDatabase, testDatabaseUrl } from '../helpers/db.js';

const logger = pino({ level: 'silent' });

type OpenStream = { response: Response; reader: ReadableStreamDefaultReader<Uint8Array>; abort: AbortController };

async function readUntil(stream: OpenStream, marker: string, timeoutMs = 3_000): Promise<string> {
  let output = '';
  const decoder = new TextDecoder();
  const deadline = Date.now() + timeoutMs;
  while (!output.includes(marker)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`Timed out waiting for SSE frame ${marker}.`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        stream.reader.read(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(
            `Timed out waiting for SSE frame ${marker}; HTTP ${stream.response.status}; received: ${output.slice(0, 500)}`,
          )), remaining);
        }),
      ]);
      if (result.done) throw new Error('SSE stream ended before the expected frame.');
      output += decoder.decode(result.value, { stream: true });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return output;
}

async function readToEnd(stream: OpenStream, timeoutMs = 3_000): Promise<string> {
  let output = '';
  const decoder = new TextDecoder();
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Timed out waiting for the SSE stream to close.');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        stream.reader.read(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Timed out waiting for the SSE stream to close.')), remaining);
        }),
      ]);
      if (result.done) return output;
      output += decoder.decode(result.value, { stream: true });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

async function waitForAvailable(targetDispatcher: RealtimeDispatcher, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!targetDispatcher.isAvailable()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for the realtime dispatcher to recover.');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('realtime SSE endpoint', () => {
  let prisma: PrismaClient;
  let registry: RealtimeConnectionRegistry;
  let dispatcher: RealtimeDispatcher;
  let app: ReturnType<typeof createRealtimeCoreTestApp>['app'];
  let realtimeService: ReturnType<typeof createRealtimeCoreTestApp>['realtimeService'];
  let server: Server;
  let baseUrl: string;
  const openStreams: OpenStream[] = [];

  beforeAll(async () => {
    if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL or DATABASE_URL is required.');
    prisma = createTestDatabase();
    await prisma.$connect();
  });

  beforeEach(async () => {
    await resetTestDatabase(prisma);
    registry = new RealtimeConnectionRegistry();
    dispatcher = new RealtimeDispatcher(prisma, testDatabaseUrl!, registry, logger);
    await dispatcher.start();
    ({ app, realtimeService } = createRealtimeCoreTestApp(prisma, logger, registry));
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    for (const stream of openStreams.splice(0)) {
      stream.abort.abort();
      await stream.reader.cancel().catch(() => undefined);
    }
    await dispatcher.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await logger.flush();
  });

  async function openStream(
    cookie: string,
    workspaceId: string,
    headers: Record<string, string> = {},
    teamId?: string,
  ): Promise<OpenStream> {
    const abort = new AbortController();
    const query = new URLSearchParams({ workspaceId, ...(teamId ? { teamId } : {}) });
    const response = await fetch(`${baseUrl}/api/realtime/events?${query.toString()}`, {
      headers: { Cookie: cookie, ...headers },
      signal: abort.signal,
    });
    if (!response.body) throw new Error('Expected an SSE response body.');
    const stream = { response, reader: response.body.getReader(), abort };
    openStreams.push(stream);
    return stream;
  }

  async function createTeam(cookie: string, workspaceId: string): Promise<string> {
    const response = await request(app)
      .post(`/api/workspaces/${workspaceId}/teams`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', cookie)
      .send({ name: 'Engineering' });
    expect(response.status).toBe(201);
    return response.body.data.id as string;
  }

  async function createTask(cookie: string, workspaceId: string, teamId: string, title = 'Sensitive task title'): Promise<void> {
    const response = await request(app)
      .post(`/api/workspaces/${workspaceId}/teams/${teamId}/tasks`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', cookie)
      .send({ title });
    expect(response.status).toBe(201);
  }

  it('streams safe committed task invalidations with streaming headers', async () => {
    const owner = await registerTestUser(app, 'sse-owner@example.com');
    const workspace = await createTestWorkspace(app, owner.cookie);
    const teamId = await createTeam(owner.cookie, workspace.id);
    const stream = await openStream(owner.cookie, workspace.id);
    const ready = await readUntil(stream, 'event: ready');

    expect(stream.response.status).toBe(200);
    expect(stream.response.headers.get('content-type')).toContain('text/event-stream');
    expect(stream.response.headers.get('cache-control')).toBe('no-store, no-transform');
    expect(stream.response.headers.get('x-accel-buffering')).toBe('no');
    expect(stream.response.headers.has('content-length')).toBe(false);
    expect(ready).toContain('"mode":"initial"');

    await createTask(owner.cookie, workspace.id, teamId);
    const pushed = await readUntil(stream, 'event: team.tasks_changed');
    expect(pushed).toContain('"operation":"created"');
    expect(pushed).toMatch(/"revision":"\d{4}-\d{2}-\d{2}T[^"]+Z"/);
    expect(pushed).not.toContain('Sensitive task title');
  });

  it('replays from an opaque Last-Event-ID and resyncs an unknown cursor', async () => {
    const owner = await registerTestUser(app, 'sse-replay@example.com');
    const workspace = await createTestWorkspace(app, owner.cookie);
    const teamId = await createTeam(owner.cookie, workspace.id);
    await createTask(owner.cookie, workspace.id, teamId, 'Replay title');

    const events = await prisma.realtimeEvent.findMany({ orderBy: { seq: 'asc' } });
    const teamCreated = events.find((event) => event.eventType === 'workspace.structure_changed' && event.teamId === null);
    expect(teamCreated).toBeDefined();
    const replay = await openStream(owner.cookie, workspace.id, { 'Last-Event-ID': teamCreated!.id });
    const replayed = await readUntil(replay, 'event: team.tasks_changed');
    expect(replayed).toContain('"mode":"resume"');
    expect(replayed).toContain('"operation":"created"');
    expect(replayed).not.toContain('Replay title');

    const unknown = await openStream(owner.cookie, workspace.id, { 'Last-Event-ID': randomUUID() });
    const resync = await readUntil(unknown, 'event: resync_required');
    expect(resync).toContain('"reason":"cursor_expired"');
  });

  it('requires a fresh snapshot after the cursor has been removed by retention', async () => {
    const owner = await registerTestUser(app, 'sse-retention@example.com');
    const workspace = await createTestWorkspace(app, owner.cookie);
    const teamId = await createTeam(owner.cookie, workspace.id);
    await createTask(owner.cookie, workspace.id, teamId);
    const event = await prisma.realtimeEvent.findFirstOrThrow({
      where: { eventType: 'team.tasks_changed' },
      orderBy: { seq: 'asc' },
    });
    await createTask(owner.cookie, workspace.id, teamId, 'Newer event beyond retained cursor');

    await prisma.realtimeEvent.updateMany({
      where: { seq: { lte: event.seq } },
      data: { recordedAt: new Date(Date.now() - 25 * 60 * 60 * 1_000) },
    });
    expect(await realtimeService.repository.cleanExpiredPrefix(100)).toBeGreaterThan(0);
    expect(await prisma.realtimeEvent.findUnique({ where: { id: event.id } })).toBeNull();
    const clock = await prisma.realtimeClock.findUniqueOrThrow({ where: { id: 1 } });
    expect(clock.lastSeq).toBeGreaterThan(clock.purgedThrough);

    const stream = await openStream(owner.cookie, workspace.id, { 'Last-Event-ID': event.id });
    const resync = await readUntil(stream, 'event: resync_required');
    expect(resync).toContain('"reason":"cursor_expired"');
    expect(await readToEnd(stream)).toBe('');
  });

  it('replays the missed commit after listener loss and signals the open stream to resync', async () => {
    const owner = await registerTestUser(app, 'sse-recovery@example.com');
    const workspace = await createTestWorkspace(app, owner.cookie);
    const teamId = await createTeam(owner.cookie, workspace.id);
    const stream = await openStream(owner.cookie, workspace.id);
    const initial = await readUntil(stream, 'event: ready');
    const checkpoint = /^id: ([0-9a-f-]{36})$/m.exec(initial)?.[1];
    expect(checkpoint).toBeDefined();

    const terminated = await prisma.$queryRaw<Array<{ terminated: boolean }>>`
      SELECT pg_terminate_backend(pid) AS terminated
      FROM pg_stat_activity
      WHERE application_name = 'task-management-realtime-listener' AND pid <> pg_backend_pid()
    `;
    expect(terminated).toHaveLength(1);
    expect(terminated[0]?.terminated).toBe(true);

    const outage = await readUntil(stream, 'event: server.unavailable', 5_000);
    expect(outage).toContain('reconnect and resync');
    expect(await readToEnd(stream)).toBe('');

    await createTask(owner.cookie, workspace.id, teamId, 'Committed while listener was down');
    await waitForAvailable(dispatcher);
    const resumed = await openStream(owner.cookie, workspace.id, { 'Last-Event-ID': checkpoint! });
    const replay = await readUntil(resumed, 'event: team.tasks_changed', 5_000);
    expect(replay).toContain('"mode":"resume"');
    expect(replay).toContain('"operation":"created"');
    expect(replay).not.toContain('Committed while listener was down');
  });

  it('delivers a targeted access change and closes the stream when team membership is revoked', async () => {
    const owner = await registerTestUser(app, 'sse-revoke-owner@example.com');
    const member = await registerTestUser(app, 'sse-revoke-member@example.com');
    const workspace = await createTestWorkspace(app, owner.cookie);
    const addWorkspaceMember = await request(app)
      .post(`/api/workspaces/${workspace.id}/members`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', owner.cookie)
      .send({ email: 'sse-revoke-member@example.com' });
    expect(addWorkspaceMember.status).toBe(201);
    const teamId = await createTeam(owner.cookie, workspace.id);
    const addTeamMember = await request(app)
      .post(`/api/workspaces/${workspace.id}/teams/${teamId}/members`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', owner.cookie)
      .send({ userId: member.id });
    expect(addTeamMember.status).toBe(201);

    const stream = await openStream(member.cookie, workspace.id, {}, teamId);
    await readUntil(stream, 'event: ready');
    const remove = await request(app)
      .delete(`/api/workspaces/${workspace.id}/teams/${teamId}/members/${member.id}`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', owner.cookie);
    expect(remove.status).toBe(204);

    const revoked = await readUntil(stream, 'event: access.changed');
    expect(revoked).toContain('"reason":"team_membership"');
    const trailing = await readToEnd(stream);
    expect(`${revoked}${trailing}`).not.toContain('event: team.tasks_changed');
  });

  it('broadcasts roster invalidation to remaining team members when a member is removed', async () => {
    const owner = await registerTestUser(app, 'sse-roster-owner@example.com');
    const remaining = await registerTestUser(app, 'sse-roster-remaining@example.com');
    const removed = await registerTestUser(app, 'sse-roster-removed@example.com');
    const workspace = await createTestWorkspace(app, owner.cookie);
    for (const member of [remaining, removed]) {
      const response = await request(app)
        .post(`/api/workspaces/${workspace.id}/members`)
        .set('Origin', trustedTestOrigin)
        .set('Cookie', owner.cookie)
        .send({ email: member.id === remaining.id ? 'sse-roster-remaining@example.com' : 'sse-roster-removed@example.com' });
      expect(response.status).toBe(201);
    }
    const teamId = await createTeam(owner.cookie, workspace.id);
    for (const member of [remaining, removed]) {
      const response = await request(app)
        .post(`/api/workspaces/${workspace.id}/teams/${teamId}/members`)
        .set('Origin', trustedTestOrigin)
        .set('Cookie', owner.cookie)
        .send({ userId: member.id });
      expect(response.status).toBe(201);
    }

    const stream = await openStream(remaining.cookie, workspace.id, {}, teamId);
    await readUntil(stream, 'event: ready');
    const response = await request(app)
      .delete(`/api/workspaces/${workspace.id}/teams/${teamId}/members/${removed.id}`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', owner.cookie);
    expect(response.status).toBe(204);

    const roster = await readUntil(stream, 'event: team.roster_changed');
    expect(roster).toContain('"operation":"member_removed"');
  });

  it('revokes a logged-out session stream and does not expose its private session hash', async () => {
    const owner = await registerTestUser(app, 'sse-logout@example.com');
    const workspace = await createTestWorkspace(app, owner.cookie);
    const token = owner.cookie.slice('tm_session='.length);
    const session = await realtimeService.authenticate(token);
    expect(session).not.toBeNull();

    const stream = await openStream(owner.cookie, workspace.id);
    await readUntil(stream, 'event: ready');
    const logout = await request(app)
      .post('/api/auth/logout')
      .set('Origin', trustedTestOrigin)
      .set('Cookie', owner.cookie);
    expect(logout.status).toBe(204);

    const revoked = await readUntil(stream, 'event: auth.revoked');
    expect(revoked).toContain('"reason":"logout"');
    expect(revoked).not.toContain(session!.sessionHash);
    expect(await readToEnd(stream)).toBe('');
  });

  it('closes a stream when logout races with connection registration', async () => {
    const owner = await registerTestUser(app, 'sse-registration-race@example.com');
    const workspace = await createTestWorkspace(app, owner.cookie);
    const originalAuthorizeScope = realtimeService.authorizeScope.bind(realtimeService);
    let notifyAuthorization: (() => void) | undefined;
    let releaseAuthorization: (() => void) | undefined;
    const authorizationStarted = new Promise<void>((resolve) => { notifyAuthorization = resolve; });
    const authorizationGate = new Promise<void>((resolve) => { releaseAuthorization = resolve; });
    let notifyRevocationDispatched: (() => void) | undefined;
    const revocationDispatched = new Promise<void>((resolve) => { notifyRevocationDispatched = resolve; });
    const originalPublish = registry.publish.bind(registry);
    registry.publish = async (event) => {
      await originalPublish(event);
      if (event.eventType === 'auth.revoked') notifyRevocationDispatched?.();
    };
    let pauseFirstAuthorization = true;
    realtimeService.authorizeScope = async (userId, scope) => {
      const result = await originalAuthorizeScope(userId, scope);
      if (pauseFirstAuthorization) {
        pauseFirstAuthorization = false;
        notifyAuthorization?.();
        await authorizationGate;
      }
      return result;
    };

    try {
      const abort = new AbortController();
      const query = new URLSearchParams({ workspaceId: workspace.id });
      const responsePromise = fetch(`${baseUrl}/api/realtime/events?${query.toString()}`, {
        headers: { Cookie: owner.cookie },
        signal: abort.signal,
      });
      await authorizationStarted;
      const logout = await request(app)
        .post('/api/auth/logout')
        .set('Origin', trustedTestOrigin)
        .set('Cookie', owner.cookie);
      expect(logout.status).toBe(204);
      await revocationDispatched;
      releaseAuthorization?.();

      const response = await responsePromise;
      if (!response.body) throw new Error('Expected an SSE response body.');
      const stream = { response, reader: response.body.getReader(), abort };
      openStreams.push(stream);
      expect(response.status).toBe(200);
      const expired = await readUntil(stream, 'event: auth.expired');
      expect(expired).toContain('"reason":"session_revoked"');
      expect(await readToEnd(stream)).toBe('');
    } finally {
      releaseAuthorization?.();
      realtimeService.authorizeScope = originalAuthorizeScope;
      registry.publish = originalPublish;
    }
  });

  it('sends a draining control event and ends every stream during dispatcher shutdown', async () => {
    const owner = await registerTestUser(app, 'sse-shutdown@example.com');
    const workspace = await createTestWorkspace(app, owner.cookie);
    const stream = await openStream(owner.cookie, workspace.id);
    await readUntil(stream, 'event: ready');

    await dispatcher.stop();
    const draining = await readUntil(stream, 'event: server.draining');
    expect(draining).toContain('shutting down');
    expect(await readToEnd(stream)).toBe('');
    expect(dispatcher.isAvailable()).toBe(false);
  });

  it('filters team events using current membership and rejects foreign origins', async () => {
    const owner = await registerTestUser(app, 'sse-acl-owner@example.com');
    const member = await registerTestUser(app, 'sse-acl-member@example.com');
    const workspace = await createTestWorkspace(app, owner.cookie);
    const teamId = await createTeam(owner.cookie, workspace.id);
    const addMember = await request(app)
      .post(`/api/workspaces/${workspace.id}/members`)
      .set('Origin', trustedTestOrigin)
      .set('Cookie', owner.cookie)
      .send({ email: 'sse-acl-member@example.com' });
    expect(addMember.status).toBe(201);
    await createTask(owner.cookie, workspace.id, teamId);

    const token = member.cookie.slice('tm_session='.length);
    const session = await realtimeService.authenticate(token);
    expect(session).not.toBeNull();
    const taskEvent = await prisma.realtimeEvent.findFirstOrThrow({ where: { eventType: 'team.tasks_changed' } });
    const allowed = await realtimeService.canReceive(
      realtimeService.toIdentity(session!),
      { workspaceId: workspace.id },
      taskEvent,
    );
    expect(allowed).toBe(false);

    const forbidden = await fetch(`${baseUrl}/api/realtime/events?workspaceId=${workspace.id}`, {
      headers: { Cookie: owner.cookie, Origin: 'https://attacker.example' },
    });
    expect(forbidden.status).toBe(403);
  });
});
