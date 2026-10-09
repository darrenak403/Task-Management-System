import { HttpError } from '../http/error-handler.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { lockTeamMember, lockWorkspaceMember, lockWorkspaceMemberPair } from './locks.js';

export type WorkspaceRole = 'OWNER' | 'ADMIN' | 'MEMBER';
export const WORKSPACE_ADMIN_ROLES: readonly WorkspaceRole[] = ['OWNER', 'ADMIN'];

export function resourceNotFound(): HttpError {
  return new HttpError(404, 'RESOURCE_NOT_FOUND', 'The requested resource was not found.');
}

export function forbidden(): HttpError {
  return new HttpError(403, 'FORBIDDEN', 'You do not have permission to perform this action.');
}

export async function requireWorkspaceRole(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  userId: string,
  allowedRoles?: readonly WorkspaceRole[],
): Promise<WorkspaceRole> {
  const membership = await lockWorkspaceMember(tx, workspaceId, userId, 'SHARE');
  if (!membership) throw resourceNotFound();
  if (allowedRoles && !allowedRoles.includes(membership.role)) throw forbidden();
  return membership.role;
}

export async function requireWorkspaceMemberPair(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  actorId: string,
  targetId: string,
  allowedRoles: readonly WorkspaceRole[],
): Promise<{ actorRole: WorkspaceRole; targetRole: WorkspaceRole }> {
  const { actor, target } = await lockWorkspaceMemberPair(tx, workspaceId, actorId, targetId);
  if (!actor || !target) throw resourceNotFound();
  if (!allowedRoles.includes(actor.role)) throw forbidden();
  return { actorRole: actor.role, targetRole: target.role };
}

export async function requireTeamMember(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  teamId: string,
  userId: string,
): Promise<void> {
  const membership = await lockTeamMember(tx, teamId, userId, 'SHARE');
  if (!membership || membership.workspace_id !== workspaceId) throw resourceNotFound();
}
