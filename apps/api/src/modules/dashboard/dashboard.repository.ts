import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { taskPublicSelect } from '../tasks/task.dto.js';

export class DashboardRepository {
  constructor(private readonly prisma: PrismaClient) {}

  countByStatus(tx: Prisma.TransactionClient, where: Prisma.TaskWhereInput) {
    return tx.task.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    });
  }

  countUpcoming(tx: Prisma.TransactionClient, where: Prisma.TaskWhereInput) {
    return tx.task.count({ where });
  }

  listUpcoming(tx: Prisma.TransactionClient, where: Prisma.TaskWhereInput) {
    return tx.task.findMany({
      where,
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      take: 5,
      select: taskPublicSelect,
    });
  }
}
