import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/client.js';
import { validateRealtimeEvent, type RealtimeEventInput } from './event-catalog.js';

type ClockAllocation = { epoch: string; seq: bigint; watermark_id: string };

/** Must be called after all domain writes and business locks in the transaction. */
export async function appendRealtimeEvents(
  tx: Prisma.TransactionClient,
  events: readonly RealtimeEventInput[],
): Promise<void> {
  for (const event of events) {
    validateRealtimeEvent(event);
    const id = randomUUID();
    const [clock] = await tx.$queryRaw<ClockAllocation[]>`
      UPDATE realtime_clock
      SET last_seq = last_seq + 1, watermark_id = ${id}::uuid
      WHERE id = 1
      RETURNING epoch, last_seq AS seq, watermark_id
    `;
    if (!clock) throw new Error('Realtime clock singleton is missing.');

    // Assign age while holding the clock lock so retention time stays ordered with commit-safe seq.
    await tx.$executeRaw`
      INSERT INTO realtime_events (
        id, epoch, seq, event_type, schema_version, workspace_id, team_id,
        target_user_id, target_session_hash, resource_id, payload, recorded_at
      ) VALUES (
        ${id}::uuid, ${clock.epoch}::uuid, ${clock.seq}, ${event.eventType}, 1,
        ${event.workspaceId ?? null}::uuid, ${event.teamId ?? null}::uuid,
        ${event.targetUserId ?? null}::uuid, ${event.targetSessionHash ?? null},
        ${event.resourceId ?? null}::uuid, ${JSON.stringify(event.payload)}::jsonb, clock_timestamp()
      )
    `;
    await tx.$queryRaw<Array<{ notified: boolean }>>`SELECT pg_notify('tms_realtime_outbox', ${id}) IS NULL AS notified`;
  }
}
