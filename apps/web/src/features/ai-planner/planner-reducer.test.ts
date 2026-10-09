import { describe, expect, it } from 'vitest';

import type { AiJob } from '@/lib/dto';

import type { PlanDetail } from './ai-plans-api';
import { initialPlannerState, plannerReducer, type PlannerAction, type PlannerState } from './planner-reducer';

function plan(extra: Partial<PlanDetail> = {}): PlanDetail {
  return {
    id: 'p1',
    workspaceId: 'w1',
    teamId: 't1',
    status: 'DRAFT',
    activeVersionId: null,
    createdAt: '',
    expiresAt: '',
    latestJob: { id: 'j1', status: 'RUNNING', currentStage: null, sequence: 1 },
    version: null,
    importReceipt: null,
    ...extra,
  };
}

const version = { id: 'v1', ordinal: 1, source: 'GENERATED', contentHash: 'h', createdAt: '', draft: {} } as PlanDetail['version'];

function job(status: AiJob['status'], sequence: number, extra: Partial<AiJob> = {}): AiJob {
  return { id: 'j1', planId: 'p1', status, sequence, clarificationQuestions: [], stages: [], ...extra } as AiJob;
}

function run(...actions: PlannerAction[]): PlannerState {
  return actions.reduce(plannerReducer, initialPlannerState);
}

describe('planner reducer', () => {
  it('starts in loading', () => {
    expect(initialPlannerState.phase).toBe('loading');
  });

  it('is generating while the job is queued or running', () => {
    expect(run({ type: 'plan_loaded', plan: plan() }).phase).toBe('generating');
    expect(run({ type: 'plan_loaded', plan: plan() }, { type: 'job_loaded', job: job('QUEUED', 2) }).phase).toBe('generating');
  });

  it('waits for answers when the job asks questions, then generates again', () => {
    const asked = run({ type: 'plan_loaded', plan: plan() }, { type: 'job_loaded', job: job('NEEDS_CLARIFICATION', 2) });
    expect(asked.phase).toBe('awaiting-clarification');

    expect(plannerReducer(asked, { type: 'job_loaded', job: job('RUNNING', 3) }).phase).toBe('generating');
  });

  it('trusts the plan over a job snapshot that is older than what the plan reports', () => {
    const running = run({ type: 'plan_loaded', plan: plan() }, { type: 'job_loaded', job: job('RUNNING', 2) });
    const failed = plannerReducer(running, {
      type: 'plan_loaded',
      plan: plan({ latestJob: { id: 'j1', status: 'FAILED', currentStage: null, sequence: 3 } }),
    });
    expect(failed.phase).toBe('failed');
  });

  it('keeps generating after success until the plan arrives with its version', () => {
    const succeeded = run({ type: 'plan_loaded', plan: plan() }, { type: 'job_loaded', job: job('SUCCEEDED', 4) });
    expect(succeeded.phase).toBe('generating');

    const loaded = plannerReducer(succeeded, {
      type: 'plan_loaded',
      plan: plan({ version, activeVersionId: 'v1', latestJob: { id: 'j1', status: 'SUCCEEDED', currentStage: null, sequence: 4 } }),
    });
    expect(loaded.phase).toBe('draft');
  });

  it('ends in failed or cancelled when no draft was produced', () => {
    expect(run({ type: 'plan_loaded', plan: plan() }, { type: 'job_loaded', job: job('FAILED', 2) }).phase).toBe('failed');
    expect(run({ type: 'plan_loaded', plan: plan() }, { type: 'job_loaded', job: job('INTERRUPTED', 2) }).phase).toBe('failed');
    expect(run({ type: 'plan_loaded', plan: plan() }, { type: 'job_loaded', job: job('CANCELLED', 2) }).phase).toBe('cancelled');
  });

  it('returns to the existing draft when a later revision fails or is cancelled', () => {
    const withDraft = plan({ version, activeVersionId: 'v1' });

    expect(run({ type: 'plan_loaded', plan: withDraft }, { type: 'job_loaded', job: job('FAILED', 2) }).phase).toBe('draft');
    expect(run({ type: 'plan_loaded', plan: withDraft }, { type: 'job_loaded', job: job('CANCELLED', 2) }).phase).toBe('draft');
  });

  it('ignores a job snapshot that is older than, or the same as, the one already applied', () => {
    const current = run({ type: 'plan_loaded', plan: plan() }, { type: 'job_loaded', job: job('NEEDS_CLARIFICATION', 5) });

    expect(plannerReducer(current, { type: 'job_loaded', job: job('RUNNING', 3) })).toBe(current);
    expect(plannerReducer(current, { type: 'job_loaded', job: job('NEEDS_CLARIFICATION', 5) })).toBe(current);
  });

  it('ignores a job that belongs to another plan', () => {
    const current = run({ type: 'plan_loaded', plan: plan() });

    expect(plannerReducer(current, { type: 'job_loaded', job: job('FAILED', 9, { planId: 'other' }) })).toBe(current);
  });

  it('follows the newest job named by the plan, not an earlier loaded one', () => {
    const state = run(
      { type: 'plan_loaded', plan: plan({ version, activeVersionId: 'v1' }) },
      { type: 'job_loaded', job: job('SUCCEEDED', 4) },
      {
        type: 'plan_loaded',
        plan: plan({ version, activeVersionId: 'v1', latestJob: { id: 'j2', status: 'RUNNING', currentStage: null, sequence: 1 } }),
      },
    );

    expect(state.phase).toBe('generating');
  });

  it('locks into confirming, then becomes confirmed when the plan is imported', () => {
    const draft = run({ type: 'plan_loaded', plan: plan({ version, activeVersionId: 'v1', latestJob: null }) });
    const confirming = plannerReducer(draft, { type: 'confirm_started' });
    expect(confirming.phase).toBe('confirming');

    // A realtime-triggered reload during the request does not unlock the page.
    expect(plannerReducer(confirming, { type: 'plan_loaded', plan: draft.plan! }).phase).toBe('confirming');

    const done = plannerReducer(confirming, { type: 'plan_loaded', plan: plan({ status: 'IMPORTED', version }) });
    expect(done.phase).toBe('confirmed');
    expect(done.confirming).toBe(false);
  });

  it('returns to the draft when confirm settles without success', () => {
    const draft = run({ type: 'plan_loaded', plan: plan({ version, activeVersionId: 'v1', latestJob: null }) });
    const settled = plannerReducer(plannerReducer(draft, { type: 'confirm_started' }), { type: 'confirm_settled' });

    expect(settled.phase).toBe('draft');
  });

  it('does not start confirming outside the draft phase', () => {
    const generating = run({ type: 'plan_loaded', plan: plan() });

    expect(plannerReducer(generating, { type: 'confirm_started' })).toBe(generating);
  });

  it('stays confirmed when an older draft response arrives late', () => {
    const confirmed = run({ type: 'plan_loaded', plan: plan({ status: 'IMPORTED', version }) });

    expect(plannerReducer(confirmed, { type: 'plan_loaded', plan: plan({ version }) })).toBe(confirmed);
  });

  it('marks an expired plan', () => {
    expect(run({ type: 'plan_loaded', plan: plan({ status: 'EXPIRED' }) }).phase).toBe('expired');
  });
});
