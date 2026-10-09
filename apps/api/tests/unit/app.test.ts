import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { createApp } from '../../src/app.js';

describe('Express proxy trust configuration', () => {
  it('trusts only explicitly configured proxy networks', () => {
    const app = createApp({ logger: pino({ level: 'silent' }), trustedProxyCidrs: ['192.0.2.14/32'] });
    const isTrusted = app.get('trust proxy fn') as (address: string, hop: number) => boolean;

    expect(isTrusted('192.0.2.14', 0)).toBe(true);
    expect(isTrusted('192.0.2.15', 0)).toBe(false);
  });

  it('does not trust forwarded addresses when proxy CIDRs are not configured', () => {
    const app = createApp({ logger: pino({ level: 'silent' }) });
    const isTrusted = app.get('trust proxy fn') as (address: string, hop: number) => boolean;

    expect(isTrusted('127.0.0.1', 0)).toBe(false);
  });
});
