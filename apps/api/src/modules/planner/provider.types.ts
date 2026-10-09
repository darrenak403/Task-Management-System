import type { UnderstandingOutput, PlanOutput } from './planner.schemas.js';

export type ProviderUsage = { inputTokens: number; outputTokens: number };
export type GeminiResult<T> = { value: T; usage: ProviderUsage };

export type AiProviderErrorCode = 'AI_TIMEOUT' | 'AI_RATE_LIMITED' | 'AI_REFUSED' | 'AI_OUTPUT_INVALID' | 'AI_PROVIDER_UNAVAILABLE' | 'AI_CANCELLED' | 'AI_CREDENTIAL_CHANGED';

export class AiProviderError extends Error {
  /** `providerStatus` and `providerMessage` are what the provider answered, kept for the server log only. */
  constructor(readonly code: AiProviderErrorCode, readonly providerStatus: number | null = null, readonly providerMessage: string | null = null) {
    super(code);
    this.name = 'AiProviderError';
  }
}

export interface PlannerProvider {
  understand(input: { apiKey: string; model: string; prompt: string; signal: AbortSignal }): Promise<GeminiResult<UnderstandingOutput>>;
  generate(input: { apiKey: string; model: string; prompt: string; signal: AbortSignal }): Promise<GeminiResult<PlanOutput>>;
}
