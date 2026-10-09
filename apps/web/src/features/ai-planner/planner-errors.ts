import { messages } from '@/i18n/messages';
import { errorMessage, isApiError } from '@/lib/api-errors';

/** What the user can do next about a planner problem. */
export type PlannerNextStep = 'open-ai-settings' | 'retry' | 'shorten-input' | 'reload' | 'wait' | 'none';

export type PlannerProblem = { message: string; next: PlannerNextStep };

/**
 * What to do next for each failure the API or a job can report; the texts are in the `planner.problems` messages. Codes come from HTTP error envelopes
 * and from a failed job's `safeErrorCode`; both use the same vocabulary.
 */
const NEXT_STEPS: Record<string, PlannerNextStep> = {
  AI_CREDENTIAL_REQUIRED: 'open-ai-settings',
  AI_MODEL_REQUIRED: 'open-ai-settings',
  AI_CREDENTIAL_UNAVAILABLE: 'open-ai-settings',
  AI_CREDENTIAL_CHANGED: 'retry',
  INVALID_GEMINI_CREDENTIAL: 'none',
  GEMINI_VALIDATION_UNAVAILABLE: 'retry',
  CREDENTIAL_STORAGE_UNAVAILABLE: 'retry',
  AI_RATE_LIMITED: 'wait',
  AI_QUOTA_EXCEEDED: 'wait',
  AI_REFUSED: 'shorten-input',
  AI_TIMEOUT: 'retry',
  AI_PROVIDER_UNAVAILABLE: 'retry',
  AI_OUTPUT_INVALID: 'retry',
  AI_TOKEN_LIMIT_EXCEEDED: 'shorten-input',
  AI_INPUT_TOO_LARGE: 'shorten-input',
  AI_CONTEXT_TOO_LARGE: 'shorten-input',
  AI_CONTEXT_STALE: 'retry',
  AI_RETRY_LIMIT_REACHED: 'none',
  AI_RETRY_NOT_AVAILABLE: 'none',
  AI_REVISION_UNAVAILABLE: 'reload',
  AI_JOB_ACTIVE: 'wait',
  AI_CANCELLED: 'retry',
  AI_UNAVAILABLE: 'none',
  AI_RESTORE_QUARANTINE: 'none',
  VERSION_CONFLICT: 'reload',
  SELECTION_CONFLICT: 'reload',
  PLAN_NOT_EDITABLE: 'reload',
  PLAN_ALREADY_IMPORTED: 'reload',
  PLAN_EXPIRED: 'none',
  VERSION_EXPIRED: 'none',
  CLARIFICATION_NOT_AVAILABLE: 'reload',
  DEPENDENCY_CYCLE: 'none',
  DEPENDENCY_NOT_SELECTED: 'none',
  INVALID_DEPENDENCY: 'none',
  INVALID_ASSIGNEE: 'none',
  INVALID_PLAN_SCHEDULE: 'none',
  IDEMPOTENCY_CONFLICT: 'reload',
};

export function plannerProblemForCode(code: string | null | undefined): PlannerProblem | null {
  const next = code ? NEXT_STEPS[code] : undefined;
  if (!code || !next) return null;
  return { message: (messages().planner.problems as Record<string, string>)[code] ?? messages().common.errors.generic, next };
}

export function plannerProblem(error: unknown): PlannerProblem {
  const known = isApiError(error) ? plannerProblemForCode(error.code) : null;
  return known ?? { message: errorMessage(error), next: 'none' };
}

/** A failed job always gets a specific explanation, even for a code this client does not know yet. */
export function jobFailureProblem(safeErrorCode: string | null): PlannerProblem {
  return plannerProblemForCode(safeErrorCode) ?? { message: messages().planner.jobFailed, next: 'retry' };
}
