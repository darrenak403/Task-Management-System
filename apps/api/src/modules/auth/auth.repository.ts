import type { PrismaClient } from '../../generated/prisma/client.js';
import { appendRealtimeEvents } from '../realtime/outbox.js';

export type PublicUser = {
  id: string;
  email: string;
  displayName: string | null;
};

export type UserWithPassword = PublicUser & { passwordHash: string };

const publicUserSelect = { id: true, email: true, displayName: true } as const;

export class AuthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findByEmail(email: string): Promise<UserWithPassword | null> {
    return this.prisma.user.findUnique({
      where: { email },
      select: { ...publicUserSelect, passwordHash: true },
    });
  }

  async createUserAndSession(input: {
    email: string;
    passwordHash: string;
    displayName: string | null;
    tokenHash: string;
    expiresAt: Date;
    previousTokenHash: string | null;
  }): Promise<PublicUser> {
    return this.prisma.$transaction(async (tx) => {
      let revoked: { userId: string } | null = null;
      if (input.previousTokenHash) {
        revoked = await tx.session.findUnique({ where: { tokenHash: input.previousTokenHash }, select: { userId: true } });
        await tx.session.deleteMany({ where: { tokenHash: input.previousTokenHash } });
      }
      const user = await tx.user.create({
        data: {
          email: input.email,
          passwordHash: input.passwordHash,
          displayName: input.displayName,
          sessions: { create: { tokenHash: input.tokenHash, expiresAt: input.expiresAt } },
        },
        select: publicUserSelect,
      });
      if (revoked && input.previousTokenHash) {
        await appendRealtimeEvents(tx, [{
          eventType: 'auth.revoked', targetUserId: revoked.userId, targetSessionHash: input.previousTokenHash,
          payload: { reason: 'session_rotated' },
        }]);
      }
      return user;
    });
  }

  async createSession(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    previousTokenHash: string | null;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      let revoked: { userId: string } | null = null;
      if (input.previousTokenHash) {
        revoked = await tx.session.findUnique({ where: { tokenHash: input.previousTokenHash }, select: { userId: true } });
        await tx.session.deleteMany({ where: { tokenHash: input.previousTokenHash } });
      }
      await tx.session.create({
        data: { userId: input.userId, tokenHash: input.tokenHash, expiresAt: input.expiresAt },
      });
      if (revoked && input.previousTokenHash) {
        await appendRealtimeEvents(tx, [{
          eventType: 'auth.revoked', targetUserId: revoked.userId, targetSessionHash: input.previousTokenHash,
          payload: { reason: 'session_rotated' },
        }]);
      }
    });
  }

  findActiveSession(tokenHash: string, now: Date): Promise<{
    id: string;
    expiresAt: Date;
    user: PublicUser;
  } | null> {
    return this.prisma.session.findFirst({
      where: { tokenHash, expiresAt: { gt: now } },
      select: { id: true, expiresAt: true, user: { select: publicUserSelect } },
    });
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.$queryRaw<Array<{ id: string; user_id: string }>>`
        DELETE FROM sessions WHERE token_hash = ${tokenHash} RETURNING id, user_id
      `;
      const session = deleted[0];
      if (session) {
        await appendRealtimeEvents(tx, [{
          eventType: 'auth.revoked', targetUserId: session.user_id, targetSessionHash: tokenHash,
          payload: { reason: 'logout' },
        }]);
      }
    });
  }

  async deleteExpiredSessionsBatch(limit: number, now = new Date()): Promise<number> {
    const deleted = await this.prisma.$queryRaw<Array<{ id: string }>>`
      WITH expired AS (
        SELECT id
        FROM sessions
        WHERE expires_at <= ${now}
        ORDER BY expires_at ASC, id ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      DELETE FROM sessions AS session
      USING expired
      WHERE session.id = expired.id
      RETURNING session.id
    `;
    return deleted.length;
  }
}
