import type { AiJob } from '@/lib/dto';

import type { PlanDetail } from './ai-plans-api';

/**
 * Where the plan page is in the Goal → Draft → Confirm flow.
 * - `loading`: nothing known yet
 * - `generating`: a job is queued or running
 * - `awaiting-clarification`: the job asked questions and waits for answers
 * - `draft`: an editable version exists
 * - `confirming`: the confirm request was sent and no result is known yet
 * - `confirmed`: tasks were created from the plan
 * - `failed` / `cancelled`: the job ended without producing a first draft
 * - `expired`: the plan can no longer be used
 */
export type PlannerPhase =
  | 'loading'
  | 'generating'
  | 'awaiting-clarification'
  | 'draft'
  | 'confirming'
  | 'confirmed'
  | 'failed'
  | 'cancelled'
  | 'expired';

export type PlannerState = {
  phase: PlannerPhase;
  plan: PlanDetail | null;
  job: AiJob | null;
  confirming: boolean;
};

export type PlannerAction =
  | { type: 'plan_loaded'; plan: PlanDetail }
  | { type: 'job_loaded'; job: AiJob }
  | { type: 'confirm_started' }
  /** The confirm request ended without a known success; the next plan load decides the phase. */
  | { type: 'confirm_settled' };

export const initialPlannerState: PlannerState = { phase: 'loading', plan: null, job: null, confirming: false };

const ACTIVE_JOB = new Set<AiJob['status']>(['QUEUED', 'RUNNING']);

export function isJobActive(status: AiJob['status'] | undefined): boolean {
  return status !== undefined && (ACTIVE_JOB.has(status) || status === 'NEEDS_CLARIFICATION');
}

function phaseOf(plan: PlanDetail | null, job: AiJob | null, confirming: boolean): PlannerPhase {
  if (!plan) return 'loading';
  if (plan.status === 'IMPORTED') return 'confirmed';
  if (plan.status === 'EXPIRED') return 'expired';
  if (confirming) return 'confirming';

  // The plan names its newest job; a loaded job with another id belongs to an earlier request,
  // and one with a lower sequence is older than what the plan already reports.
  const latest = plan.latestJob;
  const status = job && latest && job.id === latest.id && job.sequence >= latest.sequence ? job.status : latest?.status;
  if (status === 'NEEDS_CLARIFICATION') return 'awaiting-clarification';
  if (status && ACTIVE_JOB.has(status)) return 'generating';
  if (plan.version) return 'draft';
  if (status === 'CANCELLED') return 'cancelled';
  if (status === 'FAILED' || status === 'INTERRUPTED') return 'failed';
  // The job succeeded but the plan has not been reloaded with its version yet.
  return status === 'SUCCEEDED' ? 'generating' : 'loading';
}

export function plannerReducer(state: PlannerState, action: PlannerAction): PlannerState {
  switch (action.type) {
    case 'plan_loaded': {
      const plan = action.plan;
      // A confirmed plan stays confirmed even if an older response arrives afterwards.
      if (state.plan?.id === plan.id && state.plan.status === 'IMPORTED' && plan.status !== 'IMPORTED') return state;
      const job = state.job && state.job.planId === plan.id ? state.job : null;
      const confirming = state.confirming && plan.status === 'DRAFT';
      return { plan, job, confirming, phase: phaseOf(plan, job, confirming) };
    }
    case 'job_loaded': {
      const job = action.job;
      if (state.plan && job.planId !== state.plan.id) return state;
      // Job snapshots carry a sequence that only grows; a late or repeated one changes nothing.
      if (state.job?.id === job.id && job.sequence <= state.job.sequence) return state;
      return { ...state, job, phase: phaseOf(state.plan, job, state.confirming) };
    }
    case 'confirm_started':
      if (state.phase !== 'draft') return state;
      return { ...state, confirming: true, phase: 'confirming' };
    case 'confirm_settled':
      if (!state.confirming) return state;
      return { ...state, confirming: false, phase: phaseOf(state.plan, state.job, false) };
  }
}
