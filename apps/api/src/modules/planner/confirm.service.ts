import { createHash, randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { HttpError } from '../../shared/http/error-handler.js';
import { resourceNotFound } from '../../shared/authorization/policy.js';
import { runTransactionWithRetry } from '../../shared/db/transaction.js';
import { appendRealtimeEvents } from '../realtime/outbox.js';
import type { PlannerContextService } from './context.service.js';
import { planDraftContentSchema, type ConfirmPlanRequest, type PlanDraftContent } from './version.schemas.js';

type Scope = { workspaceId: string; teamId: string };
type ImportResult = { statusCode: 200 | 201; data: unknown };
const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

export class AiPlanConfirmService {
  constructor(private readonly prisma: PrismaClient, private readonly context: PlannerContextService) {}

  async confirm(userId: string, scope: Scope, planId: string, input: ConfirmPlanRequest): Promise<ImportResult> {
    const selectedItemIds = [...input.selectedItemIds].sort((left, right) => left.localeCompare(right));
    const payloadHash = hashJson({ versionId: input.versionId, selectedItemIds });

    // This receipt read intentionally precedes version, assignee, context, and task validation.
    await this.context.assertCurrentAccess(userId, scope.workspaceId, scope.teamId);
    const planVisible = await this.prisma.aiPlan.findFirst({
      where: { id: planId, creatorId: userId, ...scope }, select: { id: true },
    });
    if (!planVisible) throw resourceNotFound();
    const priorReceipt = await this.prisma.aiImportReceipt.findUnique({ where: { planId } });
    if (priorReceipt) return replayReceipt(priorReceipt, input, payloadHash);

    // Read assignee IDs only as lock hints. The exact version and item data are checked again after receipt lookup.
    const versionHint = await this.prisma.aiPlanVersion.findFirst({
      where: { id: input.versionId, planId }, select: { draft: true },
    });
    const hintDraft = versionHint ? parseDraft(versionHint.draft) : null;
    const selectedSet = new Set(selectedItemIds);
    const assigneeHints = [...new Set(hintDraft?.items.flatMap((item) =>
      selectedSet.has(item.id) && item.assigneeId ? [item.assigneeId] : []) ?? [])];

    const committed = await runTransactionWithRetry(this.prisma, async (tx): Promise<ImportResult> => {
      const lockedAssigneeIds = await this.context.lockAndCheckAccess(tx, userId, scope.workspaceId, scope.teamId, {
        teamLockMode: 'UPDATE', additionalMemberIds: assigneeHints, validateAdditionalMemberIds: false,
      });
      const planRows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM ai_plans
        WHERE id = ${planId}::uuid AND creator_id = ${userId}::uuid
          AND workspace_id = ${scope.workspaceId}::uuid AND team_id = ${scope.teamId}::uuid
        FOR UPDATE
      `;
      if (!planRows[0]) throw resourceNotFound();

      const receipt = await tx.aiImportReceipt.findUnique({ where: { planId } });
      if (receipt) return replayReceipt(receipt, input, payloadHash);

      const plan = await tx.aiPlan.findUniqueOrThrow({ where: { id: planId } });
      if (plan.status !== 'DRAFT' || plan.expiresAt <= new Date() || plan.purgedAt) {
        throw new HttpError(410, 'PLAN_EXPIRED', 'This draft plan is no longer available for import.');
      }
      if (plan.activeVersionId !== input.versionId) {
        throw new HttpError(409, 'VERSION_CONFLICT', 'Confirm the exact active plan version after reloading the plan.');
      }
      const version = await tx.aiPlanVersion.findFirst({ where: { id: input.versionId, planId } });
      if (!version) throw resourceNotFound();
      const draft = parseDraft(version.draft);
      if (!draft) throw new HttpError(410, 'VERSION_EXPIRED', 'This plan version is no longer available.');
      const selectedItems = draft.items.filter((item) => selectedSet.has(item.id));
      const persistedSelection = draft.items.filter((item) => item.selected).map((item) => item.id).sort((left, right) => left.localeCompare(right));
      if (selectedItems.length !== selectedItemIds.length || !sameStrings(persistedSelection, selectedItemIds)) {
        throw new HttpError(409, 'SELECTION_CONFLICT', 'Save the selected task set as a new version before importing.');
      }

      const itemIds = new Set(draft.items.map((item) => item.id));
      const selectedIds = new Set(selectedItems.map((item) => item.id));
      const contextTasks = readContextTasks(version.contextSnapshot);
      const contextIds = new Set(contextTasks.map((task) => task.id));
      const startDate = readStartDate(version.inputSnapshot);
      const contextTasksById = new Map(contextTasks.map((task) => [task.id, task]));
      for (const item of selectedItems) {
        for (const dependencyId of item.dependencies) {
          if (itemIds.has(dependencyId) && !selectedIds.has(dependencyId)) {
            throw new HttpError(422, 'DEPENDENCY_NOT_SELECTED', 'Select every planned prerequisite required by an imported task.');
          }
          if (!itemIds.has(dependencyId) && !contextIds.has(dependencyId)) {
            throw new HttpError(422, 'INVALID_DEPENDENCY', 'Every dependency must belong to this plan or its reviewed team context.');
          }
          const prerequisite = itemIds.has(dependencyId)
            ? draft.items.find((candidate) => candidate.id === dependencyId)
            : contextTasksById.get(dependencyId);
          const dependentWindow = getDraftWindow(item.schedule, startDate);
          const prerequisiteWindow = prerequisite && 'schedule' in prerequisite
            ? getDraftWindow(prerequisite.schedule, startDate)
            : prerequisite ? getTaskWindow(prerequisite, startDate) : null;
          if (dependentWindow && prerequisiteWindow && dependentWindow.unit === prerequisiteWindow.unit && dependentWindow.start <= prerequisiteWindow.end) {
            throw new HttpError(422, 'INVALID_PLAN_SCHEDULE', 'A dependent task must start after its prerequisite finishes.');
          }
        }
      }

      const contextLockIds = contextTasks.map((task) => task.id).sort((left, right) => left.localeCompare(right));
      if (contextLockIds.length > 0) {
        await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM tasks
          WHERE workspace_id = ${scope.workspaceId}::uuid AND team_id = ${scope.teamId}::uuid
            AND id = ANY(${contextLockIds}::uuid[])
          ORDER BY id FOR SHARE
        `;
      }
      if (contextTasks.length > 0) {
        const currentContext = await tx.task.findMany({
          where: { id: { in: contextTasks.map((task) => task.id) }, workspaceId: scope.workspaceId, teamId: scope.teamId },
          select: { id: true, updatedAt: true },
        });
        const byId = new Map(currentContext.map((task) => [task.id, task.updatedAt.toISOString()]));
        if (contextTasks.some((task) => byId.get(task.id) !== task.updatedAt)) {
          throw new HttpError(409, 'AI_CONTEXT_STALE', 'A task included in the reviewed context has changed. Refresh context and review a new plan.');
        }
      }

      const assignees = [...new Set(selectedItems.flatMap((item) => item.assigneeId ? [item.assigneeId] : []))];
      if (assignees.some((assigneeId) => !lockedAssigneeIds.has(assigneeId))) {
        throw new HttpError(409, 'INVALID_ASSIGNEE', 'An assigned member is no longer in this team.');
      }

      const now = new Date();
      const idMap = new Map(selectedItems.map((item) => [item.id, randomUUID()]));
      const tasks = selectedItems.map((item) => ({
        id: idMap.get(item.id) ?? randomUUID(),
        workspaceId: scope.workspaceId,
        teamId: scope.teamId,
        createdBy: userId,
        assigneeId: item.assigneeId,
        title: item.title,
        description: item.description,
        status: 'TODO' as const,
        priority: item.priority,
        dueDate: item.schedule.mode === 'ABSOLUTE' ? dateValue(item.schedule.dueDate) : null,
        completionCriteria: item.completionCriteria,
        priorityReason: item.priorityReason,
        estimateMinMinutes: item.estimateMinMinutes,
        estimateMaxMinutes: item.estimateMaxMinutes,
        plannedStartDate: item.schedule.mode === 'ABSOLUTE' ? dateValue(item.schedule.startDate) : null,
        relativeStartDay: item.schedule.mode === 'RELATIVE' ? item.schedule.startDay : null,
        relativeDueDay: item.schedule.mode === 'RELATIVE' ? item.schedule.dueDay : null,
        sourcePlanId: planId,
        sourceItemId: item.id,
        createdAt: now,
        updatedAt: now,
      }));
      await tx.task.createMany({ data: tasks });

      const checklistItems = selectedItems.flatMap((item) => item.checklist.map((title, position) => ({
        taskId: idMap.get(item.id) ?? '', position, title, isCompleted: false,
      })));
      if (checklistItems.length > 0) await tx.taskChecklist.createMany({ data: checklistItems });

      const dependencies = selectedItems.flatMap((item) => item.dependencies.map((dependencyId) => ({
        workspaceId: scope.workspaceId,
        teamId: scope.teamId,
        taskId: idMap.get(item.id) ?? '',
        prerequisiteId: idMap.get(dependencyId) ?? dependencyId,
      })));
      if (dependencies.length > 0) await tx.taskDependency.createMany({ data: dependencies });

      const itemTaskMap = selectedItems.map((item) => ({ itemId: item.id, taskId: idMap.get(item.id) ?? '' }));
      const response = {
        planId,
        versionId: version.id,
        requestKey: input.requestKey,
        createdCount: tasks.length,
        checklistItemCount: checklistItems.length,
        dependencyCount: dependencies.length,
        itemTaskMap,
        importedAt: now.toISOString(),
      };
      await tx.aiImportReceipt.create({
        data: {
          planId,
          confirmedVersionId: version.id,
          requestKey: input.requestKey,
          payloadHash,
          itemTaskMap: json(itemTaskMap),
          response: json(response),
        },
      });
      await tx.aiPlan.update({ where: { id: planId }, data: { status: 'IMPORTED', importedAt: now } });
      await appendRealtimeEvents(tx, [
        ...tasks.map((task) => ({
          eventType: 'team.tasks_changed' as const,
          workspaceId: scope.workspaceId,
          teamId: scope.teamId,
          resourceId: task.id,
          payload: { operation: 'created' as const, revision: now.toISOString() },
        })),
        {
          eventType: 'planner.plan_changed' as const,
          workspaceId: scope.workspaceId,
          teamId: scope.teamId,
          targetUserId: userId,
          resourceId: planId,
          payload: { versionId: version.id, versionOrdinal: version.ordinal, summary: `Plan imported as ${tasks.length} tasks.` },
        },
      ]);
      return { statusCode: 201, data: response };
    }, { isolationLevel: 'ReadCommitted', timeout: 15_000, maxWait: 5_000 });
    return committed;
  }
}

