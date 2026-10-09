import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { resourceNotFound } from '../../shared/authorization/policy.js';
import { HttpError } from '../../shared/http/error-handler.js';
import type { CreatePlanInput } from './planner.schemas.js';

type Transaction = Prisma.TransactionClient;
export type PlannerContextSnapshot = {
  capturedAt: string;
  tasks: Array<{
    id: string; title: string; description: string; status: string; priority: string; updatedAt: string;
    assigneeId: string | null; estimateMinMinutes: number | null; estimateMaxMinutes: number | null;
    dueDate: string | null; plannedStartDate: string | null; relativeStartDay: number | null; relativeDueDay: number | null;
  }>;
  members: Array<{ id: string; alias: string; capacityMinutesPerDay: number | null; role: string | null; workingDays: number[] | null }>;
};

export class PlannerContextService {
  constructor(private readonly prisma: PrismaClient) {}

  async assertCurrentAccess(userId: string, workspaceId: string, teamId: string): Promise<void> {
    await this.prisma.$transaction((tx) => this.lockAndCheckAccess(tx, userId, workspaceId, teamId));
  }

  async lockAndLoad(
    tx: Transaction,
    userId: string,
    workspaceId: string,
    teamId: string,
    input: CreatePlanInput,
  ): Promise<PlannerContextSnapshot> {
    await this.lockAndCheckAccess(tx, userId, workspaceId, teamId);
    const tasks = input.includeExistingTasks && input.existingTaskIds.length > 0
      ? await tx.task.findMany({
        where: { id: { in: input.existingTaskIds }, workspaceId, teamId },
        select: {
          id: true, title: true, description: true, status: true, priority: true, updatedAt: true,
          assigneeId: true, estimateMinMinutes: true, estimateMaxMinutes: true, dueDate: true,
          plannedStartDate: true, relativeStartDay: true, relativeDueDay: true,
        },
      })
      : [];
    if (tasks.length !== input.existingTaskIds.length) throw resourceNotFound();

    const members = input.includeMembers && input.memberIds.length > 0
      ? await tx.teamMember.findMany({
        where: { teamId, userId: { in: input.memberIds }, workspaceId },
        orderBy: { userId: 'asc' },
        select: { userId: true },
      })
      : [];
    if (members.length !== input.memberIds.length) throw resourceNotFound();

    const profileById = new Map(input.memberProfiles.map((profile) => [profile.userId, profile]));
    const snapshot: PlannerContextSnapshot = {
      capturedAt: new Date().toISOString(),
      tasks: tasks
        .sort((left, right) => input.existingTaskIds.indexOf(left.id) - input.existingTaskIds.indexOf(right.id))
        .map((task) => ({
        ...task,
        updatedAt: task.updatedAt.toISOString(),
        dueDate: task.dueDate?.toISOString().slice(0, 10) ?? null,
        plannedStartDate: task.plannedStartDate?.toISOString().slice(0, 10) ?? null,
        })),
      members: members.map((member, index) => ({
        id: member.userId,
        alias: `member-${String(index + 1).padStart(2, '0')}`,
        capacityMinutesPerDay: profileById.get(member.userId)?.capacityMinutesPerDay ?? null,
        role: profileById.get(member.userId)?.role ?? null,
        workingDays: profileById.has(member.userId) ? profileById.get(member.userId)?.workingDays ?? [] : null,
      })),
    };
    if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > 180_000) {
      throw new HttpError(413, 'AI_CONTEXT_TOO_LARGE', 'The selected context is too large. Choose fewer or shorter items.');
    }
    return snapshot;
  }

  async lockAndCheckAccess(
    tx: Transaction,
    userId: string,
    workspaceId: string,
    teamId: string,
    options: { teamLockMode?: 'KEY SHARE' | 'UPDATE'; additionalMemberIds?: string[]; validateAdditionalMemberIds?: boolean } = {},
  ): Promise<ReadonlySet<string>> {
    const memberships = await tx.$queryRaw<Array<{ role: string }>>`
      SELECT role::text AS role FROM workspace_members
      WHERE workspace_id = ${workspaceId}::uuid AND user_id = ${userId}::uuid
      FOR KEY SHARE
    `;
    const membership = memberships[0];
    if (!membership) throw resourceNotFound();

    const memberIds = [...new Set([
      ...(membership.role === 'MEMBER' ? [userId] : []),
      ...(options.additionalMemberIds ?? []),
    ])].sort((left, right) => left.localeCompare(right));
    const lockedMembers = new Set<string>();
    for (const memberId of memberIds) {
      const rows = await tx.$queryRaw<Array<{ user_id: string }>>`
        SELECT user_id FROM team_members
        WHERE workspace_id = ${workspaceId}::uuid AND team_id = ${teamId}::uuid AND user_id = ${memberId}::uuid
        FOR KEY SHARE
      `;
      if (rows[0]) lockedMembers.add(memberId);
    }
    if (membership.role === 'MEMBER' && !lockedMembers.has(userId)) throw resourceNotFound();

    const teams = options.teamLockMode === 'UPDATE'
      ? await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM teams WHERE workspace_id = ${workspaceId}::uuid AND id = ${teamId}::uuid FOR UPDATE
        `
      : await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM teams WHERE workspace_id = ${workspaceId}::uuid AND id = ${teamId}::uuid FOR KEY SHARE
        `;
    if (!teams[0]) throw resourceNotFound();

    if (options.validateAdditionalMemberIds !== false && (options.additionalMemberIds ?? []).some((memberId) => !lockedMembers.has(memberId))) {
      throw new HttpError(409, 'INVALID_ASSIGNEE', 'Every assignee must remain a member of this team.');
    }
    return lockedMembers;
  }
}
