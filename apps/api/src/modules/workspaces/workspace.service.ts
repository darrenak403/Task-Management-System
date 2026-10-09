import type { PrismaClient } from '../../generated/prisma/client.js';
import { runTransactionWithRetry } from '../../shared/db/transaction.js';
import { HttpError } from '../../shared/http/error-handler.js';
import { pageMeta, type PaginationInput } from '../../shared/http/pagination.js';
import { lockAssignedTasks, lockTeamMembersForWorkspaceUser } from '../../shared/authorization/locks.js';
import { forbidden, requireWorkspaceMemberPair, requireWorkspaceRole, resourceNotFound, WORKSPACE_ADMIN_ROLES } from '../../shared/authorization/policy.js';
import type { AddWorkspaceMemberInput, UpdateWorkspaceMemberInput, WorkspaceNameInput } from './workspace.schemas.js';
import { WorkspaceRepository } from './workspace.repository.js';
import { appendRealtimeEvents } from '../realtime/outbox.js';

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

function workspaceDto(workspace: { id: string; name: string; createdAt: Date; updatedAt: Date }, role: string) {
  return { id: workspace.id, name: workspace.name, role, createdAt: workspace.createdAt.toISOString(), updatedAt: workspace.updatedAt.toISOString() };
}

export class WorkspaceService {
  private readonly repository: WorkspaceRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.repository = new WorkspaceRepository(prisma);
  }

  async list(userId: string, pagination: PaginationInput) {
    const [memberships, total] = await this.repository.listForUser(userId, pagination);
    return {
      data: memberships.map(({ workspace, role }) => workspaceDto(workspace, role)),
      meta: pageMeta(pagination, total),
    };
  }

  async create(userId: string, input: WorkspaceNameInput) {
    const workspace = await runTransactionWithRetry(this.prisma, async (tx) => {
      const created = await tx.workspace.create({ data: { name: input.name } });
      await tx.workspaceMember.create({ data: { workspaceId: created.id, userId, role: 'OWNER' } });
      await appendRealtimeEvents(tx, [{
        eventType: 'workspace.structure_changed', workspaceId: created.id, resourceId: created.id,
        payload: { resourceType: 'workspace', operation: 'created' },
      }]);
      return created;
    });
    return workspaceDto(workspace, 'OWNER');
  }

  async get(userId: string, workspaceId: string) {
    const membership = await this.repository.findMembership(this.prisma, workspaceId, userId);
    if (!membership) throw resourceNotFound();
    return workspaceDto(membership.workspace, membership.role);
  }

  async update(userId: string, workspaceId: string, input: WorkspaceNameInput) {
    const result = await runTransactionWithRetry(this.prisma, async (tx) => {
      const role = await requireWorkspaceRole(tx, workspaceId, userId, WORKSPACE_ADMIN_ROLES);
      const workspace = await tx.workspace.update({ where: { id: workspaceId }, data: { name: input.name } });
      await appendRealtimeEvents(tx, [{
        eventType: 'workspace.structure_changed', workspaceId, resourceId: workspaceId,
        payload: { resourceType: 'workspace', operation: 'updated' },
      }]);
      return workspaceDto(workspace, role);
    });
    return result;
  }

  async listMembers(userId: string, workspaceId: string, pagination: PaginationInput) {
    return runTransactionWithRetry(this.prisma, async (tx) => {
      await requireWorkspaceRole(tx, workspaceId, userId, WORKSPACE_ADMIN_ROLES);
      const [members, total] = await this.repository.listMembers(tx, workspaceId, pagination);
      return {
        data: members.map(({ user, role, createdAt }) => ({
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          role,
          createdAt: createdAt.toISOString(),
        })),
        meta: pageMeta(pagination, total),
      };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async addMember(userId: string, workspaceId: string, input: AddWorkspaceMemberInput) {
    try {
      return await runTransactionWithRetry(this.prisma, async (tx) => {
        await requireWorkspaceRole(tx, workspaceId, userId, WORKSPACE_ADMIN_ROLES);
        const target = await this.repository.findUserByEmail(tx, input.email);
        if (!target) throw new HttpError(404, 'USER_NOT_FOUND', 'The requested user was not found.');
        const member = await tx.workspaceMember.create({
          data: { workspaceId, userId: target.id, role: 'MEMBER' },
          select: {
            role: true,
            createdAt: true,
            user: { select: { id: true, email: true, displayName: true } },
          },
        });
        await appendRealtimeEvents(tx, [
          { eventType: 'workspace.structure_changed', workspaceId, resourceId: target.id, payload: { resourceType: 'membership', operation: 'added' } },
          { eventType: 'access.changed', workspaceId, targetUserId: target.id, resourceId: workspaceId, payload: { reason: 'workspace_membership' } },
        ]);
        return { ...member.user, role: member.role, createdAt: member.createdAt.toISOString() };
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new HttpError(409, 'MEMBER_ALREADY_EXISTS', 'The user is already a workspace member.');
      throw error;
    }
  }

  async updateMember(
    actorId: string,
    workspaceId: string,
    targetId: string,
    input: UpdateWorkspaceMemberInput,
  ) {
    if (actorId === targetId) throw forbidden();
    return runTransactionWithRetry(this.prisma, async (tx) => {
      const { actorRole, targetRole } = await requireWorkspaceMemberPair(
        tx,
        workspaceId,
        actorId,
        targetId,
        ['OWNER'],
      );
      if (actorRole !== 'OWNER' || targetRole === 'OWNER') throw forbidden();
      const member = await tx.workspaceMember.update({
        where: { workspaceId_userId: { workspaceId, userId: targetId } },
        data: { role: input.role },
        select: {
          role: true,
          createdAt: true,
          user: { select: { id: true, email: true, displayName: true } },
        },
      });
      await appendRealtimeEvents(tx, [
        { eventType: 'workspace.structure_changed', workspaceId, resourceId: targetId, payload: { resourceType: 'membership', operation: 'role_changed' } },
        { eventType: 'access.changed', workspaceId, targetUserId: targetId, resourceId: workspaceId, payload: { reason: 'workspace_role' } },
      ]);
      return { ...member.user, role: member.role, createdAt: member.createdAt.toISOString() };
    });
  }

  async removeMember(actorId: string, workspaceId: string, targetId: string): Promise<void> {
    if (actorId === targetId) throw forbidden();
    await runTransactionWithRetry(this.prisma, async (tx) => {
      const { actorRole, targetRole } = await requireWorkspaceMemberPair(
        tx,
        workspaceId,
        actorId,
        targetId,
        WORKSPACE_ADMIN_ROLES,
      );
      if (targetRole === 'OWNER' || (actorRole === 'ADMIN' && targetRole !== 'MEMBER')) throw forbidden();

      await lockTeamMembersForWorkspaceUser(tx, workspaceId, targetId);
      await lockAssignedTasks(tx, workspaceId, targetId);
      const affectedTeams = await tx.task.findMany({
        where: { workspaceId, assigneeId: targetId },
        select: { teamId: true },
        distinct: ['teamId'],
      });
      await tx.task.updateMany({ where: { workspaceId, assigneeId: targetId }, data: { assigneeId: null } });
      await tx.teamMember.deleteMany({ where: { workspaceId, userId: targetId } });
      const removed = await tx.workspaceMember.deleteMany({ where: { workspaceId, userId: targetId } });
      if (removed.count === 0) throw resourceNotFound();
      await appendRealtimeEvents(tx, [
        { eventType: 'workspace.structure_changed', workspaceId, resourceId: targetId, payload: { resourceType: 'membership', operation: 'removed' } },
        { eventType: 'access.changed', workspaceId, targetUserId: targetId, resourceId: workspaceId, payload: { reason: 'workspace_membership' } },
        ...affectedTeams.map(({ teamId }) => ({
          eventType: 'team.tasks_changed' as const,
          workspaceId,
          teamId,
          payload: { operation: 'assignments_changed' as const },
        })),
      ]);
    });
  }
}
