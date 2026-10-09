import type { Request } from 'express';
import { requireAuthenticated } from './session.middleware.js';

export function currentUserId(request: Request): string {
  return requireAuthenticated(request).user.id;
}
