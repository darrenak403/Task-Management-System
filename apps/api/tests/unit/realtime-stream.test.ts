import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { RealtimeEvent } from '../../src/generated/prisma/client.js';
import { RealtimeConnectionRegistry, type RealtimeIdentity } from '../../src/modules/realtime/connection-registry.js';
import { SseStream } from '../../src/modules/realtime/sse-stream.js';

class FakeResponse extends EventEmitter {
  readonly frames: string[] = [];
  blocked = false;
  ended = false;
  destroyed = false;
  statusCode = 0;
  headers = new Map<string, string>();

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  setHeader(name: string, value: string): this {
    this.headers.set(name.toLowerCase(), value);
    return this;
  }

  flushHeaders(): void {}

  write(chunk: string): boolean {
    this.frames.push(chunk);
    return !this.blocked;
  }

  end(): this {
    this.ended = true;
    this.emit('finish');
    return this;
  }

  destroy(): this {
    this.destroyed = true;
    this.emit('close');
    return this;
  }
}

function fakeEvent(seq: bigint): RealtimeEvent {
  return {
    id: randomUUID(),
    epoch: randomUUID(),
    seq,
    eventType: 'team.tasks_changed',
    schemaVersion: 1,
    workspaceId: randomUUID(),
    teamId: randomUUID(),
    targetUserId: null,
    targetSessionHash: null,
    resourceId: randomUUID(),
    payload: { operation: 'updated' },
    recordedAt: new Date(),
  };
}

const sink = { offer: () => undefined, control: () => undefined, end: () => undefined };

describe('realtime connection bounds', () => {
  it('limits each session to five connections and the API to one hundred', () => {
    const registry = new RealtimeConnectionRegistry();
    registry.setAvailable(true);
    const cleanups: Array<() => void> = [];
    for (let session = 0; session < 20; session += 1) {
      for (let connection = 0; connection < 5; connection += 1) {
        const identity: RealtimeIdentity = {
          sessionId: `session-${session}`,
          sessionHash: `${session.toString(16).padStart(64, '0')}`,
          userId: `user-${session}`,
          expiresAt: new Date(Date.now() + 60_000),
        };
        const unregister = registry.register(identity, { workspaceId: randomUUID() }, sink, async () => true);
        expect(unregister).toBeTypeOf('function');
        cleanups.push(unregister!);
      }
    }
    expect(registry.size).toBe(100);
    const overLimit = registry.register({
      sessionId: 'extra', sessionHash: 'e'.repeat(64), userId: 'extra', expiresAt: new Date(Date.now() + 60_000),
    }, { workspaceId: randomUUID() }, sink, async () => true);
    expect(overLimit).toBeNull();

    for (const unregister of cleanups) unregister();
    const identity: RealtimeIdentity = {
      sessionId: 'single', sessionHash: 'f'.repeat(64), userId: 'single', expiresAt: new Date(Date.now() + 60_000),
    };
    const sessionCleanups = Array.from({ length: 5 }, () => registry.register(identity, { workspaceId: randomUUID() }, sink, async () => true));
    expect(sessionCleanups.every(Boolean)).toBe(true);
    expect(registry.register(identity, { workspaceId: randomUUID() }, sink, async () => true)).toBeNull();
  });

  it('bounds slow-client queues and closes with a resync checkpoint', async () => {
    const response = new FakeResponse();
    const stream = new SseStream(response as unknown as Response, () => undefined);
    stream.prepareBarrier(0n);
    stream.activate();
    response.blocked = true;
    for (let seq = 1n; seq <= 66n; seq += 1n) await stream.offer(fakeEvent(seq));

    expect(stream.isTerminal).toBe(true);
    response.blocked = false;
    response.emit('drain');
    expect(response.ended).toBe(true);
    expect(response.frames.some((frame) => frame.includes('event: resync_required'))).toBe(true);
    expect(response.frames.filter((frame) => frame.includes('event: team.tasks_changed')).length).toBe(1);
  });

  it('drops queued private events before sending an access revocation control event', async () => {
    const response = new FakeResponse();
    response.blocked = true;
    const stream = new SseStream(response as unknown as Response, () => undefined);
    stream.prepareBarrier(0n);
    stream.activate();

    await stream.offer(fakeEvent(1n));
    await stream.offer({
      ...fakeEvent(2n),
      eventType: 'access.changed',
      targetUserId: randomUUID(),
      payload: { reason: 'team_membership' },
    });

    response.blocked = false;
    response.emit('drain');
    const frames = response.frames.join('');
    expect(stream.isTerminal).toBe(true);
    expect(response.ended).toBe(true);
    expect(frames).toContain('event: access.changed');
    expect(frames).not.toContain('event: team.tasks_changed');
  });

  it('delivers revocation controls even when their event sequence is behind the bootstrap barrier', async () => {
    const response = new FakeResponse();
    const stream = new SseStream(response as unknown as Response, () => undefined);
    stream.prepareBarrier(10n);
    stream.activate();

    await stream.offer({
      ...fakeEvent(5n),
      eventType: 'auth.revoked',
      targetSessionHash: 'a'.repeat(64),
      payload: { reason: 'logout' },
    });

    expect(stream.isTerminal).toBe(true);
    expect(response.ended).toBe(true);
    expect(response.frames.join('')).toContain('event: auth.revoked');
  });

  it('destroys a blocked stream after the terminal drain deadline', async () => {
    vi.useFakeTimers();
    try {
      const response = new FakeResponse();
      response.blocked = true;
      const stream = new SseStream(response as unknown as Response, () => undefined);
      stream.prepareBarrier(0n);
      stream.activate();

      await stream.control('server.unavailable', undefined, { reason: 'listener_lost' });
      stream.end();
      await vi.advanceTimersByTimeAsync(2_000);

      expect(response.destroyed).toBe(true);
      expect(stream.isClosed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
