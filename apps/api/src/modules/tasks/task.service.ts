import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { lockTask, lockTeamGraph, lockTeamMember } from '../../shared/authorization/locks.js';
import { forbidden, requireTeamMember, requireWorkspaceRole, resourceNotFound } from '../../shared/authorization/policy.js';
import { HttpError } from '../../shared/http/error-handler.js';
import { runTransactionWithRetry } from '../../shared/db/transaction.js';
import { pageMeta } from '../../shared/http/pagination.js';
import type { CreateTaskInput, ListTasksQuery, UpdateTaskInput } from './task.schemas.js';
import { TaskRepository } from './task.repository.js';
import { taskPublicSelect, toTaskDto } from './task.dto.js';
import { appendRealtimeEvents } from '../realtime/outbox.js';

function dateValue(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return new Date(`${value}T00:00:00.000Z`);
}

function scheduleFields(schedule: CreateTaskInput['schedule'], dueDate?: CreateTaskInput['dueDate']) {
  if (schedule?.mode === 'RELATIVE') {
    return {
      dueDate: null,
      plannedStartDate: null,
      relativeStartDay: schedule.startDay,
      relativeDueDay: schedule.dueDay,
    };
  }
  if (schedule?.mode === 'ABSOLUTE') {
    return {
      dueDate: dateValue(schedule.dueDate) ?? null,
      plannedStartDate: dateValue(schedule.startDate) ?? null,
      relativeStartDay: null,
      relativeDueDay: null,
    };
  }
  if (schedule?.mode === 'NONE') {
    return { dueDate: null, plannedStartDate: null, relativeStartDay: null, relativeDueDay: null };
  }
  return {
    dueDate: dateValue(dueDate) ?? null,
    plannedStartDate: null,
    relativeStartDay: null,
    relativeDueDay: null,
  };
}

async function replaceChecklist(
  tx: Prisma.TransactionClient,
  taskId: string,
  items: NonNullable<UpdateTaskInput['checklist']>,
  currentIds?: Set<string>,
): Promise<void> {
  if (currentIds) {
    const invalidId = items.find((item) => item.id && !currentIds.has(item.id));
    if (invalidId) throw new HttpError(422, 'INVALID_CHECKLIST_ITEM', 'Checklist item IDs must belong to this task.');
  }
  await tx.taskChecklist.deleteMany({ where: { taskId } });
  if (items.length > 0) {
    await tx.taskChecklist.createMany({
      data: items.map((item, position) => ({
        ...(item.id ? { id: item.id } : {}), taskId, position, title: item.title, isCompleted: item.isCompleted,
      })),
    });
  }
}

function invalidAssignee(): HttpError {
  return new HttpError(400, 'INVALID_ASSIGNEE', 'The assignee must be a member of this team.');
}

