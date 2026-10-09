import { GoogleGenAI } from '@google/genai';
import type { RuntimeEnvironment } from '../../shared/config/env.js';
import { understandingOutputSchema, planOutputSchema, type UnderstandingOutput, type PlanOutput } from './planner.schemas.js';
import { AiProviderError, type GeminiResult, type PlannerProvider } from './provider.types.js';

const stringArray = (maxItems: number, maxLength: number) => ({ type: 'array', maxItems, items: { type: 'string', maxLength } });
const nullableInteger = { anyOf: [{ type: 'integer', minimum: 1, maximum: 525_600 }, { type: 'null' }] };
const nullableDate = { anyOf: [{ type: 'string', format: 'date' }, { type: 'null' }] };
const itemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'title', 'description', 'completionCriteria', 'priority', 'priorityReason', 'estimateMinMinutes', 'estimateMaxMinutes', 'schedule', 'dependencies', 'checklist', 'suggestedRole'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    title: { type: 'string', minLength: 1, maxLength: 200 },
    description: { type: 'string', maxLength: 5_000 },
    completionCriteria: { type: 'string', minLength: 1, maxLength: 2_000 },
    priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
    priorityReason: { type: 'string', minLength: 1, maxLength: 1_000 },
    estimateMinMinutes: nullableInteger,
    estimateMaxMinutes: nullableInteger,
    schedule: {
      anyOf: [
        { type: 'object', additionalProperties: false, required: ['mode'], properties: { mode: { type: 'string', enum: ['NONE'] } } },
        { type: 'object', additionalProperties: false, required: ['mode', 'startDay', 'dueDay'], properties: {
          mode: { type: 'string', enum: ['RELATIVE'] },
          startDay: { anyOf: [{ type: 'integer', minimum: 1, maximum: 365 }, { type: 'null' }] },
          dueDay: { anyOf: [{ type: 'integer', minimum: 1, maximum: 365 }, { type: 'null' }] },
        } },
        { type: 'object', additionalProperties: false, required: ['mode', 'startDate', 'dueDate'], properties: {
          mode: { type: 'string', enum: ['ABSOLUTE'] }, startDate: nullableDate, dueDate: nullableDate,
        } },
      ],
    },
    dependencies: { type: 'array', maxItems: 20, items: { type: 'string', format: 'uuid' } },
    checklist: stringArray(10, 200),
    suggestedRole: { anyOf: [{ type: 'string', minLength: 1, maxLength: 80 }, { type: 'null' }] },
  },
};

const understandingJsonSchema = {
  type: 'object', additionalProperties: false,
  required: ['summary', 'assumptions', 'questions'],
  properties: {
    summary: { type: 'string', minLength: 1, maxLength: 2_000 },
    assumptions: stringArray(10, 500),
    questions: stringArray(3, 500),
  },
};

const planJsonSchema = {
  type: 'object', additionalProperties: false,
  required: ['planTitle', 'goalSummary', 'assumptions', 'warnings', 'items'],
  properties: {
    planTitle: { type: 'string', minLength: 1, maxLength: 120 },
    goalSummary: { type: 'string', minLength: 1, maxLength: 2_000 },
    assumptions: stringArray(10, 500),
    warnings: stringArray(20, 500),
    items: { type: 'array', minItems: 1, maxItems: 20, items: itemSchema },
  },
};

export class GeminiPlannerProvider implements PlannerProvider {
  constructor(
    private readonly environment: RuntimeEnvironment,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  understand(input: { apiKey: string; model: string; prompt: string; signal: AbortSignal }): Promise<GeminiResult<UnderstandingOutput>> {
    return this.generateJson(
      input, understandingJsonSchema, understandingOutputSchema,
      Math.min(this.environment.AI_MAX_OUTPUT_TOKENS ?? 2_048, 2_048),
      'Analyze only the provided project-planning data. Identify hard constraints and assumptions. Ask at most three blocking clarification questions. Never reveal private reasoning.',
    );
  }

  generate(input: { apiKey: string; model: string; prompt: string; signal: AbortSignal }): Promise<GeminiResult<PlanOutput>> {
    return this.generateJson(
      input, planJsonSchema, planOutputSchema, this.environment.AI_MAX_OUTPUT_TOKENS ?? 8_192,
      'Create a practical task draft using only supplied facts. Do not create real tasks, call tools, browse, or invent members, capacities, dates, or dependencies. Use null or NONE when information is unknown. Return only the requested JSON object and no private reasoning.',
    );
  }

  private async generateJson<T>(
    input: { apiKey: string; model: string; prompt: string; signal: AbortSignal },
    schema: unknown,
    outputSchema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
    maxOutputTokens: number,
    systemInstruction: string,
  ): Promise<GeminiResult<T>> {
    const client = new GoogleGenAI({
      apiKey: input.apiKey,
      httpOptions: {
        timeout: this.environment.AI_PROVIDER_TIMEOUT_MS,
        retryOptions: { attempts: 1 },
        headers: { 'x-goog-api-key': input.apiKey },
        fetch: (input, init) => this.fetchImplementation(input, { ...init, redirect: 'error' }),
      },
    });

    try {
      const response = await client.models.generateContent({
        model: input.model,
        contents: input.prompt,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseJsonSchema: schema,
          maxOutputTokens,
          temperature: 0.2,
          abortSignal: input.signal,
        },
      });
      const finishReason = response.candidates?.[0]?.finishReason;
      if (finishReason === 'SAFETY' || finishReason === 'RECITATION') throw new AiProviderError('AI_REFUSED');
      if (finishReason === 'MAX_TOKENS') throw new AiProviderError('AI_OUTPUT_INVALID');
      const text = response.text;
      if (!text) throw new AiProviderError('AI_OUTPUT_INVALID');

      let value: unknown;
      try {
        value = JSON.parse(text) as unknown;
      } catch {
        throw new AiProviderError('AI_OUTPUT_INVALID');
      }
      const parsed = outputSchema.safeParse(value);
      if (!parsed.success) throw new AiProviderError('AI_OUTPUT_INVALID');
      return {
        value: parsed.data,
        usage: {
          inputTokens: Math.max(0, response.usageMetadata?.promptTokenCount ?? 0),
          outputTokens: Math.max(0, response.usageMetadata?.candidatesTokenCount ?? 0),
        },
      };
    } catch (error) {
      if (error instanceof AiProviderError) throw error;
      if (input.signal.aborted) {
        if (input.signal.reason instanceof AiProviderError) throw input.signal.reason;
        throw new AiProviderError(input.signal.reason instanceof Error && input.signal.reason.name === 'TimeoutError' ? 'AI_TIMEOUT' : 'AI_CANCELLED');
      }
      const status = readStatus(error);
      if (status === 429) throw new AiProviderError('AI_RATE_LIMITED');
      if (status !== null) throw new AiProviderError('AI_PROVIDER_UNAVAILABLE');
      throw new AiProviderError('AI_PROVIDER_UNAVAILABLE');
    }
  }
}

function readStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  if ('status' in error && typeof error.status === 'number') return error.status;
  if ('statusCode' in error && typeof error.statusCode === 'number') return error.statusCode;
  return null;
}
