import type { PrismaClient } from '../../generated/prisma/client.js';
import { lockTask } from '../../shared/authorization/locks.js';
import { resourceNotFound } from '../../shared/authorization/policy.js';
import { HttpError } from '../../shared/http/error-handler.js';
import { runTransactionWithRetry } from '../../shared/db/transaction.js';
import { appendRealtimeEvents } from '../realtime/outbox.js';
import type { PlannerContextService } from '../planner/context.service.js';
import type { TaskDependenciesRequest } from './task.schemas.js';

export class TaskDependencyService {
  constructor(private readonly prisma: PrismaClient, private readonly context: PlannerContextService) {}

  async replace(userId: string, workspaceId: string, teamId: string, taskId: string, input: TaskDependenciesRequest) {
    return runTransactionWithRetry(this.prisma, async (tx) => {
      await this.context.lockAndCheckAccess(tx, userId, workspaceId, teamId, { teamLockMode: 'UPDATE' });
      if (!(await lockTask(tx, workspaceId, teamId, taskId))) throw resourceNotFound();
      const task = await tx.task.findFirst({
        where: { id: taskId, workspaceId, teamId },
        select: { id: true, updatedAt: true },
      });
      if (!task) throw resourceNotFound();
      if (task.updatedAt.toISOString() !== input.expectedUpdatedAt) {
        throw new HttpError(409, 'TASK_VERSION_CONFLICT', 'The task changed. Reload it before replacing dependencies.');
      }
      if (input.prerequisiteIds.includes(taskId)) {
        throw new HttpError(422, 'DEPENDENCY_CYCLE', 'A task cannot depend on itself.');
      }

      if (input.prerequisiteIds.length > 0) {
        const prerequisites = await tx.task.findMany({
          where: { id: { in: input.prerequisiteIds }, workspaceId, teamId },
          select: { id: true },
        });
        if (prerequisites.length !== input.prerequisiteIds.length) {
          throw new HttpError(422, 'INVALID_DEPENDENCY', 'Every prerequisite must be a task in the same team.');
        }
        const cycle = await tx.$queryRaw<Array<{ has_cycle: boolean }>>`
          WITH RECURSIVE ancestors(id) AS (
            SELECT unnest(${input.prerequisiteIds}::uuid[])
            UNION
            SELECT dependency.prerequisite_id
            FROM task_dependencies dependency
            JOIN ancestors ON dependency.task_id = ancestors.id
            WHERE dependency.workspace_id = ${workspaceId}::uuid AND dependency.team_id = ${teamId}::uuid
          )
          SELECT EXISTS(SELECT 1 FROM ancestors WHERE id = ${taskId}::uuid) AS has_cycle
        `;
        if (cycle[0]?.has_cycle) throw new HttpError(422, 'DEPENDENCY_CYCLE', 'The dependency graph cannot contain a cycle.');
      }

      await tx.taskDependency.deleteMany({ where: { workspaceId, teamId, taskId } });
      if (input.prerequisiteIds.length > 0) {
        await tx.taskDependency.createMany({
          data: input.prerequisiteIds.map((prerequisiteId) => ({ workspaceId, teamId, taskId, prerequisiteId })),
        });
      }
      const updated = await tx.task.update({ where: { id: taskId }, data: { updatedAt: new Date() }, select: { updatedAt: true } });
      await appendRealtimeEvents(tx, [{
        eventType: 'team.tasks_changed', workspaceId, teamId, resourceId: taskId,
        payload: { operation: 'updated', revision: updated.updatedAt.toISOString() },
      }]);
      return {
        data: {
          taskId,
          prerequisiteIds: [...input.prerequisiteIds].sort((left, right) => left.localeCompare(right)),
          updatedAt: updated.updatedAt.toISOString(),
        },
      };
    }, { isolationLevel: 'ReadCommitted', timeout: 10_000 });
  }
}
