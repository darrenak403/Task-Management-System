import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../../generated/prisma/client.js';

export type RealtimeEpochRotation = {
  previousEpoch: string;
  epoch: string;
  eventsCleared: number;
  sessionsRevoked: number;
};

/** Run offline after a database restore and before accepting application traffic. */
export async function rotateRealtimeEpoch(prisma: PrismaClient): Promise<RealtimeEpochRotation> {
  return prisma.$transaction(async (tx) => {
    const [clock] = await tx.$queryRaw<Array<{ epoch: string }>>`
      SELECT epoch FROM realtime_clock WHERE id = 1 FOR UPDATE
    `;
    if (!clock) throw new Error('Realtime clock singleton is missing.');

    const eventsCleared = await tx.realtimeEvent.deleteMany({});
    const sessionsRevoked = await tx.session.deleteMany({});
    const epoch = randomUUID();
    const checkpointId = randomUUID();
    await tx.realtimeClock.update({
      where: { id: 1 },
      data: {
        epoch,
        lastSeq: 0n,
        watermarkId: checkpointId,
        epochCheckpointId: checkpointId,
        purgedThrough: 0n,
      },
    });

    return {
      previousEpoch: clock.epoch,
      epoch,
      eventsCleared: eventsCleared.count,
      sessionsRevoked: sessionsRevoked.count,
    };
  });
}
