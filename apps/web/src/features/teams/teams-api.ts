import { api } from '@/lib/api-client';
import type { Page, Team, TeamMember } from '@/lib/dto';

export function listTeams(workspaceId: string, page: number, signal?: AbortSignal, pageSize = 100): Promise<Page<Team>> {
  return api(`/workspaces/${workspaceId}/teams`, { query: { page, pageSize }, signal });
}

export async function getTeam(workspaceId: string, teamId: string, signal?: AbortSignal): Promise<Team> {
  return (await api<{ data: Team }>(`/workspaces/${workspaceId}/teams/${teamId}`, { signal })).data;
}

export async function createTeam(workspaceId: string, name: string): Promise<Team> {
  return (await api<{ data: Team }>(`/workspaces/${workspaceId}/teams`, { method: 'POST', body: { name } })).data;
}

export async function renameTeam(workspaceId: string, teamId: string, name: string): Promise<Team> {
  return (await api<{ data: Team }>(`/workspaces/${workspaceId}/teams/${teamId}`, { method: 'PATCH', body: { name } })).data;
}

export function listTeamMembers(
  workspaceId: string,
  teamId: string,
  page: number,
  signal?: AbortSignal,
  pageSize = 50,
): Promise<Page<TeamMember>> {
  return api(`/workspaces/${workspaceId}/teams/${teamId}/members`, { query: { page, pageSize }, signal });
}

export async function addTeamMember(workspaceId: string, teamId: string, userId: string): Promise<TeamMember> {
  return (
    await api<{ data: TeamMember }>(`/workspaces/${workspaceId}/teams/${teamId}/members`, { method: 'POST', body: { userId } })
  ).data;
}

export function removeTeamMember(workspaceId: string, teamId: string, userId: string): Promise<void> {
  return api(`/workspaces/${workspaceId}/teams/${teamId}/members/${userId}`, { method: 'DELETE' });
}
