import { createHash } from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import { HttpError } from './error-handler.js';

type RateLimitOptions = {
  limit: number;
  windowMs: number;
  key: (request: Request) => string;
  methods?: readonly string[];
};

type Bucket = { count: number; resetAt: number };

export function createRateLimit(options: RateLimitOptions): RequestHandler {
  const buckets = new Map<string, Bucket>();

  return (request, response, next) => {
    if (options.methods && !options.methods.includes(request.method)) {
      next();
      return;
    }
    const key = options.key(request);
    const now = Date.now();
    const current = buckets.get(key);
    if (!current || current.resetAt <= now) {
      if (buckets.size >= 10_000) {
        const oldestKey = buckets.keys().next().value;
        if (oldestKey !== undefined) buckets.delete(oldestKey);
      }
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }

    if (current.count >= options.limit) {
      const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1_000));
      response.setHeader('Retry-After', String(retryAfter));
      next(new HttpError(429, 'RATE_LIMITED', 'Too many requests. Please try again later.'));
      return;
    }

    current.count += 1;
    next();
  };
}

export function hashRateLimitIdentifier(value: string): string {
  return createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}
