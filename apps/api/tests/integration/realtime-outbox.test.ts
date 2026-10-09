import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { appendRealtimeEvents } from '../../src/modules/realtime/outbox.js';
import { RealtimeRepository } from '../../src/modules/realtime/realtime.repository.js';
import { rotateRealtimeEpoch } from '../../src/modules/realtime/clock.js';
import { createTestDatabase, resetTestDatabase } from '../helpers/db.js';

describe('transactional realtime outbox', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = createTestDatabase();
    await prisma.$connect();
  });

  beforeEach(async () => resetTestDatabase(prisma));
  afterAll(async () => prisma.$disconnect());

  it('rolls back the event and commit-safe clock allocation with the business transaction', async () => {
    const workspaceId = randomUUID();
    await expect(prisma.$transaction(async (tx) => {
      await appendRealtimeEvents(tx, [{
        eventType: 'workspace.structure_changed', workspaceId, resourceId: workspaceId,
        payload: { resourceType: 'workspace', operation: 'updated' },
      }]);
      throw new Error('force rollback');
    })).rejects.toThrow('force rollback');

    const [eventCount, clock] = await Promise.all([
      prisma.realtimeEvent.count(),
      prisma.realtimeClock.findUniqueOrThrow({ where: { id: 1 } }),
    ]);
    expect(eventCount).toBe(0);
    expect(clock.lastSeq).toBe(0n);
    expect(clock.watermarkId).toBe(clock.epochCheckpointId);
  });

  it('does not let a later transaction allocate or publish past an earlier uncommitted cursor', async () => {
    const workspaceId = randomUUID();
    let releaseFirst: (() => void) | undefined;
    let firstHasCursor: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const cursorAllocated = new Promise<void>((resolve) => { firstHasCursor = resolve; });

    const first = prisma.$transaction(async (tx) => {
      await appendRealtimeEvents(tx, [{
        eventType: 'team.tasks_changed', workspaceId, teamId: randomUUID(),
        payload: { operation: 'created' },
      }]);
      firstHasCursor?.();
      await firstGate;
    });
    await cursorAllocated;

    let secondCommitted = false;
    const second = prisma.$transaction(async (tx) => {
      await appendRealtimeEvents(tx, [{
        eventType: 'team.tasks_changed', workspaceId, teamId: randomUUID(),
        payload: { operation: 'updated' },
      }]);
      secondCommitted = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(secondCommitted).toBe(false);
    releaseFirst?.();
    await Promise.all([first, second]);

    const events = await prisma.realtimeEvent.findMany({ orderBy: { seq: 'asc' } });
    expect(events.map(({ seq }) => seq)).toEqual([1n, 2n]);
    expect(events.map(({ payload }) => payload)).toEqual([
      { operation: 'created' },
      { operation: 'updated' },
    ]);
  });

  it('requires a resync when the committed replay range contains a sequence gap', async () => {
    const workspaceId = randomUUID();
    await prisma.$transaction((tx) => appendRealtimeEvents(tx, [
      { eventType: 'workspace.structure_changed', workspaceId, resourceId: workspaceId, payload: { resourceType: 'workspace', operation: 'updated' } },
      { eventType: 'workspace.structure_changed', workspaceId, resourceId: workspaceId, payload: { resourceType: 'workspace', operation: 'updated' } },
    ]));
    const [first, second] = await prisma.realtimeEvent.findMany({ orderBy: { seq: 'asc' } });
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    await prisma.realtimeEvent.delete({ where: { id: second!.id } });

    const snapshot = await new RealtimeRepository(prisma).getReplaySnapshot(first!.id);
    expect(snapshot.events).toBeNull();
    expect(snapshot.reason).toBe('outbox_gap');
  });

  it('purges only an expired committed prefix and retains the current watermark checkpoint', async () => {
    const workspaceId = randomUUID();
    await prisma.$transaction((tx) => appendRealtimeEvents(tx, [{
      eventType: 'workspace.structure_changed', workspaceId, resourceId: workspaceId,
      payload: { resourceType: 'workspace', operation: 'updated' },
    }]));
    const current = await prisma.realtimeEvent.findFirstOrThrow();
    const watermarkId = (await prisma.realtimeClock.findUniqueOrThrow({ where: { id: 1 } })).watermarkId;
    await prisma.realtimeEvent.update({ where: { id: current.id }, data: { recordedAt: new Date(Date.now() - 25 * 60 * 60 * 1_000) } });

    const deleted = await new RealtimeRepository(prisma).cleanExpiredPrefix(10);
    const [remaining, clock] = await Promise.all([
      prisma.realtimeEvent.count(),
      prisma.realtimeClock.findUniqueOrThrow({ where: { id: 1 } }),
    ]);
    expect(deleted).toBe(1);
    expect(remaining).toBe(0);
    expect(clock.purgedThrough).toBe(1n);
    expect(clock.watermarkId).toBe(watermarkId);
  });

  it('does not purge a fresh event just because a later sequence has an older timestamp', async () => {
    const workspaceId = randomUUID();
    await prisma.$transaction((tx) => appendRealtimeEvents(tx, [
      { eventType: 'workspace.structure_changed', workspaceId, resourceId: workspaceId, payload: { resourceType: 'workspace', operation: 'updated' } },
      { eventType: 'workspace.structure_changed', workspaceId, resourceId: workspaceId, payload: { resourceType: 'workspace', operation: 'updated' } },
      { eventType: 'workspace.structure_changed', workspaceId, resourceId: workspaceId, payload: { resourceType: 'workspace', operation: 'updated' } },
    ]));
    const events = await prisma.realtimeEvent.findMany({ orderBy: { seq: 'asc' } });
    const cutoff = Date.now() - 25 * 60 * 60 * 1_000;
    await prisma.realtimeEvent.update({ where: { id: events[0]!.id }, data: { recordedAt: new Date(cutoff - 1_000) } });
    await prisma.realtimeEvent.update({ where: { id: events[1]!.id }, data: { recordedAt: new Date() } });
    await prisma.realtimeEvent.update({ where: { id: events[2]!.id }, data: { recordedAt: new Date(cutoff - 1_000) } });

    const deleted = await new RealtimeRepository(prisma).cleanExpiredPrefix(10);
    const [remaining, clock] = await Promise.all([
      prisma.realtimeEvent.findMany({ orderBy: { seq: 'asc' } }),
      prisma.realtimeClock.findUniqueOrThrow({ where: { id: 1 } }),
    ]);
    expect(deleted).toBe(1);
    expect(remaining.map(({ seq }) => seq)).toEqual([2n, 3n]);
    expect(clock.purgedThrough).toBe(1n);
  });

  it('rotates the restore epoch, clears old event cursors, and resets the checkpoint', async () => {
    const workspaceId = randomUUID();
    await prisma.$transaction((tx) => appendRealtimeEvents(tx, [{
      eventType: 'workspace.structure_changed', workspaceId, resourceId: workspaceId,
      payload: { resourceType: 'workspace', operation: 'updated' },
    }]));
    const previous = await prisma.realtimeClock.findUniqueOrThrow({ where: { id: 1 } });
    const result = await rotateRealtimeEpoch(prisma);
    const current = await prisma.realtimeClock.findUniqueOrThrow({ where: { id: 1 } });

    expect(result.previousEpoch).toBe(previous.epoch);
    expect(result.epoch).not.toBe(previous.epoch);
    expect(result.eventsCleared).toBe(1);
    expect(current.lastSeq).toBe(0n);
    expect(current.purgedThrough).toBe(0n);
    expect(current.watermarkId).toBe(current.epochCheckpointId);
    expect(await prisma.realtimeEvent.count()).toBe(0);
  });
});
