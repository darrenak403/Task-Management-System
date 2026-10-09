import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import type { PaginationInput } from '../../shared/http/pagination.js';
import { taskPublicSelect } from './task.dto.js';
import type { ListTasksQuery } from './task.schemas.js';

export class TaskRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(client: Prisma.TransactionClient, where: Prisma.TaskWhereInput, pagination: PaginationInput) {
    const skip = (pagination.page - 1) * pagination.pageSize;
    return Promise.all([
      client.task.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: pagination.pageSize,
        select: taskPublicSelect,
      }),
      client.task.count({ where }),
    ]);
  }

  async listByLiteralSearch(
    client: Prisma.TransactionClient,
    workspaceId: string,
    userId: string,
    canManageWorkspace: boolean,
    query: ListTasksQuery,
  ) {
    const predicates: Prisma.Sql[] = [
      Prisma.sql`task.workspace_id = ${workspaceId}::uuid`,
      Prisma.sql`strpos(lower(task.title), lower(${query.q ?? ''})) > 0`,
    ];
    if (query.teamId) predicates.push(Prisma.sql`task.team_id = ${query.teamId}::uuid`);
    if (query.assigneeId) predicates.push(Prisma.sql`task.assignee_id = ${query.assigneeId}::uuid`);
    if (query.status) predicates.push(Prisma.sql`task.status = ${query.status}::task_status`);
    if (query.priority) predicates.push(Prisma.sql`task.priority = ${query.priority}::task_priority`);
    if (!canManageWorkspace) {
      predicates.push(Prisma.sql`EXISTS (
        SELECT 1 FROM team_members AS membership
        WHERE membership.workspace_id = task.workspace_id
          AND membership.team_id = task.team_id
          AND membership.user_id = ${userId}::uuid
      )`);
    }
    const where = Prisma.join(predicates, ' AND ');
    const offset = (query.page - 1) * query.pageSize;
    const [ids, countRows] = await Promise.all([
      client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT task.id FROM tasks AS task
        WHERE ${where}
        ORDER BY task.created_at DESC, task.id DESC
        LIMIT ${query.pageSize} OFFSET ${offset}
      `),
      client.$queryRaw<Array<{ total: string }>>(Prisma.sql`
        SELECT COUNT(*)::text AS total FROM tasks AS task
        WHERE ${where}
      `),
    ]);
    const pageIds = ids.map(({ id }) => id);
    const rows = pageIds.length === 0
      ? []
      : await client.task.findMany({
          where: { id: { in: pageIds } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: taskPublicSelect,
        });
    return [rows, Number(countRows[0]?.total ?? '0')] as const;
  }

  findInTeam(client: Prisma.TransactionClient | PrismaClient, workspaceId: string, teamId: string, taskId: string) {
    return client.task.findFirst({
      where: { id: taskId, workspaceId, teamId },
      select: taskPublicSelect,
    });
  }
}
