import { topics } from './invalidation-bus';

/** Business events of `GET /api/realtime/events`, schema version 1. */
export const REALTIME_EVENT_TYPES = [
  'team.tasks_changed',
  'team.roster_changed',
  'workspace.structure_changed',
  'access.changed',
  'auth.revoked',
  'planner.job_changed',
  'planner.plan_changed',
] as const;

export type RealtimeEventType = (typeof REALTIME_EVENT_TYPES)[number];

/** Stream control frames; they carry no business data. */
export const REALTIME_CONTROL_TYPES = ['ready', 'resync_required', 'auth.expired', 'server.unavailable', 'server.draining'] as const;

export type RealtimeEvent = {
  eventId: string;
  schemaVersion: number;
  type: RealtimeEventType;
  workspaceId?: string;
  teamId?: string;
  resourceId?: string;
  payload: Record<string, unknown>;
};

export type ReadyMode = 'initial' | 'resume' | 'resume_complete';

function parseJson(data: unknown): Record<string, unknown> | null {
  if (typeof data !== 'string') return null;
  try {
    const value: unknown = JSON.parse(data);
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Returns null for anything this client does not understand; the caller then reloads a snapshot. */
export function parseRealtimeEvent(data: unknown): RealtimeEvent | null {
  const value = parseJson(data);
  if (!value || value.schemaVersion !== 1) return null;
  if (!REALTIME_EVENT_TYPES.includes(value.type as RealtimeEventType)) return null;
  return value as unknown as RealtimeEvent;
}

export function parseReadyMode(data: unknown): ReadyMode | null {
  const mode = parseJson(data)?.mode;
  return mode === 'initial' || mode === 'resume' || mode === 'resume_complete' ? mode : null;
}

export type EventEffect =
  /** Refetch the screens subscribed to these topics. */
  | { kind: 'invalidate'; topics: string[] }
  /** The caller's access changed: every scoped screen reloads and drops what it may no longer see. */
  | { kind: 'reload-all' }
  /** This browser session ended elsewhere. */
  | { kind: 'session-ended' };

/** Events are only signals: they say what to refetch, never what the data is. */
export function effectOf(event: RealtimeEvent): EventEffect {
  switch (event.type) {
    case 'team.tasks_changed':
      return { kind: 'invalidate', topics: [event.teamId ? topics.tasks(event.teamId) : topics.anyTasks] };
    case 'team.roster_changed':
      // Removing someone from a team also unassigns their tasks there.
      return { kind: 'invalidate', topics: event.teamId ? [topics.roster(event.teamId), topics.tasks(event.teamId)] : [topics.structure] };
    case 'workspace.structure_changed':
      return { kind: 'invalidate', topics: [topics.structure, topics.members] };
    case 'planner.job_changed':
    case 'planner.plan_changed':
      return { kind: 'invalidate', topics: event.teamId ? [topics.planner(event.teamId)] : [] };
    case 'access.changed':
      return { kind: 'reload-all' };
    case 'auth.revoked':
      return { kind: 'session-ended' };
  }
}
