import type { GeminiResult, PlannerProvider } from '../../src/modules/planner/provider.types.js';
import type { PlanOutput, UnderstandingOutput } from '../../src/modules/planner/planner.schemas.js';

export const successfulUnderstanding: UnderstandingOutput = {
  summary: 'Create and release a small task management API.',
  assumptions: ['The team can review the draft before importing it.'],
  questions: [],
};

export function successfulPlan(): PlanOutput {
  return {
    planTitle: 'Task management API',
    goalSummary: 'Create and release a small task management API.',
    assumptions: ['The team can review the draft before importing it.'],
    warnings: [],
    items: [{
      id: 'cf0ec9e4-80d4-45d1-8ee0-ea18a8fa7d11',
      title: 'Define API contract',
      description: 'Document the first task endpoints.',
      completionCriteria: 'The endpoint contract is reviewed by the team.',
      priority: 'HIGH',
      priorityReason: 'The contract guides implementation work.',
      estimateMinMinutes: 60,
      estimateMaxMinutes: 120,
      schedule: { mode: 'NONE' },
      dependencies: [],
      checklist: ['List required endpoints', 'Review request and response shapes'],
      suggestedRole: 'Backend developer',
    }],
  };
}

export type FakeProviderCall = {
  operation: 'understand' | 'generate';
  apiKey: string;
  prompt: string;
  signal: AbortSignal;
};

type Outcome<T> = GeminiResult<T> | Error;

/** Deterministic provider fake used by planner integration tests. */
export class FakeGeminiProvider implements PlannerProvider {
  readonly calls: FakeProviderCall[] = [];
  private readonly waiters: Array<{ count: number; resolve: () => void; timer: ReturnType<typeof setTimeout> }> = [];
  private understandingResults: Outcome<UnderstandingOutput>[];
  private generationResults: Outcome<PlanOutput>[];

  constructor(options: {
    understanding?: Outcome<UnderstandingOutput>[];
    generation?: Outcome<PlanOutput>[];
  } = {}) {
    this.understandingResults = [...(options.understanding ?? [])];
    this.generationResults = [...(options.generation ?? [])];
  }

  async understand(input: FakeProviderCall): Promise<GeminiResult<UnderstandingOutput>> {
    this.record({ operation: 'understand', ...input });
    return this.resolve(this.understandingResults.shift() ?? {
      value: successfulUnderstanding,
      usage: { inputTokens: 48, outputTokens: 24 },
    });
  }

  async generate(input: FakeProviderCall): Promise<GeminiResult<PlanOutput>> {
    this.record({ operation: 'generate', ...input });
    return this.resolve(this.generationResults.shift() ?? {
      value: successfulPlan(),
      usage: { inputTokens: 120, outputTokens: 96 },
    });
  }

  waitForCallCount(count: number, timeoutMs = 5_000): Promise<void> {
    if (this.calls.length >= count) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex((waiter) => waiter.timer === timer);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error(`Timed out waiting for ${count} fake provider calls; received ${this.calls.length}.`));
      }, timeoutMs);
      this.waiters.push({ count, resolve: () => { clearTimeout(timer); resolve(); }, timer });
    });
  }

  private record(call: FakeProviderCall): void {
    this.calls.push(call);
    for (let index = this.waiters.length - 1; index >= 0; index -= 1) {
      const waiter = this.waiters[index];
      if (waiter && this.calls.length >= waiter.count) {
        this.waiters.splice(index, 1);
        waiter.resolve();
      }
    }
  }

  private async resolve<T>(outcome: Outcome<T>): Promise<GeminiResult<T>> {
    if (outcome instanceof Error) throw outcome;
    return outcome;
  }
}
