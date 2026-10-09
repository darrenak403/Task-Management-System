import { api } from '@/lib/api-client';
import type { Page, User, Workspace, WorkspaceMember, WorkspaceRole } from '@/lib/dto';

export const LIST_PAGE_SIZE = 20;
/** Navigation lists (switcher, sidebar) load large pages and offer "Load more" beyond that. */
export const NAV_PAGE_SIZE = 100;

export function listWorkspaces(page: number, signal?: AbortSignal): Promise<Page<Workspace>> {
  return api('/workspaces', { query: { page, pageSize: NAV_PAGE_SIZE }, signal });
}

export async function getWorkspace(workspaceId: string, signal?: AbortSignal): Promise<Workspace> {
  return (await api<{ data: Workspace }>(`/workspaces/${workspaceId}`, { signal })).data;
}

export async function createWorkspace(name: string): Promise<Workspace> {
  return (await api<{ data: Workspace }>('/workspaces', { method: 'POST', body: { name } })).data;
}

export async function renameWorkspace(workspaceId: string, name: string): Promise<Workspace> {
  return (await api<{ data: Workspace }>(`/workspaces/${workspaceId}`, { method: 'PATCH', body: { name } })).data;
}

export function listWorkspaceMembers(
  workspaceId: string,
  page: number,
  signal?: AbortSignal,
  pageSize = LIST_PAGE_SIZE,
): Promise<Page<WorkspaceMember>> {
  return api(`/workspaces/${workspaceId}/members`, { query: { page, pageSize }, signal });
}

/** Up to 20 accounts that are not in the workspace yet, optionally narrowed by part of a name or email. */
export async function listMemberCandidates(workspaceId: string, search: string, signal?: AbortSignal): Promise<User[]> {
  return (await api<{ data: User[] }>(`/workspaces/${workspaceId}/member-candidates`, { query: search ? { search } : {}, signal })).data;
}

export async function addWorkspaceMember(workspaceId: string, email: string): Promise<WorkspaceMember> {
  return (await api<{ data: WorkspaceMember }>(`/workspaces/${workspaceId}/members`, { method: 'POST', body: { email } })).data;
}

export async function changeMemberRole(
  workspaceId: string,
  userId: string,
  role: Exclude<WorkspaceRole, 'OWNER'>,
): Promise<WorkspaceMember> {
  return (
    await api<{ data: WorkspaceMember }>(`/workspaces/${workspaceId}/members/${userId}`, { method: 'PATCH', body: { role } })
  ).data;
}

export function removeWorkspaceMember(workspaceId: string, userId: string): Promise<void> {
  return api(`/workspaces/${workspaceId}/members/${userId}`, { method: 'DELETE' });
}
