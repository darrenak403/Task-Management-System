import { api } from '@/lib/api-client';
import type { Dashboard } from '@/lib/dto';

/** Counts and upcoming deadlines across the teams the caller can see in the workspace. */
export async function getDashboard(workspaceId: string, signal?: AbortSignal): Promise<Dashboard> {
  return (await api<{ data: Dashboard }>(`/workspaces/${workspaceId}/dashboard`, { signal })).data;
}