function visibleTaskWhere(
  workspaceId: string,
  userId: string,
  canManageWorkspace: boolean,
  query: ListTasksQuery,
): Prisma.TaskWhereInput {
  return {
    workspaceId,
    ...(query.teamId ? { teamId: query.teamId } : {}),
    ...(query.assigneeId ? { assigneeId: query.assigneeId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.priority ? { priority: query.priority } : {}),
    team: {
      workspaceId,
      ...(canManageWorkspace ? {} : { members: { some: { userId } } }),
    },
  };
}

export class TaskService {
  private readonly repository: TaskRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.repository = new TaskRepository(prisma);
  }

  async list(userId: string, workspaceId: string, query: ListTasksQuery) {
    return runTransactionWithRetry(this.prisma, async (tx) => {
      const membership = await tx.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
        select: { role: true },
      });
      if (!membership) throw resourceNotFound();

      if (query.teamId) {
        const team = await tx.team.findFirst({
          where: {
            id: query.teamId,
            workspaceId,
            ...(membership.role === 'MEMBER' ? { members: { some: { userId } } } : {}),
          },
          select: { id: true },
        });
        if (!team) throw resourceNotFound();
      }

      const where = visibleTaskWhere(workspaceId, userId, membership.role !== 'MEMBER', query);
      const [tasks, total] = query.q
        ? await this.repository.listByLiteralSearch(tx, workspaceId, userId, membership.role !== 'MEMBER', query)
        : await this.repository.list(tx, where, query);
      return { data: tasks.map(toTaskDto), meta: pageMeta(query, total) };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async create(userId: string, workspaceId: string, teamId: string, input: CreateTaskInput) {
    const task = await runTransactionWithRetry(this.prisma, async (tx) => {
      const role = await requireWorkspaceRole(tx, workspaceId, userId);
      const team = await tx.team.findFirst({ where: { id: teamId, workspaceId }, select: { id: true } });
      if (!team) throw resourceNotFound();
      if (role === 'MEMBER') await requireTeamMember(tx, workspaceId, teamId, userId);

      if (input.assigneeId) {
        const assignee = await lockTeamMember(tx, teamId, input.assigneeId, 'KEY SHARE');
        if (!assignee || assignee.workspace_id !== workspaceId) throw invalidAssignee();
      }

      const task = await tx.task.create({
        data: {
          workspaceId,
          teamId,
          createdBy: userId,
          assigneeId: input.assigneeId ?? null,
          title: input.title,
          description: input.description ?? '',
          status: input.status ?? 'TODO',
          priority: input.priority ?? 'MEDIUM',
          completionCriteria: input.completionCriteria ?? '',
          priorityReason: input.priorityReason ?? '',
          estimateMinMinutes: input.estimateMinMinutes ?? null,
          estimateMaxMinutes: input.estimateMaxMinutes ?? null,
          ...scheduleFields(input.schedule, input.dueDate),
        },
        select: taskPublicSelect,
      });
      if (input.checklist) await replaceChecklist(tx, task.id, input.checklist);
      const completeTask = input.checklist ? await this.repository.findInTeam(tx, workspaceId, teamId, task.id) : task;
      if (!completeTask) throw resourceNotFound();
      await appendRealtimeEvents(tx, [{
        eventType: 'team.tasks_changed', workspaceId, teamId, resourceId: completeTask.id,
        payload: { operation: 'created', revision: completeTask.updatedAt.toISOString() },
      }]);
      return completeTask;
    });
    return toTaskDto(task);
  }

  async get(userId: string, workspaceId: string, teamId: string, taskId: string) {
    const membership = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { role: true },
    });
    if (!membership) throw resourceNotFound();
    const task = await this.prisma.task.findFirst({
      where: {
        id: taskId,
        workspaceId,
        teamId,
        team: { workspaceId, ...(membership.role === 'MEMBER' ? { members: { some: { userId } } } : {}) },
      },
      select: taskPublicSelect,
    });
    if (!task) throw resourceNotFound();
    return toTaskDto(task);
  }

  async update(userId: string, workspaceId: string, teamId: string, taskId: string, input: UpdateTaskInput) {
    const task = await runTransactionWithRetry(this.prisma, async (tx) => {
      const role = await requireWorkspaceRole(tx, workspaceId, userId);
      const team = await tx.team.findFirst({ where: { id: teamId, workspaceId }, select: { id: true } });
      if (!team) throw resourceNotFound();
      if (role === 'MEMBER') await requireTeamMember(tx, workspaceId, teamId, userId);

      if (input.assigneeId) {
        const assignee = await lockTeamMember(tx, teamId, input.assigneeId, 'KEY SHARE');
        if (!assignee || assignee.workspace_id !== workspaceId) throw invalidAssignee();
      }
      if (!(await lockTask(tx, workspaceId, teamId, taskId))) throw resourceNotFound();

      const current = await this.repository.findInTeam(tx, workspaceId, teamId, taskId);
      if (!current) throw resourceNotFound();
      if (input.estimateMinMinutes !== undefined || input.estimateMaxMinutes !== undefined) {
        const minimum = input.estimateMinMinutes !== undefined ? input.estimateMinMinutes : current.estimateMinMinutes;
        const maximum = input.estimateMaxMinutes !== undefined ? input.estimateMaxMinutes : current.estimateMaxMinutes;
        if ((minimum === null) !== (maximum === null) || (minimum !== null && maximum !== null && minimum > maximum)) {
          throw new HttpError(422, 'INVALID_ESTIMATE_RANGE', 'Estimate bounds must both be set and maximum must be at least minimum.');
        }
      }
      const data: Prisma.TaskUncheckedUpdateInput = {};
      if (input.title !== undefined) data.title = input.title;
      if (input.description !== undefined) data.description = input.description;
      if (input.status !== undefined) data.status = input.status;
      if (input.priority !== undefined) data.priority = input.priority;
      if (input.schedule !== undefined) {
        Object.assign(data, scheduleFields(input.schedule));
      } else if (input.dueDate !== undefined) {
        Object.assign(data, scheduleFields(undefined, input.dueDate));
      }
      if (input.assigneeId !== undefined) data.assigneeId = input.assigneeId;
      if (input.completionCriteria !== undefined) data.completionCriteria = input.completionCriteria;
      if (input.priorityReason !== undefined) data.priorityReason = input.priorityReason;
      if (input.estimateMinMinutes !== undefined) data.estimateMinMinutes = input.estimateMinMinutes;
      if (input.estimateMaxMinutes !== undefined) data.estimateMaxMinutes = input.estimateMaxMinutes;
      if (input.checklist !== undefined && Object.keys(data).length === 0) data.updatedAt = new Date();

      await tx.task.update({ where: { id: current.id }, data, select: { id: true } });
      if (input.checklist !== undefined) {
        await replaceChecklist(tx, current.id, input.checklist, new Set(current.checklist.map((item) => item.id)));
      }
      const updated = await this.repository.findInTeam(tx, workspaceId, teamId, current.id);
      if (!updated) throw resourceNotFound();
      await appendRealtimeEvents(tx, [{
        eventType: 'team.tasks_changed', workspaceId, teamId, resourceId: updated.id,
        payload: {
          operation: input.assigneeId !== undefined && input.assigneeId !== current.assigneeId ? 'assignments_changed' : 'updated',
          revision: updated.updatedAt.toISOString(),
        },
      }]);
      return updated;
    });
    return toTaskDto(task);
  }

  async remove(userId: string, workspaceId: string, teamId: string, taskId: string): Promise<void> {
    await runTransactionWithRetry(this.prisma, async (tx) => {
      const role = await requireWorkspaceRole(tx, workspaceId, userId);
      const team = await tx.team.findFirst({ where: { id: teamId, workspaceId }, select: { id: true } });
      if (!team) throw resourceNotFound();
      if (role === 'MEMBER') await requireTeamMember(tx, workspaceId, teamId, userId);
      await lockTeamGraph(tx, workspaceId, teamId);
      if (!(await lockTask(tx, workspaceId, teamId, taskId))) throw resourceNotFound();

      const task = await this.repository.findInTeam(tx, workspaceId, teamId, taskId);
      if (!task) throw resourceNotFound();
      if (role === 'MEMBER' && task.createdBy !== userId) throw forbidden();
      if (await tx.taskDependency.count({ where: { workspaceId, teamId, prerequisiteId: taskId } }) > 0) {
        throw new HttpError(409, 'TASK_HAS_DEPENDENTS', 'Remove or reassign dependent tasks before deleting this prerequisite.');
      }
      await tx.task.delete({ where: { id: taskId } });
      await appendRealtimeEvents(tx, [{
        eventType: 'team.tasks_changed', workspaceId, teamId, resourceId: taskId,
        payload: { operation: 'deleted', revision: task.updatedAt.toISOString() },
      }]);
    });
  }
}
