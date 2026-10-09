import type { Logger } from 'pino';
import type { RequestHandler } from 'express';
import { readSessionCookie, setSessionCookie, clearSessionCookie } from '../../shared/http/cookie.js';
import { HttpError } from '../../shared/http/error-handler.js';
import { loginSchema, registerSchema } from './auth.schemas.js';
import type { AuthService } from './auth.service.js';
import { requireAuthenticated } from './session.middleware.js';

function parseBody<T>(result: { success: true; data: T } | { success: false }): T {
  if (!result.success) throw new HttpError(400, 'VALIDATION_ERROR', 'The request is invalid.');
  return result.data;
}

export function createAuthController(service: AuthService, secureCookie: boolean, logger: Logger) {
  const register: RequestHandler = async (request, response) => {
    const input = parseBody(registerSchema.safeParse(request.body));
    const session = await service.register(input, readSessionCookie(request));
    setSessionCookie(response, session.token, secureCookie);
    logger.info({ requestId: request.requestId, action: 'register' }, 'Account registered');
    response.status(201).json({ data: session.user });
  };

  const login: RequestHandler = async (request, response) => {
    const input = parseBody(loginSchema.safeParse(request.body));
    const session = await service.login(input, readSessionCookie(request));
    setSessionCookie(response, session.token, secureCookie);
    logger.info({ requestId: request.requestId, action: 'login' }, 'Account authenticated');
    response.status(200).json({ data: session.user });
  };

  const logout: RequestHandler = async (request, response) => {
    await service.logout(readSessionCookie(request));
    clearSessionCookie(response, secureCookie);
    response.status(204).end();
  };

  const me: RequestHandler = (request, response) => {
    response.status(200).json({ data: requireAuthenticated(request).user });
  };

  return { register, login, logout, me };
}
