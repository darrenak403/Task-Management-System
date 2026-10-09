import pino, { type Logger } from 'pino';
import type { RuntimeEnvironment } from '../config/env.js';

export function createLogger(environment: RuntimeEnvironment): Logger {
  return pino({
    level: environment.LOG_LEVEL,
    base: { service: 'task-management-api', environment: environment.NODE_ENV },
    redact: {
      paths: [
        'authorization',
        'cookie',
        'set-cookie',
        '*.authorization',
        '*.cookie',
        '*.password',
        '*.token',
        '*.apiKey',
        '*.secret',
        '*.credential',
        '*.keyring',
      ],
      censor: '[REDACTED]',
    },
  });
}
