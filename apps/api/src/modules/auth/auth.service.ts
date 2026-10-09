import { HttpError } from '../../shared/http/error-handler.js';
import { hashPassword, verifyPassword } from '../../shared/security/password.js';
import { createSessionToken, hashSessionToken, SESSION_TTL_MS } from '../../shared/security/session-token.js';
import type { LoginInput, RegisterInput } from './auth.schemas.js';
import type { AuthRepository, PublicUser } from './auth.repository.js';

export type SessionIdentity = {
  sessionId: string;
  sessionHash: string;
  expiresAt: Date;
  user: PublicUser;
};

export type IssuedSession = {
  user: PublicUser;
  token: string;
};

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

export class AuthService {
  constructor(private readonly repository: AuthRepository) {}

  async register(input: RegisterInput, previousToken: string | null): Promise<IssuedSession> {
    const token = createSessionToken();
    const passwordHash = await hashPassword(input.password);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    try {
      const user = await this.repository.createUserAndSession({
        email: input.email,
        passwordHash,
        displayName: input.displayName ?? null,
        tokenHash: hashSessionToken(token),
        expiresAt,
        previousTokenHash: previousToken ? hashSessionToken(previousToken) : null,
      });
      return { user, token };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new HttpError(409, 'EMAIL_ALREADY_REGISTERED', 'An account with this email already exists.');
      }
      throw error;
    }
  }

  async login(input: LoginInput, previousToken: string | null): Promise<IssuedSession> {
    const user = await this.repository.findByEmail(input.email);
    const passwordMatches = await verifyPassword(user?.passwordHash ?? null, input.password);
    if (!user || !passwordMatches) {
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    }

    const token = createSessionToken();
    await this.repository.createSession({
      userId: user.id,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      previousTokenHash: previousToken ? hashSessionToken(previousToken) : null,
    });
    return { user: { id: user.id, email: user.email, displayName: user.displayName }, token };
  }

  async getSession(token: string): Promise<SessionIdentity | null> {
    const sessionHash = hashSessionToken(token);
    const session = await this.repository.findActiveSession(sessionHash, new Date());
    return session ? { sessionId: session.id, sessionHash, expiresAt: session.expiresAt, user: session.user } : null;
  }

  async logout(token: string | null): Promise<void> {
    if (token) await this.repository.deleteSession(hashSessionToken(token));
  }
}
