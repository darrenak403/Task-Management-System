import { api } from '@/lib/api-client';
import type { AiJob } from '@/lib/dto';

const base = (workspaceId: string, teamId: string) => `/workspaces/${workspaceId}/teams/${teamId}/ai-jobs`;

export async function getJob(workspaceId: string, teamId: string, jobId: string, signal?: AbortSignal): Promise<AiJob> {
  return (await api<{ data: AiJob }>(`${base(workspaceId, teamId)}/${jobId}`, { signal })).data;
}

/** Finds the job a request created, for when the response to that request was lost. */
export async function findJobByRequestKey(workspaceId: string, teamId: string, requestKey: string): Promise<AiJob> {
  return (await api<{ data: AiJob }>(base(workspaceId, teamId), { query: { requestKey } })).data;
}

/** Answers the job's questions, or lets it continue on its own assumptions. */
export function clarifyJob(
  workspaceId: string,
  teamId: string,
  jobId: string,
  input: { requestKey: string; answers: string[] } | { requestKey: string; allowAssumptions: true },
): Promise<unknown> {
  return api(`${base(workspaceId, teamId)}/${jobId}/clarify`, { method: 'POST', body: input });
}

export function cancelJob(workspaceId: string, teamId: string, jobId: string): Promise<unknown> {
  return api(`${base(workspaceId, teamId)}/${jobId}/cancel`, { method: 'POST' });
}
