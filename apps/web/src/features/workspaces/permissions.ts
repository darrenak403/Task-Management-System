import type { WorkspaceRole } from '@/lib/dto';

/**
 * UI-side mirror of the workspace permission matrix (architecture section 5.2a).
 * It only decides what to show; the API re-checks every request and stays the source of truth.
 */
export type WorkspaceAction =
  | 'workspace.rename'
  | 'team.create'
  | 'team.rename'
  | 'team.manageMembers'
  | 'members.view'
  | 'members.add'
  | 'members.changeRole'
  | 'tasks.manageAllTeams';

const MATRIX: Record<WorkspaceAction, readonly WorkspaceRole[]> = {
  'workspace.rename': ['OWNER', 'ADMIN'],
  'team.create': ['OWNER', 'ADMIN'],
  'team.rename': ['OWNER', 'ADMIN'],
  'team.manageMembers': ['OWNER', 'ADMIN'],
  'members.view': ['OWNER', 'ADMIN'],
  'members.add': ['OWNER', 'ADMIN'],
  'members.changeRole': ['OWNER'],
  'tasks.manageAllTeams': ['OWNER', 'ADMIN'],
};

export function can(action: WorkspaceAction, role: WorkspaceRole | undefined): boolean {
  return role !== undefined && MATRIX[action].includes(role);
}

/** OWNER removes ADMIN and MEMBER; ADMIN removes only MEMBER; nobody removes the OWNER or themselves. */
export function canRemoveMember(
  actor: { id: string; role: WorkspaceRole | undefined },
  target: { id: string; role: WorkspaceRole },
): boolean {
  if (target.role === 'OWNER' || target.id === actor.id) return false;
  if (actor.role === 'OWNER') return true;
  return actor.role === 'ADMIN' && target.role === 'MEMBER';
}

/** Only the OWNER switches other people between ADMIN and MEMBER; the OWNER role itself is immutable. */
export function canChangeRole(
  actor: { id: string; role: WorkspaceRole | undefined },
  target: { id: string; role: WorkspaceRole },
): boolean {
  return actor.role === 'OWNER' && target.role !== 'OWNER' && target.id !== actor.id;
}

/** OWNER/ADMIN delete any task; a MEMBER deletes only tasks they created. */
export function canDeleteTask(actor: { id: string; role: WorkspaceRole | undefined }, task: { createdBy: string }): boolean {
  if (actor.role === 'OWNER' || actor.role === 'ADMIN') return true;
  return actor.role === 'MEMBER' && task.createdBy === actor.id;
}
