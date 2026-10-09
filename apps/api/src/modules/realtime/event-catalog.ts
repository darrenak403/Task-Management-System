import { z } from 'zod';

const uuid = z.uuid();

const eventDefinitions = {
  'team.tasks_changed': z.object({
    operation: z.enum(['created', 'updated', 'deleted', 'assignments_changed']),
    revision: z.string().datetime().optional(),
  }).strict(),
  'team.roster_changed': z.object({ operation: z.enum(['member_added', 'member_removed']) }).strict(),
  'workspace.structure_changed': z.object({
    resourceType: z.enum(['workspace', 'team', 'membership']),
    operation: z.enum(['created', 'updated', 'added', 'removed', 'role_changed']),
  }).strict(),
  'access.changed': z.object({ reason: z.enum(['workspace_membership', 'workspace_role', 'team_membership']) }).strict(),
  'auth.revoked': z.object({ reason: z.enum(['logout', 'session_rotated']) }).strict(),
  'planner.job_changed': z.object({
    jobSequence: z.number().int().nonnegative(),
    status: z.enum(['QUEUED', 'RUNNING', 'NEEDS_CLARIFICATION', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED']),
    stage: z.string().max(40).nullable(),
    summary: z.string().max(160),
  }).strict(),
  'planner.plan_changed': z.object({
    versionId: uuid,
    versionOrdinal: z.number().int().positive(),
    summary: z.string().max(160),
  }).strict(),
} as const;

export type RealtimeEventType = keyof typeof eventDefinitions;
export type RealtimeEventPayload<T extends RealtimeEventType = RealtimeEventType> = z.infer<(typeof eventDefinitions)[T]>;

export type RealtimeEventInput = {
  [T in RealtimeEventType]: {
    eventType: T;
    workspaceId?: string;
    teamId?: string;
    targetUserId?: string;
    targetSessionHash?: string;
    resourceId?: string;
    payload: RealtimeEventPayload<T>;
  }
}[RealtimeEventType];

const common = z.object({
  workspaceId: uuid.optional(),
  teamId: uuid.optional(),
  targetUserId: uuid.optional(),
  targetSessionHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  resourceId: uuid.optional(),
}).strict();

export function validateRealtimeEvent(input: RealtimeEventInput): void {
  const scope = common.safeParse({
    workspaceId: input.workspaceId,
    teamId: input.teamId,
    targetUserId: input.targetUserId,
    targetSessionHash: input.targetSessionHash,
    resourceId: input.resourceId,
  });
  if (!scope.success) throw new Error('Invalid realtime event scope.');
  if (!input.workspaceId && !input.targetUserId && !input.targetSessionHash) {
    throw new Error('Realtime events require a workspace or targeted audience.');
  }
  if (input.teamId && !input.workspaceId) throw new Error('Team-scoped events require a workspace.');
  const parsed = eventDefinitions[input.eventType].safeParse(input.payload);
  if (!parsed.success) throw new Error(`Invalid ${input.eventType} payload.`);
  if (input.eventType === 'access.changed' && !input.targetUserId) {
    throw new Error('Access events must target an affected user.');
  }
  if (input.eventType === 'auth.revoked' && !input.targetSessionHash) {
    throw new Error('Revocation events must target a session hash.');
  }
  if (input.eventType === 'planner.job_changed' && (!input.targetUserId || !input.workspaceId || !input.teamId || !input.resourceId)) {
    throw new Error('Planner events must be scoped and targeted to their creator.');
  }
  if (input.eventType === 'planner.plan_changed' && (!input.targetUserId || !input.workspaceId || !input.teamId || !input.resourceId)) {
    throw new Error('Planner version events must be scoped and targeted to their creator.');
  }
}

export function isRealtimeEventType(value: string): value is RealtimeEventType {
  return Object.hasOwn(eventDefinitions, value);
}