function parseDraft(value: Prisma.JsonValue): PlanDraftContent | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { schemaVersion: _schemaVersion, source: _source, fieldLocks: _fieldLocks, ...content } = value;
  void _schemaVersion;
  void _source;
  void _fieldLocks;
  const parsed = planDraftContentSchema.safeParse(content);
  return parsed.success ? parsed.data : null;
}

type ContextTask = {
  id: string; updatedAt: string; dueDate: string | null; plannedStartDate: string | null;
  relativeStartDay: number | null; relativeDueDay: number | null;
};

function readContextTasks(value: Prisma.JsonValue | null): ContextTask[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || !('tasks' in value) || !Array.isArray(value.tasks)) return [];
  return value.tasks.flatMap((task) => {
    if (typeof task !== 'object' || task === null || !('id' in task) || !('updatedAt' in task) ||
      typeof task.id !== 'string' || typeof task.updatedAt !== 'string') return [];
    const dateValue = (key: 'dueDate' | 'plannedStartDate') => key in task && typeof task[key] === 'string' ? task[key] : null;
    const dayValue = (key: 'relativeStartDay' | 'relativeDueDay') => key in task && typeof task[key] === 'number' ? task[key] : null;
    return [{ id: task.id, updatedAt: task.updatedAt, dueDate: dateValue('dueDate'), plannedStartDate: dateValue('plannedStartDate'), relativeStartDay: dayValue('relativeStartDay'), relativeDueDay: dayValue('relativeDueDay') }];
  });
}

