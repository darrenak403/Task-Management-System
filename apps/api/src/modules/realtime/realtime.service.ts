import type { PrismaClient, RealtimeEvent } from '../../generated/prisma/client.js';
import { resourceNotFound } from '../../shared/authorization/policy.js';
import { HttpError } from '../../shared/http/error-handler.js';
import type { AuthService, SessionIdentity } from '../auth/auth.service.js';
import { isRealtimeEventType } from './event-catalog.js';
import type { RealtimeConnectionRegistry, RealtimeIdentity, RealtimeScope } from './connection-registry.js';
import { RealtimeRepository } from './realtime.repository.js';

export type RealtimeScopeAuthorization = { workspaceRole: string; teamMember: boolean | null };

export class RealtimeService {
  readonly repository: RealtimeRepository;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly authService: AuthService,
    readonly connections: RealtimeConnectionRegistry,
  ) {
    this.repository = new RealtimeRepository(prisma);
  }

  authenticate(token: string): Promise<SessionIdentity | null> {
    return this.authService.getSession(token);
  }

  async authorizeScope(userId: string, scope: RealtimeScope): Promise<RealtimeScopeAuthorization> {
    const membership = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: scope.workspaceId, userId } },
      select: { role: true },
    });
    if (!membership) throw resourceNotFound();
    if (!scope.teamId) return { workspaceRole: membership.role, teamMember: null };

    const team = await this.prisma.team.findFirst({
      where: { id: scope.teamId, workspaceId: scope.workspaceId },
      select: { id: true },
    });
    if (!team) throw resourceNotFound();
    let teamMember: boolean | null = null;
    if (membership.role === 'MEMBER') {
      const teamMembership = await this.prisma.teamMember.findUnique({
        where: { teamId_userId: { teamId: scope.teamId, userId } },
        select: { workspaceId: true },
      });
      if (!teamMembership || teamMembership.workspaceId !== scope.workspaceId) throw resourceNotFound();
      teamMember = true;
    }
    return { workspaceRole: membership.role, teamMember };
  }

  async canReceive(identity: RealtimeIdentity, scope: RealtimeScope, event: RealtimeEvent): Promise<boolean> {
    if (event.eventType === 'auth.revoked') return event.targetSessionHash === identity.sessionHash;
    if (event.targetSessionHash && event.targetSessionHash !== identity.sessionHash) return false;
    if (!isRealtimeEventType(event.eventType)) return false;

    const activeSession = await this.prisma.session.findFirst({
      where: {
        id: identity.sessionId,
        userId: identity.userId,
        tokenHash: identity.sessionHash,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (!activeSession) return false;

    if (event.targetUserId) {
      if (event.targetUserId !== identity.userId || event.workspaceId !== scope.workspaceId ||
        (scope.teamId && event.teamId !== scope.teamId)) return false;
      if (event.eventType === 'access.changed') return !scope.teamId || !event.teamId || event.teamId === scope.teamId;
      if (event.eventType === 'planner.job_changed' && event.resourceId && event.teamId) {
        const job = await this.prisma.aiJob.findFirst({
          where: { id: event.resourceId, creatorId: identity.userId, workspaceId: event.workspaceId, teamId: event.teamId },
          select: { id: true },
        });
        if (!job) return false;
        try {
          await this.authorizeScope(identity.userId, { workspaceId: event.workspaceId, teamId: event.teamId });
          return true;
        } catch {
          return false;
        }
      }
      return false;
    }
    if (!event.workspaceId || event.workspaceId !== scope.workspaceId) return false;
    if (scope.teamId && event.eventType !== 'workspace.structure_changed' && event.teamId !== scope.teamId) return false;

    const membership = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: event.workspaceId, userId: identity.userId } },
      select: { role: true },
    });
    if (!membership) return false;
    if (event.eventType === 'workspace.structure_changed') return true;
    if (!event.teamId) return false;
    if (membership.role !== 'MEMBER') return true;

    const teamMember = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: event.teamId, userId: identity.userId } },
      select: { workspaceId: true },
    });
    return teamMember?.workspaceId === event.workspaceId;
  }

  toIdentity(session: SessionIdentity): RealtimeIdentity {
    return {
      sessionId: session.sessionId,
      sessionHash: session.sessionHash,
      expiresAt: session.expiresAt,
      userId: session.user.id,
    };
  }

  unavailableError(): HttpError {
    return new HttpError(503, 'REALTIME_UNAVAILABLE', 'Realtime delivery is temporarily unavailable.');
  }
}
