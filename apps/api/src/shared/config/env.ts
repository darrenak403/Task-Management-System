import { isIP } from 'node:net';
import { z } from 'zod';

const booleanString = (defaultValue: 'true' | 'false' = 'false') =>
  z.enum(['true', 'false']).default(defaultValue).transform((value) => value === 'true');
function isSpecificProxyAddress(value: string): boolean {
  const [address, prefix, ...extra] = value.split('/');
  if (extra.length > 0 || !address) return false;

  const version = isIP(address);
  if (version === 0) return false;
  if (prefix === undefined) return true;
  if (!/^\d+$/.test(prefix)) return false;

  const prefixLength = Number(prefix);
  return prefixLength > 0 && prefixLength <= (version === 4 ? 32 : 128);
}

const trustedProxyCidrs = z.string().default('').transform((value) =>
  [...new Set(value.split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean))],
).refine((values) => values.every(isSpecificProxyAddress) && !values.some((value) => ['*', '0.0.0.0/0', '::/0'].includes(value)), {
  message: 'must name valid, specific trusted proxy IPs or CIDRs',
});

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  APP_ORIGIN: z.url().refine((value) => {
    const url = new URL(value);
    return url.origin === value && url.pathname === '/' && !url.search && !url.hash;
  }).default('http://localhost:3000'),
  DATABASE_URL: z.url().refine((value) => value.startsWith('postgres://') || value.startsWith('postgresql://')).optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUSTED_PROXY_CIDRS: trustedProxyCidrs,
});

const aiEnvironmentSchema = z.object({
  AI_ENABLED: booleanString('true'),
  CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION: z.string().min(1).optional(),
  CREDENTIAL_ENCRYPTION_KEYRING: z.string().optional(),
  AI_MAX_INPUT_TOKENS: z.coerce.number().int().min(1).max(1_000_000).optional(),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(1).max(1_000_000).optional(),
  AI_PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(60_000),
  AI_JOB_TIMEOUT_MS: z.coerce.number().int().min(10_000).max(300_000).default(180_000),
});

export type RuntimeEnvironment = z.infer<typeof environmentSchema> & {
  AI_ENABLED: boolean;
  CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION?: string | undefined;
  AI_MAX_INPUT_TOKENS?: number | undefined;
  AI_MAX_OUTPUT_TOKENS?: number | undefined;
  AI_PROVIDER_TIMEOUT_MS: number;
  AI_JOB_TIMEOUT_MS: number;
  aiUnavailableReason: 'disabled' | 'invalid_configuration' | null;
  credentialEncryptionKeyring: Readonly<Record<string, Buffer>>;
};

const ownedEnvironmentKeys = [
  'NODE_ENV',
  'PORT',
  'APP_ORIGIN',
  'DATABASE_URL',
  'LOG_LEVEL',
  'TRUSTED_PROXY_CIDRS',
] as const;

function parseKeyring(raw: string | undefined): Readonly<Record<string, Buffer>> {
  if (raw === undefined) return {};

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('Invalid runtime configuration: CREDENTIAL_ENCRYPTION_KEYRING must be valid JSON');
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid runtime configuration: CREDENTIAL_ENCRYPTION_KEYRING must be an object');
  }

  const entries = Object.entries(value);
  if (entries.length === 0) {
    throw new Error('Invalid runtime configuration: CREDENTIAL_ENCRYPTION_KEYRING must contain a key');
  }

  const keyring = Object.create(null) as Record<string, Buffer>;
  for (const [version, encoded] of entries) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(version) || typeof encoded !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
      throw new Error('Invalid runtime configuration: CREDENTIAL_ENCRYPTION_KEYRING entries must be base64 keys');
    }

    const decoded = Buffer.from(encoded, 'base64');
    if (decoded.length !== 32 || decoded.toString('base64') !== encoded) {
      throw new Error('Invalid runtime configuration: CREDENTIAL_ENCRYPTION_KEYRING keys must decode to 32 bytes');
    }
    keyring[version] = decoded;
  }

  return keyring;
}

export function parseEnvironment(source: NodeJS.ProcessEnv): RuntimeEnvironment {
  if ('GEMINI_API_KEY' in source || 'GOOGLE_API_KEY' in source) {
    throw new Error('Invalid runtime configuration: shared Gemini API key environment variables are forbidden');
  }

  const ownedValues = Object.fromEntries(
    ownedEnvironmentKeys
      .filter((key) => source[key] !== undefined)
      .map((key) => [key, source[key]]),
  );
  const parsed = environmentSchema.safeParse(ownedValues);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.') || 'environment'))];
    throw new Error(`Invalid runtime configuration: ${fields.join(', ')}`);
  }

  const aiParsed = aiEnvironmentSchema.safeParse(Object.fromEntries(
    ['AI_ENABLED', 'CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION', 'CREDENTIAL_ENCRYPTION_KEYRING', 'AI_MAX_INPUT_TOKENS', 'AI_MAX_OUTPUT_TOKENS', 'AI_PROVIDER_TIMEOUT_MS', 'AI_JOB_TIMEOUT_MS']
      .filter((key) => source[key] !== undefined)
      .map((key) => [key, source[key]]),
  ));

  let keyring: Readonly<Record<string, Buffer>> = {};
  let invalidKeyring = false;
  if (aiParsed.success) {
    try {
      keyring = parseKeyring(aiParsed.data.CREDENTIAL_ENCRYPTION_KEYRING);
    } catch {
      invalidKeyring = true;
    }
  }

  const aiData = aiParsed.success ? aiParsed.data : aiEnvironmentSchema.parse({});
  const requested = aiData.AI_ENABLED;
  const safeAiData = { ...aiData };
  delete safeAiData.CREDENTIAL_ENCRYPTION_KEYRING;
  const activeVersion = aiData.CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION;
  const keyConfigured = Boolean(activeVersion && Object.hasOwn(keyring, activeVersion));
  const tokenLimitsConfigured = aiData.AI_MAX_INPUT_TOKENS !== undefined && aiData.AI_MAX_OUTPUT_TOKENS !== undefined;
  const aiConfigured = requested && aiParsed.success && !invalidKeyring && keyConfigured && tokenLimitsConfigured;

  return {
    ...parsed.data,
    ...safeAiData,
    AI_ENABLED: aiConfigured,
    aiUnavailableReason: !requested ? 'disabled' : aiConfigured ? null : 'invalid_configuration',
    credentialEncryptionKeyring: keyring,
  };
}

export function loadEnvironment(): RuntimeEnvironment {
  return parseEnvironment(process.env);
}
