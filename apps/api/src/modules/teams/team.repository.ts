import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import type { PaginationInput } from '../../shared/http/pagination.js';

type QueryClient = PrismaClient | Prisma.TransactionClient;

export class TeamRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(workspaceId: string, userId: string, canManageWorkspace: boolean, pagination: PaginationInput) {
    const where: Prisma.TeamWhereInput = {
      workspaceId,
      ...(canManageWorkspace ? {} : { members: { some: { userId } } }),
    };
    const skip = (pagination.page - 1) * pagination.pageSize;
    return Promise.all([
      this.prisma.team.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip,
        take: pagination.pageSize,
        select: { id: true, workspaceId: true, name: true, createdAt: true, updatedAt: true },
      }),
      this.prisma.team.count({ where }),
    ]);
  }

  findVisible(client: QueryClient, workspaceId: string, teamId: string, userId: string, canManageWorkspace: boolean) {
    return client.team.findFirst({
      where: {
        id: teamId,
        workspaceId,
        ...(canManageWorkspace ? {} : { members: { some: { userId } } }),
      },
      select: { id: true, workspaceId: true, name: true, createdAt: true, updatedAt: true },
    });
  }

  async listMembers(client: QueryClient, teamId: string, pagination: PaginationInput) {
    const skip = (pagination.page - 1) * pagination.pageSize;
    const where = { teamId };
    return Promise.all([
      client.teamMember.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
        skip,
        take: pagination.pageSize,
        select: {
          createdAt: true,
          workspaceMember: { select: { user: { select: { id: true, email: true, displayName: true } } } },
        },
      }),
      client.teamMember.count({ where }),
    ]);
  }
}