type ScheduleWindow = { unit: 'date' | 'day'; start: string | number; end: string | number };

function getDraftWindow(schedule: PlanDraftContent['items'][number]['schedule'], startDate: string | null): ScheduleWindow | null {
  if (schedule.mode === 'ABSOLUTE') {
    if (!schedule.startDate && !schedule.dueDate) return null;
    return { unit: 'date', start: schedule.startDate ?? schedule.dueDate ?? '', end: schedule.dueDate ?? schedule.startDate ?? '' };
  }
  if (schedule.mode !== 'RELATIVE' || (schedule.startDay === null && schedule.dueDay === null)) return null;
  const start = schedule.startDay ?? schedule.dueDay ?? 1;
  const end = schedule.dueDay ?? schedule.startDay ?? 1;
  return startDate
    ? { unit: 'date', start: addDays(startDate, start - 1), end: addDays(startDate, end - 1) }
    : { unit: 'day', start, end };
}

function getTaskWindow(task: ContextTask, startDate: string | null): ScheduleWindow | null {
  if (task.plannedStartDate || task.dueDate) {
    return { unit: 'date', start: task.plannedStartDate ?? task.dueDate ?? '', end: task.dueDate ?? task.plannedStartDate ?? '' };
  }
  if (task.relativeStartDay !== null || task.relativeDueDay !== null) {
    const start = task.relativeStartDay ?? task.relativeDueDay ?? 1;
    const end = task.relativeDueDay ?? task.relativeStartDay ?? 1;
    return startDate
      ? { unit: 'date', start: addDays(startDate, start - 1), end: addDays(startDate, end - 1) }
      : { unit: 'day', start, end };
  }
  return null;
}

function readStartDate(value: Prisma.JsonValue): string | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    'startDate' in value && typeof value.startDate === 'string' ? value.startDate : null;
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function replayReceipt(receipt: { requestKey: string; confirmedVersionId: string; payloadHash: string; response: Prisma.JsonValue }, input: ConfirmPlanRequest, payloadHash: string): ImportResult {
  if (receipt.requestKey !== input.requestKey || receipt.confirmedVersionId !== input.versionId || receipt.payloadHash !== payloadHash) {
    throw new HttpError(409, 'PLAN_ALREADY_IMPORTED', 'This plan was already imported with a different version, selection, or request key.');
  }
  return { statusCode: 200, data: receipt.response };
}

function dateValue(value: string | null): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
