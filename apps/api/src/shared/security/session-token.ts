import { createHash, randomBytes } from 'node:crypto';

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

export function createSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
