import { api } from '@/lib/api-client';
import type { AiImportReceipt, AiJob, AiPlannerStatus, AiPlanVersion, Page, PlanDraftContent, PlanDraftItem } from '@/lib/dto';
import type { components } from '@/lib/api-types';

type Schemas = components['schemas'];

export type CreatePlanInput = Schemas['CreateAiPlanRequest'];
export type EnqueuedJob = Schemas['EnqueuedAiJob'];
export type RevisionAction = Schemas['GenerateAiRevisionRequest']['action'];
export type FieldLock = Schemas['PlannerFieldLock'];
export type RevisionField = NonNullable<Schemas['GenerateAiRevisionRequest']['fieldMask']>[number];

/** Every field the AI writes; a full regeneration asks for all of them. */
export const AI_FIELDS: readonly RevisionField[] = [
  'title',
  'description',
  'completionCriteria',
  'priority',
  'priorityReason',
  'estimateMinMinutes',
  'estimateMaxMinutes',
  'schedule',
  'checklist',
  'suggestedRole',
];
export type PlanStatus = Schemas['AiPlan']['status'];

/** Only an AI revision of the draft that is active right now can be made active; edits and older revisions cannot. */
export function canActivate(version: { source: AiPlanVersion['source']; baseVersionId: string | null }, activeVersionId: string | null): boolean {
  return version.source !== 'EDITED' && activeVersionId !== null && version.baseVersionId === activeVersionId;
}

/** The newest job of a plan, as embedded in plan responses. */
export type LatestJob = Pick<AiJob, 'id' | 'status' | 'currentStage' | 'sequence'>;

/** The stored draft may carry server metadata next to the editable content. */
export type StoredDraft = PlanDraftContent & { fieldLocks?: FieldLock[] };

export type ActiveVersion = Pick<AiPlanVersion, 'id' | 'ordinal' | 'source' | 'contentHash' | 'createdAt'> & { draft: StoredDraft };

/** A row of the version list. It carries no content; that is loaded per version. */
export type VersionSummary = Pick<AiPlanVersion, 'id' | 'ordinal' | 'source' | 'contentHash' | 'createdAt'> & {
  baseVersionId: string | null;
  active: boolean;
  purged: boolean;
};

export type VersionDetail = ActiveVersion & { baseVersionId: string | null };

/** Plan detail as the API returns it; the generated schema leaves `latestJob` and the receipt untyped. */
export type PlanDetail = {
  id: string;
  workspaceId: string;
  teamId: string;
  status: PlanStatus;
  activeVersionId: string | null;
  createdAt: string;
  expiresAt: string;
  latestJob: LatestJob | null;
  version: ActiveVersion | null;
  importReceipt: { confirmedVersionId: string; itemTaskMap: { itemId: string; taskId: string }[]; committedAt: string } | null;
};

export type PlanSummary = {
  id: string;
  status: PlanStatus;
  activeVersionId: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  latestJob: LatestJob | null;
};

export type PlanList = Page<PlanSummary> & { availability: AiPlannerStatus };

const base = (workspaceId: string, teamId: string) => `/workspaces/${workspaceId}/teams/${teamId}/ai-plans`;

/** Short unique key that lets the server recognise a repeated request instead of running it twice. */
export function newRequestKey(): string {
  return crypto.randomUUID();
}

export function listPlans(workspaceId: string, teamId: string, page: number, signal?: AbortSignal): Promise<PlanList> {
  return api(base(workspaceId, teamId), { query: { page, pageSize: 20 }, signal });
}

export async function createPlan(workspaceId: string, teamId: string, input: CreatePlanInput): Promise<EnqueuedJob> {
  return (await api<{ data: EnqueuedJob }>(base(workspaceId, teamId), { method: 'POST', body: input })).data;
}

export async function getPlan(workspaceId: string, teamId: string, planId: string, signal?: AbortSignal): Promise<PlanDetail> {
  return (await api<{ data: PlanDetail }>(`${base(workspaceId, teamId)}/${planId}`, { signal })).data;
}

export async function generateRevision(
  workspaceId: string,
  teamId: string,
  planId: string,
  input: { requestKey: string; action: RevisionAction; baseVersionId: string | null; retryJobId?: string; itemIds?: string[]; fieldMask?: RevisionField[]; deadline?: string },
): Promise<EnqueuedJob> {
  return (await api<{ data: EnqueuedJob }>(`${base(workspaceId, teamId)}/${planId}/generate`, { method: 'POST', body: input })).data;
}

export async function confirmPlan(
  workspaceId: string,
  teamId: string,
  planId: string,
  input: { versionId: string; selectedItemIds: string[]; requestKey: string },
): Promise<AiImportReceipt> {
  return (await api<{ data: AiImportReceipt }>(`${base(workspaceId, teamId)}/${planId}/confirm`, { method: 'POST', body: input })).data;
}

export async function clonePlan(workspaceId: string, teamId: string, planId: string, requestKey: string): Promise<{ planId: string }> {
  return (await api<{ data: { planId: string } }>(`${base(workspaceId, teamId)}/${planId}/clone`, { method: 'POST', body: { requestKey } })).data;
}

export function listVersions(workspaceId: string, teamId: string, planId: string, page: number, signal?: AbortSignal): Promise<Page<VersionSummary>> {
  return api(`${base(workspaceId, teamId)}/${planId}/versions`, { query: { page, pageSize: 20 }, signal });
}

export async function getVersion(workspaceId: string, teamId: string, planId: string, versionId: string, signal?: AbortSignal): Promise<VersionDetail> {
  return (await api<{ data: VersionDetail }>(`${base(workspaceId, teamId)}/${planId}/versions/${versionId}`, { signal })).data;
}

/** Saves an edited draft as a new version, which becomes the active one. `expectedActiveVersionId` makes a concurrent change fail instead of being overwritten. */
export async function saveVersion(
  workspaceId: string,
  teamId: string,
  planId: string,
  input: { expectedActiveVersionId: string | null; draft: PlanDraftContent; fieldLocks: FieldLock[] },
): Promise<{ id: string }> {
  return (await api<{ data: { id: string } }>(`${base(workspaceId, teamId)}/${planId}/versions`, { method: 'POST', body: input })).data;
}

export function activateVersion(
  workspaceId: string,
  teamId: string,
  planId: string,
  versionId: string,
  expectedActiveVersionId: string | null,
): Promise<unknown> {
  return api(`${base(workspaceId, teamId)}/${planId}/versions/${versionId}/activate`, { method: 'POST', body: { expectedActiveVersionId } });
}

/** Only the editable content is sent back; server metadata stored with a draft is not part of a save. */
export function draftContentOf(draft: StoredDraft, items: PlanDraftItem[] = draft.items): PlanDraftContent {
  return {
    planTitle: draft.planTitle,
    goalSummary: draft.goalSummary,
    assumptions: draft.assumptions,
    warnings: draft.warnings,
    items: items.map((item, position) => ({ ...item, position })),
  };
}
