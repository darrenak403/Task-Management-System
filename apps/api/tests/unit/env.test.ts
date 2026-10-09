import { describe, expect, it } from 'vitest';
import { parseEnvironment } from '../../src/shared/config/env.js';

describe('runtime environment', () => {
  it('keeps core API usable while AI stays unavailable without server encryption configuration', () => {
    const environment = parseEnvironment({});

    expect(environment.AI_ENABLED).toBe(false);
    expect(environment.aiUnavailableReason).toBe('invalid_configuration');
    expect(environment.credentialEncryptionKeyring).toEqual({});
    expect(environment.TRUSTED_PROXY_CIDRS).toEqual([]);
  });

  it('parses narrow proxy CIDRs and rejects configurations that trust every source', () => {
    const environment = parseEnvironment({ TRUSTED_PROXY_CIDRS: '10.20.0.4/32, 10.20.1.0/24,10.20.0.4/32' });

    expect(environment.TRUSTED_PROXY_CIDRS).toEqual(['10.20.0.4/32', '10.20.1.0/24']);
    expect(() => parseEnvironment({ TRUSTED_PROXY_CIDRS: '0.0.0.0/0' })).toThrow(/TRUSTED_PROXY_CIDRS/);
    expect(() => parseEnvironment({ TRUSTED_PROXY_CIDRS: '10.20.0.4/0' })).toThrow(/TRUSTED_PROXY_CIDRS/);
    expect(() => parseEnvironment({ TRUSTED_PROXY_CIDRS: '2001:db8::1/0' })).toThrow(/TRUSTED_PROXY_CIDRS/);
    expect(() => parseEnvironment({ TRUSTED_PROXY_CIDRS: '*' })).toThrow(/TRUSTED_PROXY_CIDRS/);
    expect(() => parseEnvironment({ TRUSTED_PROXY_CIDRS: '10.20.1.0/33' })).toThrow(/TRUSTED_PROXY_CIDRS/);
    expect(() => parseEnvironment({ TRUSTED_PROXY_CIDRS: 'not-an-ip/24' })).toThrow(/TRUSTED_PROXY_CIDRS/);
  });

  it('rejects a shared Gemini API key fallback', () => {
    expect(() => parseEnvironment({ GEMINI_API_KEY: 'redacted-test-value' })).toThrow(/shared Gemini/);
  });

  it('rejects the Google SDK environment fallback too', () => {
    const secret = 'test-google-secret-must-not-appear';

    try {
      parseEnvironment({ GOOGLE_API_KEY: secret });
      throw new Error('Expected GOOGLE_API_KEY to be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/shared Gemini/);
      expect((error as Error).message).not.toContain(secret);
    }
  });

  it('keeps core API available while failing closed if AI configuration is incomplete', () => {
    const environment = parseEnvironment({ AI_ENABLED: 'true' });

    expect(environment.AI_ENABLED).toBe(false);
    expect(environment.aiUnavailableReason).toBe('invalid_configuration');
    expect(environment.credentialEncryptionKeyring).toEqual({});
  });

  it('accepts a valid active keyring version when AI is enabled', () => {
    const key = Buffer.alloc(32, 7).toString('base64');
    const environment = parseEnvironment({
      AI_ENABLED: 'true',
      CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION: 'v1',
      CREDENTIAL_ENCRYPTION_KEYRING: JSON.stringify({ v1: key }),
      AI_MAX_INPUT_TOKENS: '8192',
      AI_MAX_OUTPUT_TOKENS: '4096',
    });

    expect(environment.AI_ENABLED).toBe(true);
    expect(environment.aiUnavailableReason).toBeNull();
    expect(environment.credentialEncryptionKeyring.v1).toEqual(Buffer.alloc(32, 7));
    expect('CREDENTIAL_ENCRYPTION_KEYRING' in environment).toBe(false);
  });

  it('disables AI when the active keyring version is missing', () => {
    const key = Buffer.alloc(32, 9).toString('base64');

    const environment = parseEnvironment({
      AI_ENABLED: 'true',
      CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION: 'v2',
      CREDENTIAL_ENCRYPTION_KEYRING: JSON.stringify({ v1: key }),
      AI_MAX_INPUT_TOKENS: '8192',
      AI_MAX_OUTPUT_TOKENS: '4096',
    });
    expect(environment.AI_ENABLED).toBe(false);
    expect(environment.aiUnavailableReason).toBe('invalid_configuration');
  });

  it('does not treat inherited object property names as configured key versions', () => {
    const key = Buffer.alloc(32, 9).toString('base64');

    const environment = parseEnvironment({
      AI_ENABLED: 'true',
      CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION: 'constructor',
      CREDENTIAL_ENCRYPTION_KEYRING: JSON.stringify({ v1: key }),
      AI_MAX_INPUT_TOKENS: '8192',
      AI_MAX_OUTPUT_TOKENS: '4096',
    });
    expect(environment.AI_ENABLED).toBe(false);
  });

  it('disables AI on malformed keyring JSON and non-32-byte keys without exposing key material', () => {
    const secret = Buffer.alloc(31, 4).toString('base64');

    const malformedJson = parseEnvironment({ AI_ENABLED: 'true', CREDENTIAL_ENCRYPTION_KEYRING: '{' });
    expect(malformedJson.AI_ENABLED).toBe(false);
    expect(malformedJson.credentialEncryptionKeyring).toEqual({});

    const invalidLength = parseEnvironment({
      AI_ENABLED: 'true',
      CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION: 'v1',
      CREDENTIAL_ENCRYPTION_KEYRING: JSON.stringify({ v1: secret }),
      AI_MAX_INPUT_TOKENS: '8192',
      AI_MAX_OUTPUT_TOKENS: '4096',
    });
    expect(invalidLength.AI_ENABLED).toBe(false);
    expect(JSON.stringify(invalidLength)).not.toContain(secret);
  });

  it('fails closed when token ceilings are missing or malformed', () => {
    const key = Buffer.alloc(32, 2).toString('base64');
    const environment = parseEnvironment({
      AI_ENABLED: 'true',
      CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION: 'v1',
      CREDENTIAL_ENCRYPTION_KEYRING: JSON.stringify({ v1: key }),
      AI_MAX_INPUT_TOKENS: 'not-a-number',
      AI_MAX_OUTPUT_TOKENS: '4096',
    });
    expect(environment.AI_ENABLED).toBe(false);
    expect(environment.aiUnavailableReason).toBe('invalid_configuration');
  });

  it('rejects malformed runtime values without echoing them', () => {
    expect(() => parseEnvironment({ PORT: 'not-a-port' })).toThrow('Invalid runtime configuration: PORT');
  });
});
