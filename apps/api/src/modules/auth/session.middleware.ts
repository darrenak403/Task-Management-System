import type { Request, RequestHandler } from 'express';
import type { AuthService } from './auth.service.js';
import type { PublicUser } from './auth.repository.js';
import { readSessionCookie } from '../../shared/http/cookie.js';
import { HttpError } from '../../shared/http/error-handler.js';

export type AuthenticatedIdentity = {
  sessionId: string;
  sessionHash: string;
  expiresAt: Date;
  user: PublicUser;
};

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthenticatedIdentity;
  }
}

export function requireAuthenticated(request: Request): AuthenticatedIdentity {
  if (!request.auth) throw new HttpError(401, 'UNAUTHENTICATED', 'Authentication is required.');
  return request.auth;
}

export function createSessionMiddleware(authService: AuthService): RequestHandler {
  return async (request, _response, next) => {
    const token = readSessionCookie(request);
    if (!token) {
      next(new HttpError(401, 'UNAUTHENTICATED', 'Authentication is required.'));
      return;
    }

    try {
      const session = await authService.getSession(token);
      if (!session) {
        next(new HttpError(401, 'UNAUTHENTICATED', 'Authentication is required.'));
        return;
      }
      request.auth = session;
      next();
    } catch (error) {
      next(error);
    }
  };
}
