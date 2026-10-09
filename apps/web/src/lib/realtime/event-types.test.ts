import { describe, expect, it } from 'vitest';

import { effectOf, parseReadyMode, parseRealtimeEvent, type RealtimeEvent } from './event-types';

const base = { eventId: 'e1', schemaVersion: 1, workspaceId: 'w1', payload: {} };
const event = (extra: Partial<RealtimeEvent>) => ({ ...base, ...extra }) as RealtimeEvent;

describe('parseRealtimeEvent', () => {
  it('accepts a known version 1 event', () => {
    const raw = { ...base, type: 'team.tasks_changed', teamId: 't1', payload: { operation: 'updated' } };

    expect(parseRealtimeEvent(JSON.stringify(raw))).toEqual(raw);
  });

  it('rejects malformed data, unknown types and other schema versions', () => {
    expect(parseRealtimeEvent('not json')).toBeNull();
    expect(parseRealtimeEvent(undefined)).toBeNull();
    expect(parseRealtimeEvent(JSON.stringify({ ...base, type: 'team.exploded' }))).toBeNull();
    expect(parseRealtimeEvent(JSON.stringify({ ...base, schemaVersion: 2, type: 'team.tasks_changed' }))).toBeNull();
  });
});

describe('parseReadyMode', () => {
  it('reads the three handshake modes', () => {
    expect(parseReadyMode('{"mode":"initial"}')).toBe('initial');
    expect(parseReadyMode('{"mode":"resume"}')).toBe('resume');
    expect(parseReadyMode('{"mode":"resume_complete"}')).toBe('resume_complete');
    expect(parseReadyMode('{"mode":"other"}')).toBeNull();
  });
});

describe('effectOf', () => {
  it('refetches the tasks of the team that changed', () => {
    expect(effectOf(event({ type: 'team.tasks_changed', teamId: 't1' }))).toEqual({ kind: 'invalidate', topics: ['tasks:t1'] });
  });

  it('refetches roster and tasks when team membership changes', () => {
    expect(effectOf(event({ type: 'team.roster_changed', teamId: 't1' }))).toEqual({
      kind: 'invalidate',
      topics: ['roster:t1', 'tasks:t1'],
    });
  });

  it('refetches structure and members when the workspace structure changes', () => {
    expect(effectOf(event({ type: 'workspace.structure_changed' }))).toEqual({ kind: 'invalidate', topics: ['structure', 'members'] });
  });

  it('routes planner events to the planner of that team', () => {
    expect(effectOf(event({ type: 'planner.job_changed', teamId: 't1' }))).toEqual({ kind: 'invalidate', topics: ['planner:t1'] });
    expect(effectOf(event({ type: 'planner.plan_changed', teamId: 't1' }))).toEqual({ kind: 'invalidate', topics: ['planner:t1'] });
  });

  it('reloads everything when access changes and ends the session when it is revoked', () => {
    expect(effectOf(event({ type: 'access.changed' }))).toEqual({ kind: 'reload-all' });
    expect(effectOf(event({ type: 'auth.revoked' }))).toEqual({ kind: 'session-ended' });
  });
});
