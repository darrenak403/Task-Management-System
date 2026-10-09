'use client';

import { createContext, useContext, useEffect, useState } from 'react';

import { api } from '@/lib/api-client';
import { isUnauthenticated } from '@/lib/api-errors';

import { effectOf, parseReadyMode, parseRealtimeEvent, REALTIME_EVENT_TYPES } from './event-types';
import { invalidationBus, topics } from './invalidation-bus';

/**
 * - `idle`: no workspace is open, so there is nothing to listen to.
 * - `connecting`: first connection of this scope.
 * - `ready`: live; screens are up to date.
 * - `reconnecting`: the stream dropped; what is on screen may be stale.
 * - `resync`: reconnected and catching up on missed events.
 */
export type RealtimeStatus = 'idle' | 'connecting' | 'ready' | 'reconnecting' | 'resync';

const RealtimeContext = createContext<RealtimeStatus>('idle');

const MAX_RETRY_DELAY_MS = 30_000;

/**
 * Holds the tab's single event stream, scoped to the open workspace.
 * Events never carry data to render: each one tells the invalidation bus which screens must refetch.
 * Nothing here runs on an interval; timers are one-shot reconnect delays.
 */
export function RealtimeProvider({
  userId,
  workspaceId,
  children,
}: {
  userId: string;
  /** The workspace to listen to, once the caller is confirmed to have access to it. */
  workspaceId: string | undefined;
  children: React.ReactNode;
}) {
  const [status, setStatus] = useState<RealtimeStatus>('idle');

  useEffect(() => {
    if (!workspaceId) return;

    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let disposed = false;
    let wasReady = false;
    // Kept in memory only: the id to resume from when this code, not the browser, reopens the stream.
    let cursor: string | undefined;
    // Set when events may have been missed for good; the next fresh connection reloads every screen once.
    let snapshotNeeded = false;

    const close = () => {
      source?.close();
      source = null;
    };

    const reopen = (delayMs: number) => {
      close();
      if (disposed) return;
      setStatus('reconnecting');
      clearTimeout(retryTimer);
      retryTimer = setTimeout(open, delayMs);
    };

    const backoff = () => {
      const delay = Math.min(MAX_RETRY_DELAY_MS, 1_000 * 2 ** attempt);
      attempt += 1;
      return delay;
    };

    // The stream only says the session ended; a plain request gets the 401 that signs the whole shell out.
    // Any other answer means the session may still be good, so the stream is opened again.
    const endSession = () => {
      close();
      api('/auth/me').then(
        () => reopen(backoff()),
        (error: unknown) => (isUnauthenticated(error) ? undefined : reopen(backoff())),
      );
    };

    function open() {
      if (disposed) return;
      const params = new URLSearchParams({ workspaceId: workspaceId as string });
      if (cursor) params.set('cursor', cursor);
      const stream = new EventSource(`/api/realtime/events?${params.toString()}`, { withCredentials: true });
      source = stream;
      if (!wasReady) setStatus('connecting');

      stream.addEventListener('ready', (message) => {
        const mode = parseReadyMode(message.data);
        if (message.lastEventId) cursor = message.lastEventId;
        if (mode === 'resume') {
          setStatus('resync');
          return;
        }
        attempt = 0;
        wasReady = true;
        if (mode === 'initial' && snapshotNeeded) invalidationBus.publishAll();
        snapshotNeeded = false;
        setStatus('ready');
      });

      for (const type of REALTIME_EVENT_TYPES) {
        stream.addEventListener(type, (message) => {
          if (message.lastEventId) cursor = message.lastEventId;
          const event = parseRealtimeEvent(message.data);
          if (!event) {
            // An event this client cannot read may hide a change: reload instead of guessing.
            invalidationBus.publishAll();
            return;
          }
          const effect = effectOf(event);
          if (effect.kind === 'invalidate') effect.topics.forEach((topic) => invalidationBus.publish(topic));
          else if (effect.kind === 'reload-all') invalidationBus.publishAll();
          else endSession();
        });
      }

      // The server could not replay from the cursor: start over without one and reload every screen once.
      stream.addEventListener('resync_required', () => {
        cursor = undefined;
        snapshotNeeded = true;
        reopen(0);
      });

      stream.addEventListener('auth.expired', endSession);

      for (const type of ['server.unavailable', 'server.draining']) {
        stream.addEventListener(type, () => reopen(backoff()));
      }

      stream.onerror = () => {
        if (disposed || source !== stream) return;
        if (stream.readyState === EventSource.CLOSED) {
          // The handshake was refused (HTTP error), which the browser does not retry.
          if (attempt === 0) invalidationBus.publish(topics.structure);
          reopen(backoff());
        } else {
          // The browser is reconnecting by itself and will resume from the last event id.
          setStatus('reconnecting');
        }
      };
    }

    open();

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      close();
      setStatus('idle');
    };
  }, [userId, workspaceId]);

  return <RealtimeContext.Provider value={workspaceId ? status : 'idle'}>{children}</RealtimeContext.Provider>;
}

export function useRealtimeStatus(): RealtimeStatus {
  return useContext(RealtimeContext);
}
