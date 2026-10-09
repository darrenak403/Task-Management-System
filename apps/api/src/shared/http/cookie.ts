import type { Request, Response } from 'express';

export const SESSION_COOKIE_NAME = 'tm_session';
const SESSION_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1_000;

export function readSessionCookie(request: Request): string | null {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return null;

  for (const segment of cookieHeader.split(';')) {
    const separator = segment.indexOf('=');
    if (separator < 0 || segment.slice(0, separator).trim() !== SESSION_COOKIE_NAME) continue;
    const token = segment.slice(separator + 1).trim();
    return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
  }
  return null;
}

export function setSessionCookie(response: Response, token: string, secure: boolean): void {
  response.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: SESSION_COOKIE_MAX_AGE,
  });
}

export function clearSessionCookie(response: Response, secure: boolean): void {
  response.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
  });
}
