import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import type { PaginationInput } from '../../shared/http/pagination.js';

type QueryClient = PrismaClient | Prisma.TransactionClient;

export class WorkspaceRepository {
  constructor(private readonly prisma: PrismaClient) {}

  listForUser(userId: string, pagination: PaginationInput) {
    const skip = (pagination.page - 1) * pagination.pageSize;
    return Promise.all([
      this.prisma.workspaceMember.findMany({
        where: { userId },
        orderBy: [{ createdAt: 'asc' }, { workspaceId: 'asc' }],
        skip,
        take: pagination.pageSize,
        select: {
          role: true,
          createdAt: true,
          workspace: { select: { id: true, name: true, createdAt: true, updatedAt: true } },
        },
      }),
      this.prisma.workspaceMember.count({ where: { userId } }),
    ]);
  }

  findMembership(client: QueryClient, workspaceId: string, userId: string) {
    return client.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: {
        role: true,
        workspace: { select: { id: true, name: true, createdAt: true, updatedAt: true } },
      },
    });
  }

  async listMembers(client: QueryClient, workspaceId: string, pagination: PaginationInput) {
    const skip = (pagination.page - 1) * pagination.pageSize;
    return Promise.all([
      client.workspaceMember.findMany({
        where: { workspaceId },
        orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
        skip,
        take: pagination.pageSize,
        select: {
          role: true,
          createdAt: true,
          user: { select: { id: true, email: true, displayName: true } },
        },
      }),
      client.workspaceMember.count({ where: { workspaceId } }),
    ]);
  }

  /** Accounts that are not in the workspace yet, optionally narrowed by a part of their email or name. */
  listMemberCandidates(client: QueryClient, workspaceId: string, search: string | undefined, take: number) {
    return client.user.findMany({
      where: {
        workspaceMemberships: { none: { workspaceId } },
        ...(search ? { OR: [{ email: { contains: search, mode: 'insensitive' } }, { displayName: { contains: search, mode: 'insensitive' } }] } : {}),
      },
      orderBy: [{ email: 'asc' }],
      take,
      select: { id: true, email: true, displayName: true },
    });
  }

  findUserByEmail(client: QueryClient, email: string) {
    return client.user.findUnique({ where: { email }, select: { id: true } });
  }
}
