import { randomUUID } from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
import type { RuntimeEnvironment } from '../../shared/config/env.js';
import { understandingOutputSchema, planOutputSchema, type UnderstandingOutput, type PlanOutput } from './planner.schemas.js';
import { AiProviderError, type GeminiResult, type PlannerProvider } from './provider.types.js';

const stringArray = (maxItems: number, maxLength: number) => ({ type: 'array', maxItems, items: { type: 'string', maxLength } });
// What Gemini is asked to fill in for one task. It is deliberately loose: Gemini answers 400 INVALID_ARGUMENT to
// unions of objects, nullable unions and length or range rules on a schema this size. Unknown values are simply left
// out, `normalisePlan` puts the answer into the strict shape, and the strict schema then checks every limit.
const itemSchema = {
  type: 'object',
  required: ['id', 'title', 'description', 'completionCriteria', 'priority', 'priorityReason', 'schedule', 'dependencies', 'checklist'],
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    description: { type: 'string' },
    completionCriteria: { type: 'string' },
    priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
    priorityReason: { type: 'string' },
    estimateMinMinutes: { type: 'integer' },
    estimateMaxMinutes: { type: 'integer' },
    schedule: {
      type: 'object',
      required: ['mode'],
      properties: {
        mode: { type: 'string', enum: ['NONE', 'RELATIVE', 'ABSOLUTE'] },
        startDay: { type: 'integer' },
        dueDay: { type: 'integer' },
        startDate: { type: 'string' },
        dueDate: { type: 'string' },
      },
    },
    dependencies: { type: 'array', items: { type: 'string' } },
    checklist: { type: 'array', items: { type: 'string' } },
    suggestedRole: { type: 'string' },
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
  type: 'object',
  required: ['planTitle', 'goalSummary', 'assumptions', 'warnings', 'items'],
  properties: {
    planTitle: { type: 'string' },
    goalSummary: { type: 'string' },
    assumptions: { type: 'array', items: { type: 'string' } },
    warnings: { type: 'array', items: { type: 'string' } },
    items: { type: 'array', items: itemSchema },
  },
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Only the fields that belong to the chosen mode; a value the model left out, or left empty, becomes null. */
function normaliseSchedule(schedule: unknown): unknown {
  if (!isRecord(schedule)) return { mode: 'NONE' };
  if (schedule.mode === 'RELATIVE') return { mode: 'RELATIVE', startDay: schedule.startDay || null, dueDay: schedule.dueDay || null };
  if (schedule.mode === 'ABSOLUTE') return { mode: 'ABSOLUTE', startDate: schedule.startDate || null, dueDate: schedule.dueDate || null };
  return { mode: 'NONE' };
}

/**
 * Puts the model's loose answer into the strict draft shape. Every item gets a real UUID and its dependencies are
 * rewritten to match, so the model only has to keep its own ids consistent; a dependency on an id no item has is dropped.
 */
function normalisePlan(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.items)) return value;
  const items: unknown[] = value.items;
  const ids = new Map<unknown, string>();
  for (const item of items) if (isRecord(item) && !ids.has(item.id)) ids.set(item.id, randomUUID());
  return {
    ...value,
    items: items.map((item) => {
      if (!isRecord(item)) return item;
      // One estimate alone stands for both ends of the range.
      const estimateMin = item.estimateMinMinutes || item.estimateMaxMinutes || null;
      const estimateMax = item.estimateMaxMinutes || item.estimateMinMinutes || null;
      return {
        ...item,
        id: ids.get(item.id),
        estimateMinMinutes: estimateMin,
        estimateMaxMinutes: estimateMax,
        schedule: normaliseSchedule(item.schedule),
        dependencies: Array.isArray(item.dependencies) ? item.dependencies.flatMap((id) => ids.get(id) ?? []) : [],
        suggestedRole: item.suggestedRole || null,
      };
    }),
  };
}

const PLAN_LIMITS = 'Limits: at most 20 items; each item id is a short unique string and dependencies list the ids of other items (at most 20); title up to 200 characters, description up to 5000, completionCriteria up to 2000, priorityReason up to 1000, suggestedRole up to 80; checklist up to 10 entries of 200 characters; estimates are whole minutes from 1 to 525600; with schedule mode RELATIVE give startDay and dueDay as day numbers from 1 to 365, with ABSOLUTE give startDate and dueDate as YYYY-MM-DD, with NONE give neither; leave out any value that is unknown; planTitle up to 120 characters, goalSummary up to 2000; assumptions up to 10 and warnings up to 20 entries of 500 characters.';

/** Plans are read by the person who wrote the goal, so the model answers in that language, whatever language the interface uses. */
const LANGUAGE_RULE = 'Write every text value in the same language as the goal.';

export class GeminiPlannerProvider implements PlannerProvider {
  constructor(
    private readonly environment: RuntimeEnvironment,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  understand(input: { apiKey: string; model: string; prompt: string; signal: AbortSignal }): Promise<GeminiResult<UnderstandingOutput>> {
    return this.generateJson(
      input, understandingJsonSchema, understandingOutputSchema,
      Math.min(this.environment.AI_MAX_OUTPUT_TOKENS ?? 2_048, 2_048),
      'Analyze only the provided project-planning data. Identify hard constraints and assumptions. Ask at most three blocking clarification questions. Never reveal private reasoning. ' + LANGUAGE_RULE,
    );
  }

  generate(input: { apiKey: string; model: string; prompt: string; signal: AbortSignal }): Promise<GeminiResult<PlanOutput>> {
    return this.generateJson(
      input, planJsonSchema, planOutputSchema, this.environment.AI_MAX_OUTPUT_TOKENS ?? 8_192,
      'Create a practical task draft using only supplied facts. Do not create real tasks, call tools, browse, or invent members, capacities, dates, or dependencies. Use null or NONE when information is unknown. Return only the requested JSON object and no private reasoning. ' + LANGUAGE_RULE + ' ' + PLAN_LIMITS,
      normalisePlan,
    );
  }

  private async generateJson<T>(
    input: { apiKey: string; model: string; prompt: string; signal: AbortSignal },
    schema: unknown,
    outputSchema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
    maxOutputTokens: number,
    systemInstruction: string,
    normalise: (value: unknown) => unknown = (value) => value,
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
      const parsed = outputSchema.safeParse(normalise(value));
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
      // Google's own explanation (which quota, which model) never contains the key; it is shortened for the log.
      const detail = error instanceof Error ? error.message.replaceAll(input.apiKey, '[redacted]').slice(0, 400) : null;
      if (status === 429) throw new AiProviderError('AI_RATE_LIMITED', status, detail);
      throw new AiProviderError('AI_PROVIDER_UNAVAILABLE', status, detail);
    }
  }
}

function readStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  if ('status' in error && typeof error.status === 'number') return error.status;
  if ('statusCode' in error && typeof error.statusCode === 'number') return error.statusCode;
  return null;
}
