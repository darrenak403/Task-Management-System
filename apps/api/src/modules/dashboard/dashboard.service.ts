import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { resourceNotFound } from '../../shared/authorization/policy.js';
import { runTransactionWithRetry } from '../../shared/db/transaction.js';
import { toTaskDto } from '../tasks/task.dto.js';
import { DashboardRepository } from './dashboard.repository.js';

const BUSINESS_TIME_ZONE = 'Asia/Ho_Chi_Minh';

function businessToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export class DashboardService {
  private readonly repository: DashboardRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.repository = new DashboardRepository(prisma);
  }

  async get(userId: string, workspaceId: string, requestedTeamId?: string) {
    return runTransactionWithRetry(this.prisma, async (tx) => {
      const membership = await tx.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
        select: { role: true },
      });
      if (!membership) throw resourceNotFound();

      if (requestedTeamId) {
        const team = await tx.team.findFirst({
          where: {
            id: requestedTeamId,
            workspaceId,
            ...(membership.role === 'MEMBER' ? { members: { some: { userId } } } : {}),
          },
          select: { id: true },
        });
        if (!team) throw resourceNotFound();
      }

      const allowedTeamFilter: Prisma.TaskWhereInput['team'] = {
        workspaceId,
        ...(membership.role === 'MEMBER' ? { members: { some: { userId } } } : {}),
      };
      const scope: Prisma.TaskWhereInput = {
        workspaceId,
        ...(requestedTeamId ? { teamId: requestedTeamId } : {}),
        team: allowedTeamFilter,
      };
      const today = businessToday();
      const through = addDays(today, 6);
      const upcomingWhere: Prisma.TaskWhereInput = {
        ...scope,
        status: { not: 'DONE' },
        dueDate: { gte: new Date(`${today}T00:00:00.000Z`), lte: new Date(`${through}T00:00:00.000Z`) },
      };

      const [statusCounts, upcomingTotal, upcoming] = await Promise.all([
        this.repository.countByStatus(tx, scope),
        this.repository.countUpcoming(tx, upcomingWhere),
        this.repository.listUpcoming(tx, upcomingWhere),
      ]);
      const byStatus = new Map(statusCounts.map(({ status, _count }) => [status, _count._all]));
      const todo = byStatus.get('TODO') ?? 0;
      const inProgress = byStatus.get('IN_PROGRESS') ?? 0;
      const done = byStatus.get('DONE') ?? 0;

      return {
        data: {
          scope: { workspaceId, teamId: requestedTeamId ?? null },
          counts: { total: todo + inProgress + done, todo, inProgress, done },
          upcoming: upcoming.map(toTaskDto),
          upcomingTotal,
          window: { from: today, to: through, timeZone: BUSINESS_TIME_ZONE },
        },
      };
    }, { isolationLevel: 'RepeatableRead' });
  }
}
