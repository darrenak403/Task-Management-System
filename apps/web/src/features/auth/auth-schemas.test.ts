import { describe, expect, it } from 'vitest';

import { validate } from '@/lib/form';

import { loginSchema, registerSchema } from './auth-schemas';

describe('auth schemas', () => {
  it('reports one message per invalid login field', () => {
    const result = validate(loginSchema, { email: 'not-an-email', password: 'short' });

    expect(result).toEqual({
      ok: false,
      errors: { email: 'Enter a valid email address', password: 'Password must be at least 8 characters' },
    });
  });

  it('trims the email', () => {
    const result = validate(loginSchema, { email: '  ada@example.com ', password: 'password1' });

    expect(result).toEqual({ ok: true, data: { email: 'ada@example.com', password: 'password1' } });
  });

  it('rejects a mismatched password confirmation on the confirmation field', () => {
    const result = validate(registerSchema, {
      displayName: '',
      email: 'ada@example.com',
      password: 'password1',
      confirmPassword: 'password2',
    });

    expect(result).toEqual({ ok: false, errors: { confirmPassword: 'Passwords do not match' } });
  });

  it('omits an empty display name and never sends the confirmation', () => {
    const result = validate(registerSchema, {
      displayName: '   ',
      email: 'ada@example.com',
      password: 'password1',
      confirmPassword: 'password1',
    });

    expect(result).toEqual({ ok: true, data: { email: 'ada@example.com', password: 'password1' } });
  });

  it('keeps a trimmed display name', () => {
    const result = validate(registerSchema, {
      displayName: ' Ada ',
      email: 'ada@example.com',
      password: 'password1',
      confirmPassword: 'password1',
    });

    expect(result.ok && result.data.displayName).toBe('Ada');
  });
});
