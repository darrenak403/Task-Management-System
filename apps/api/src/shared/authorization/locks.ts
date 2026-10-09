import type { Prisma } from '../../generated/prisma/client.js';

export type WorkspaceRoleRow = { role: 'OWNER' | 'ADMIN' | 'MEMBER' };
export type TeamMembershipRow = { workspace_id: string; team_id: string; user_id: string };

export async function lockWorkspaceMember(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  userId: string,
  mode: 'SHARE' | 'UPDATE' | 'KEY SHARE' = 'SHARE',
): Promise<WorkspaceRoleRow | null> {
  const rows = mode === 'UPDATE'
    ? await tx.$queryRaw<WorkspaceRoleRow[]>`
        SELECT role FROM workspace_members
        WHERE workspace_id = ${workspaceId}::uuid AND user_id = ${userId}::uuid
        FOR UPDATE
      `
    : mode === 'KEY SHARE'
      ? await tx.$queryRaw<WorkspaceRoleRow[]>`
          SELECT role FROM workspace_members
          WHERE workspace_id = ${workspaceId}::uuid AND user_id = ${userId}::uuid
          FOR KEY SHARE
        `
      : await tx.$queryRaw<WorkspaceRoleRow[]>`
          SELECT role FROM workspace_members
          WHERE workspace_id = ${workspaceId}::uuid AND user_id = ${userId}::uuid
          FOR SHARE
        `;
  return rows[0] ?? null;
}

export async function lockWorkspaceMemberPair(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  actorId: string,
  targetId: string,
): Promise<{ actor: WorkspaceRoleRow | null; target: WorkspaceRoleRow | null }> {
  const ordered = [actorId, targetId].sort((left, right) => left.localeCompare(right));
  const locked = new Map<string, WorkspaceRoleRow | null>();
  for (const userId of ordered) {
    locked.set(userId, await lockWorkspaceMember(tx, workspaceId, userId, userId === targetId ? 'UPDATE' : 'SHARE'));
  }
  return { actor: locked.get(actorId) ?? null, target: locked.get(targetId) ?? null };
}

export async function lockTeamMember(
  tx: Prisma.TransactionClient,
  teamId: string,
  userId: string,
  mode: 'SHARE' | 'UPDATE' | 'KEY SHARE' = 'SHARE',
): Promise<TeamMembershipRow | null> {
  const rows = mode === 'UPDATE'
    ? await tx.$queryRaw<TeamMembershipRow[]>`
        SELECT workspace_id, team_id, user_id FROM team_members
        WHERE team_id = ${teamId}::uuid AND user_id = ${userId}::uuid
        FOR UPDATE
      `
    : mode === 'KEY SHARE'
      ? await tx.$queryRaw<TeamMembershipRow[]>`
          SELECT workspace_id, team_id, user_id FROM team_members
          WHERE team_id = ${teamId}::uuid AND user_id = ${userId}::uuid
          FOR KEY SHARE
        `
      : await tx.$queryRaw<TeamMembershipRow[]>`
          SELECT workspace_id, team_id, user_id FROM team_members
          WHERE team_id = ${teamId}::uuid AND user_id = ${userId}::uuid
          FOR SHARE
        `;
  return rows[0] ?? null;
}

export async function lockTeamMembersForWorkspaceUser(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  userId: string,
): Promise<void> {
  await tx.$queryRaw<Array<{ team_id: string }>>`
    SELECT team_id FROM team_members
    WHERE workspace_id = ${workspaceId}::uuid AND user_id = ${userId}::uuid
    ORDER BY team_id
    FOR UPDATE
  `;
}

export async function lockAssignedTasks(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  assigneeId: string,
  teamId?: string,
): Promise<void> {
  if (teamId) {
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM tasks
      WHERE workspace_id = ${workspaceId}::uuid
        AND team_id = ${teamId}::uuid
        AND assignee_id = ${assigneeId}::uuid
      ORDER BY id
      FOR UPDATE
    `;
    return;
  }

  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM tasks
    WHERE workspace_id = ${workspaceId}::uuid
      AND assignee_id = ${assigneeId}::uuid
    ORDER BY id
    FOR UPDATE
  `;
}

export async function lockTask(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  teamId: string,
  taskId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM tasks
    WHERE workspace_id = ${workspaceId}::uuid
      AND team_id = ${teamId}::uuid
      AND id = ${taskId}::uuid
    FOR UPDATE
  `;
  return rows.length > 0;
}

export async function lockTeamGraph(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  teamId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM teams
    WHERE workspace_id = ${workspaceId}::uuid AND id = ${teamId}::uuid
    FOR UPDATE
  `;
  return rows.length === 1;
}
