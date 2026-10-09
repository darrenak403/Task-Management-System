import type { PrismaClient, RealtimeEvent } from '../../generated/prisma/client.js';

export type RealtimeClockSnapshot = {
  epoch: string;
  lastSeq: bigint;
  watermarkId: string;
  epochCheckpointId: string;
  purgedThrough: bigint;
};

export type RealtimeReplaySnapshot = {
  clock: RealtimeClockSnapshot;
  events: RealtimeEvent[] | null;
  reason: 'cursor_expired' | 'replay_limit' | 'outbox_gap' | null;
};

export const MAX_REPLAY_EVENTS = 1_000;

export class RealtimeRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getClock(): Promise<RealtimeClockSnapshot> {
    const clock = await this.prisma.realtimeClock.findUnique({ where: { id: 1 } });
    if (!clock) throw new Error('Realtime clock singleton is missing.');
    return clock;
  }

  getReplaySnapshot(cursorId: string): Promise<RealtimeReplaySnapshot> {
    return this.prisma.$transaction(async (tx) => {
      const clock = await tx.realtimeClock.findUnique({ where: { id: 1 } });
      if (!clock) throw new Error('Realtime clock singleton is missing.');

      let cursorSeq: bigint | undefined;
      if (cursorId === clock.watermarkId) {
        cursorSeq = clock.lastSeq;
      } else if (cursorId === clock.epochCheckpointId) {
        cursorSeq = 0n;
      } else {
        const cursor = await tx.realtimeEvent.findFirst({
          where: { id: cursorId, epoch: clock.epoch },
          select: { seq: true },
        });
        cursorSeq = cursor?.seq;
      }

      if (cursorSeq === undefined || cursorSeq < clock.purgedThrough) {
        return { clock, events: null, reason: 'cursor_expired' };
      }

      const events = await tx.realtimeEvent.findMany({
        where: { epoch: clock.epoch, seq: { gt: cursorSeq, lte: clock.lastSeq } },
        orderBy: { seq: 'asc' },
        take: MAX_REPLAY_EVENTS + 1,
      });
      if (events.length > MAX_REPLAY_EVENTS) {
        return { clock, events: null, reason: 'replay_limit' };
      }

      let expectedSeq = cursorSeq + 1n;
      for (const event of events) {
        if (event.seq !== expectedSeq) {
          return { clock, events: null, reason: 'outbox_gap' };
        }
        expectedSeq += 1n;
      }
      if (expectedSeq <= clock.lastSeq) {
        return { clock, events: null, reason: 'outbox_gap' };
      }

      return { clock, events, reason: null };
    }, { isolationLevel: 'RepeatableRead' });
  }

  findAfter(epoch: string, afterSeq: bigint, throughSeq: bigint, take = 256): Promise<RealtimeEvent[]> {
    return this.prisma.realtimeEvent.findMany({
      where: { epoch, seq: { gt: afterSeq, lte: throughSeq } },
      orderBy: { seq: 'asc' },
      take,
    });
  }

  async cleanExpiredPrefix(batchSize = 5_000, now = new Date()): Promise<number> {
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 10_000) {
      throw new RangeError('Realtime retention batch size must be between 1 and 10000.');
    }
    return this.prisma.$transaction(async (tx) => {
      const [clock] = await tx.$queryRaw<Array<{ epoch: string; purged_through: bigint }>>`
        SELECT epoch, purged_through FROM realtime_clock WHERE id = 1 FOR UPDATE
      `;
      if (!clock) throw new Error('Realtime clock singleton is missing.');
      const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1_000);
      const oldEpochDeleted = await tx.$executeRaw`
        WITH expired AS (
          SELECT id FROM realtime_events
          WHERE epoch <> ${clock.epoch}::uuid AND recorded_at < ${cutoff}
          ORDER BY recorded_at ASC, id ASC
          LIMIT ${batchSize}
        )
        DELETE FROM realtime_events AS event USING expired WHERE event.id = expired.id
      `;
      const [prefix] = await tx.$queryRaw<Array<{ max_seq: bigint | null }>>`
        WITH bounded AS (
          SELECT seq, recorded_at,
            bool_or(recorded_at >= ${cutoff}) OVER (
              ORDER BY seq ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            ) AS fresh_seen
          FROM (
            SELECT seq, recorded_at FROM realtime_events
            WHERE epoch = ${clock.epoch}::uuid
            ORDER BY seq ASC
            LIMIT ${batchSize}
          ) AS candidates
        )
        SELECT max(seq) AS max_seq FROM bounded
        WHERE NOT fresh_seen AND recorded_at < ${cutoff}
      `;
      if (prefix?.max_seq === null || prefix?.max_seq === undefined) return oldEpochDeleted;
      const deleted = await tx.$executeRaw`
        DELETE FROM realtime_events WHERE epoch = ${clock.epoch}::uuid AND seq <= ${prefix.max_seq}
      `;
      await tx.realtimeClock.update({
        where: { id: 1 },
        data: { purgedThrough: prefix.max_seq > clock.purged_through ? prefix.max_seq : clock.purged_through },
      });
      return oldEpochDeleted + deleted;
    });
  }
}
