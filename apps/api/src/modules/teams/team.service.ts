import type { PrismaClient } from '../../generated/prisma/client.js';
import { runTransactionWithRetry } from '../../shared/db/transaction.js';
import { lockAssignedTasks, lockTeamMember, lockWorkspaceMember } from '../../shared/authorization/locks.js';
import { requireWorkspaceRole, resourceNotFound, WORKSPACE_ADMIN_ROLES } from '../../shared/authorization/policy.js';
import { HttpError } from '../../shared/http/error-handler.js';
import { pageMeta, type PaginationInput } from '../../shared/http/pagination.js';
import type { AddTeamMemberInput, TeamNameInput } from './team.schemas.js';
import { TeamRepository } from './team.repository.js';
import { appendRealtimeEvents } from '../realtime/outbox.js';

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

function teamDto(team: { id: string; workspaceId: string; name: string; createdAt: Date; updatedAt: Date }) {
  return { id: team.id, workspaceId: team.workspaceId, name: team.name, createdAt: team.createdAt.toISOString(), updatedAt: team.updatedAt.toISOString() };
}

export class TeamService {
  private readonly repository: TeamRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.repository = new TeamRepository(prisma);
  }

  async list(userId: string, workspaceId: string, pagination: PaginationInput) {
    const workspaceMember = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { role: true },
    });
    if (!workspaceMember) throw resourceNotFound();
    const [teams, total] = await this.repository.list(workspaceId, userId, workspaceMember.role !== 'MEMBER', pagination);
    return { data: teams.map(teamDto), meta: pageMeta(pagination, total) };
  }

  async create(userId: string, workspaceId: string, input: TeamNameInput) {
    const team = await runTransactionWithRetry(this.prisma, async (tx) => {
      await requireWorkspaceRole(tx, workspaceId, userId, WORKSPACE_ADMIN_ROLES);
      const team = await tx.team.create({
        data: { workspaceId, name: input.name },
        select: { id: true, workspaceId: true, name: true, createdAt: true, updatedAt: true },
      });
      await appendRealtimeEvents(tx, [{
        eventType: 'workspace.structure_changed', workspaceId, resourceId: team.id,
        payload: { resourceType: 'team', operation: 'created' },
      }]);
      return team;
    });
    return teamDto(team);
  }

  async get(userId: string, workspaceId: string, teamId: string) {
    const membership = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { role: true },
    });
    if (!membership) throw resourceNotFound();
    const team = await this.repository.findVisible(this.prisma, workspaceId, teamId, userId, membership.role !== 'MEMBER');
    if (!team) throw resourceNotFound();
    return teamDto(team);
  }

  async update(userId: string, workspaceId: string, teamId: string, input: TeamNameInput) {
    return runTransactionWithRetry(this.prisma, async (tx) => {
      await requireWorkspaceRole(tx, workspaceId, userId, WORKSPACE_ADMIN_ROLES);
      const visible = await this.repository.findVisible(tx, workspaceId, teamId, userId, true);
      if (!visible) throw resourceNotFound();
      const team = await tx.team.update({ where: { id: teamId }, data: { name: input.name } });
      await appendRealtimeEvents(tx, [{
        eventType: 'workspace.structure_changed', workspaceId, teamId, resourceId: teamId,
        payload: { resourceType: 'team', operation: 'updated' },
      }]);
      return teamDto(team);
    });
  }

  async listMembers(userId: string, workspaceId: string, teamId: string, pagination: PaginationInput) {
    return runTransactionWithRetry(this.prisma, async (tx) => {
      const membership = await tx.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
        select: { role: true },
      });
      if (!membership) throw resourceNotFound();
      const team = await this.repository.findVisible(tx, workspaceId, teamId, userId, membership.role !== 'MEMBER');
      if (!team) throw resourceNotFound();
      const [members, total] = await this.repository.listMembers(tx, teamId, pagination);
      return {
        data: members.map(({ workspaceMember, createdAt }) => ({
          ...workspaceMember.user,
          createdAt: createdAt.toISOString(),
        })),
        meta: pageMeta(pagination, total),
      };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async addMember(actorId: string, workspaceId: string, teamId: string, input: AddTeamMemberInput) {
    try {
      return await runTransactionWithRetry(this.prisma, async (tx) => {
        await requireWorkspaceRole(tx, workspaceId, actorId, WORKSPACE_ADMIN_ROLES);
        const team = await tx.team.findFirst({ where: { id: teamId, workspaceId }, select: { id: true } });
        if (!team) throw resourceNotFound();
        const target = await lockWorkspaceMember(tx, workspaceId, input.userId, 'KEY SHARE');
        if (!target) throw new HttpError(400, 'INVALID_TEAM_MEMBER', 'The user is not a workspace member.');
        const member = await tx.teamMember.create({
          data: { workspaceId, teamId, userId: input.userId },
          select: {
            createdAt: true,
            workspaceMember: { select: { user: { select: { id: true, email: true, displayName: true } } } },
          },
        });
        await appendRealtimeEvents(tx, [{
          eventType: 'team.roster_changed', workspaceId, teamId,
          payload: { operation: 'member_added' },
        }, {
          eventType: 'access.changed', workspaceId, teamId, targetUserId: input.userId, resourceId: teamId,
          payload: { reason: 'team_membership' },
        }]);
        return { ...member.workspaceMember.user, createdAt: member.createdAt.toISOString() };
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new HttpError(409, 'MEMBER_ALREADY_EXISTS', 'The user is already a team member.');
      throw error;
    }
  }

  async removeMember(actorId: string, workspaceId: string, teamId: string, targetId: string): Promise<void> {
    await runTransactionWithRetry(this.prisma, async (tx) => {
      await requireWorkspaceRole(tx, workspaceId, actorId, WORKSPACE_ADMIN_ROLES);
      const team = await tx.team.findFirst({ where: { id: teamId, workspaceId }, select: { id: true } });
      if (!team) throw resourceNotFound();
      const target = await lockTeamMember(tx, teamId, targetId, 'UPDATE');
      if (!target || target.workspace_id !== workspaceId) throw resourceNotFound();
      await lockAssignedTasks(tx, workspaceId, targetId, teamId);
      const assignments = await tx.task.updateMany({ where: { workspaceId, teamId, assigneeId: targetId }, data: { assigneeId: null } });
      await tx.teamMember.delete({ where: { teamId_userId: { teamId, userId: targetId } } });
      await appendRealtimeEvents(tx, [
        { eventType: 'team.roster_changed', workspaceId, teamId, payload: { operation: 'member_removed' } },
        { eventType: 'access.changed', workspaceId, teamId, targetUserId: targetId, resourceId: teamId, payload: { reason: 'team_membership' } },
        ...(assignments.count > 0 ? [{ eventType: 'team.tasks_changed' as const, workspaceId, teamId, payload: { operation: 'assignments_changed' as const } }] : []),
      ]);
    });
  }
}
