import { api } from '@/lib/api-client';
import type { components } from '@/lib/api-types';

type Saved = components['schemas']['TaskDependenciesResponse']['data'];

/**
 * Replaces the tasks that must be finished before this one. `expectedUpdatedAt` is the version
 * of the task the choice was made on; the API rejects the change if the task moved on since.
 */
export async function replaceTaskDependencies(
  workspaceId: string,
  teamId: string,
  taskId: string,
  input: { prerequisiteIds: string[]; expectedUpdatedAt: string },
): Promise<Saved> {
  return (await api<{ data: Saved }>(`/workspaces/${workspaceId}/teams/${teamId}/tasks/${taskId}/dependencies`, { method: 'PATCH', body: input })).data;
}
