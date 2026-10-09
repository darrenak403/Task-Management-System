import type { UnderstandingOutput, PlanOutput } from './planner.schemas.js';

export type ProviderUsage = { inputTokens: number; outputTokens: number };
export type GeminiResult<T> = { value: T; usage: ProviderUsage };

export type AiProviderErrorCode = 'AI_TIMEOUT' | 'AI_RATE_LIMITED' | 'AI_REFUSED' | 'AI_OUTPUT_INVALID' | 'AI_PROVIDER_UNAVAILABLE' | 'AI_CANCELLED' | 'AI_CREDENTIAL_CHANGED';

export class AiProviderError extends Error {
  constructor(readonly code: AiProviderErrorCode) {
    super(code);
    this.name = 'AiProviderError';
  }
}

export interface PlannerProvider {
  understand(input: { apiKey: string; model: string; prompt: string; signal: AbortSignal }): Promise<GeminiResult<UnderstandingOutput>>;
  generate(input: { apiKey: string; model: string; prompt: string; signal: AbortSignal }): Promise<GeminiResult<PlanOutput>>;
}
