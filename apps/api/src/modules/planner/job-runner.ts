import type { Logger } from 'pino';
import type { PrismaClient, AiJob } from '../../generated/prisma/client.js';
import type { RuntimeEnvironment } from '../../shared/config/env.js';
import { HttpError } from '../../shared/http/error-handler.js';
import type { GeminiCredentialRepository } from '../ai-credentials/credentials.repository.js';
import { LeaseLostError, AiJobRepository, PlannerAccessRevokedError, PlannerPlanError, ProviderAttemptLimitError } from './job.repository.js';
import type { PlannerContextService } from './context.service.js';
import { PlannerCredentialResolver } from './credential-resolver.js';
import { planOutputSchema, createPlanSchema, type CreatePlanInput, type PlanOutput, type UnderstandingOutput } from './planner.schemas.js';
import { prioritizeAndValidate, planTimeline } from './plan-validator.js';
import { analyzePlanContext } from './context-analysis.js';
import { AiProviderError, type PlannerProvider, type GeminiResult } from './provider.types.js';
import { persistedCandidateSchema, type PersistedCandidate } from './version.schemas.js';

const HEARTBEAT_MS = 10_000;
const LEASE_CHECK_MAX_DELAY_MS = 2_147_000_000;
const jsonRecord = (value: unknown): Record<string, unknown> => isRecord(value) ? value : {};

type PersistedInput = CreatePlanInput & { consentVersion: string; contextSnapshot: unknown; revision?: PersistedCandidate };
type JobCheckpoint = {
  understanding?: UnderstandingOutput;
  clarificationRounds?: number;
  clarificationAnswers?: string[];
  allowAssumptions?: boolean;
  planOutput?: PlanOutput;
  prioritizedOutput?: PlanOutput;
  finalOutput?: PlanOutput;
};

export class AiJobRunner {
  private readonly repository: AiJobRepository;
  private readonly credentialResolver: PlannerCredentialResolver;
  private active = false;
  private stopping = false;
  private dirty = false;
  private drainTask: Promise<void> | undefined;
  private leaseTimer: NodeJS.Timeout | undefined;
  private readonly controllers = new Map<string, { creatorId: string; controller: AbortController }>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly environment: RuntimeEnvironment,
    credentialRepository: GeminiCredentialRepository,
    private readonly context: PlannerContextService,
    private readonly provider: PlannerProvider,
    private readonly logger: Logger,
  ) {
    this.repository = new AiJobRepository(prisma, context);
    this.credentialResolver = new PlannerCredentialResolver(credentialRepository, environment);
  }

  async start(): Promise<void> {
    if (!this.environment.AI_ENABLED || this.active) return;
    this.active = true;
    this.stopping = false;
    this.wake();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.active = false;
    if (this.leaseTimer) clearTimeout(this.leaseTimer);
    this.leaseTimer = undefined;
    for (const { controller } of this.controllers.values()) {
      controller.abort(new DOMException('The API is draining.', 'TimeoutError'));
    }
    if (this.drainTask) {
      let timeout: NodeJS.Timeout | undefined;
      await Promise.race([
        this.drainTask.catch(() => undefined),
        new Promise<void>((resolve) => { timeout = setTimeout(resolve, 20_000); }),
      ]);
      if (timeout) clearTimeout(timeout);
    }
  }

  wake(): void {
    if (!this.active || this.stopping) return;
    this.dirty = true;
    if (this.drainTask) return;
    this.drainTask = this.drain().catch((error: unknown) => {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      this.logger.error({ errorName }, 'AI job queue drain failed');
    }).finally(() => {
      this.drainTask = undefined;
      if (this.dirty && this.active && !this.stopping) this.wake();
      else void this.scheduleLeaseWake();
    });
  }

  abortJob(jobId: string): void {
    this.controllers.get(jobId)?.controller.abort(new DOMException('The user cancelled the request.', 'AbortError'));
  }

  abortUserJobs(userId: string): void {
    for (const job of this.controllers.values()) {
      if (job.creatorId === userId) job.controller.abort(new AiProviderError('AI_CREDENTIAL_CHANGED'));
    }
  }

  private async drain(): Promise<void> {
    do {
      this.dirty = false;
      if (!this.active || this.stopping) return;
      await this.repository.recoverExpired();
      while (this.active && !this.stopping) {
        const claimed = await this.repository.claimNext();
        if (!claimed) break;
        await this.process(claimed.job, claimed.leaseToken);
      }
    } while (this.dirty && this.active && !this.stopping);
  }

  private async process(job: AiJob, leaseToken: string): Promise<void> {
    const controller = new AbortController();
    this.controllers.set(job.id, { creatorId: job.creatorId, controller });
    const deadlineAt = (job.processingStartedAt ?? new Date()).getTime() + this.environment.AI_JOB_TIMEOUT_MS;
    const deadlineDelay = Math.max(0, deadlineAt - Date.now());
    const deadline = setTimeout(() => controller.abort(new DOMException('The AI job deadline was exceeded.', 'TimeoutError')), deadlineDelay);
    deadline.unref();
    const heartbeat = setInterval(() => {
      void this.repository.renewLease(job.id, leaseToken).then((renewed) => {
        if (!renewed) controller.abort(new Error('The AI job lease was lost.'));
      }).catch(() => controller.abort(new Error('The AI job lease could not be renewed.')));
    }, HEARTBEAT_MS);
    heartbeat.unref();

    try {
      await this.runPipeline(job, leaseToken, controller.signal);
    } catch (error) {
      if (error instanceof LeaseLostError) return;
      if (error instanceof PlannerAccessRevokedError) {
        await this.repository.fail(job.id, leaseToken, error.reason, 'FAILED').catch(ignoreLeaseLoss);
        return;
      }
      if (error instanceof ProviderAttemptLimitError) {
        await this.repository.fail(job.id, leaseToken, 'AI_RETRY_LIMIT_REACHED', 'FAILED').catch(ignoreLeaseLoss);
        return;
      }
      const code = safeJobErrorCode(error);
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      this.logger.warn({ jobId: job.id, errorName, code }, 'AI job failed safely');
      await this.repository.fail(job.id, leaseToken, code, code === 'AI_TIMEOUT' ? 'INTERRUPTED' : 'FAILED').catch(ignoreLeaseLoss);
    } finally {
      clearTimeout(deadline);
      clearInterval(heartbeat);
      this.controllers.delete(job.id);
    }
  }

  private async runPipeline(job: AiJob, leaseToken: string, signal: AbortSignal): Promise<void> {
    const input = parsePersistedInput(job.input);
    let checkpoint = parseCheckpoint(job.checkpoint);

    if (input.revision && !checkpoint.understanding) {
      checkpoint = {
        ...checkpoint,
        understanding: { summary: input.revision.baseDraft.goalSummary, assumptions: input.revision.baseDraft.assumptions, questions: [] },
      };
    }

    if (!checkpoint.understanding) {
      const prompt = JSON.stringify({ request: plannerPromptData(input), task: 'Analyze the goal, constraints, missing facts, and hard requirements.' });
      const result = await this.callProvider(job, leaseToken, signal, prompt, (key, callSignal) => this.provider.understand({ apiKey: key, model: job.model, prompt, signal: callSignal }), (value) => ({ ...checkpoint, understanding: value }));
      if (!result) return;
      checkpoint = { ...checkpoint, understanding: result.value };
    }

    const understanding = checkpoint.understanding;
    if (!understanding) throw new AiProviderError('AI_OUTPUT_INVALID');
    if (understanding.questions.length > 0 && !checkpoint.clarificationRounds) {
      await this.repository.waitForClarification(job.id, leaseToken, understanding.questions, checkpoint);
      return;
    }
    await this.repository.setStage(job.id, leaseToken, {
      key: 'understanding_goal', status: 'completed', summary: 'Goal and available context were reviewed.', checkpoint,
    });

    if (!checkpoint.planOutput) {
      await this.repository.setStage(job.id, leaseToken, { key: 'breaking_down_work', status: 'active' });
      const prompt = JSON.stringify({
        request: plannerPromptData(input),
        understanding: { summary: understanding.summary, assumptions: understanding.assumptions },
        clarification: { answers: checkpoint.clarificationAnswers ?? [], allowAssumptions: checkpoint.allowAssumptions ?? false },
        ...(input.revision ? {
          revision: {
            action: input.revision.action,
            baseVersionId: input.revision.baseVersionId,
            baseDraft: input.revision.baseDraft,
            targetItemIds: input.revision.itemIds,
            fieldMask: input.revision.fieldMask,
            lockedFields: input.revision.fieldLocks.filter((lock) => !input.revision?.overrideLocks.some((override) => override.itemId === lock.itemId && override.field === lock.field)),
            explicitOverrides: input.revision.overrideLocks,
          },
        } : {}),
        task: input.revision
          ? 'Return the complete structured plan and preserve every item ID. Change only requested fields for target items. Keep locked fields unchanged. Dependencies must remain valid.'
          : input.strategy === 'QUALITY_FIRST'
            ? 'Create a structured task plan. Include review, testing, and acceptance work where required by the goal. Preserve all hard requirements and constraints. Draft dependencies must refer only to IDs of items in this response.'
            : input.strategy === 'FASTEST'
              ? 'Create a structured task plan that reaches the goal quickly. Parallelize independent work only when the selected member capacity and working days support it. Preserve all hard requirements and constraints. Draft dependencies must refer only to IDs of items in this response.'
              : 'Create a structured task plan with balanced priority, effort, workload, and deadlines. Preserve all hard requirements and constraints. Draft dependencies must refer only to IDs of items in this response.',
      });
      const result = await this.callProvider(job, leaseToken, signal, prompt,
        (key, callSignal) => this.provider.generate({ apiKey: key, model: job.model, prompt, signal: callSignal }),
        (value) => ({ ...checkpoint, planOutput: value }));
      if (!result) return;
      checkpoint = { ...checkpoint, planOutput: result.value };
    }
    const parsed = planOutputSchema.safeParse(checkpoint.planOutput);
    if (!parsed.success) throw new AiProviderError('AI_OUTPUT_INVALID');
    checkpoint = { ...checkpoint, planOutput: parsed.data };
    await this.repository.setStage(job.id, leaseToken, {
      key: 'breaking_down_work', status: 'completed',
      summary: `${parsed.data.items.length} candidate items passed schema validation.`, checkpoint,
    });

    if (!checkpoint.prioritizedOutput) {
      await this.repository.setStage(job.id, leaseToken, { key: 'prioritizing_tasks', status: 'active' });
      checkpoint = { ...checkpoint, prioritizedOutput: prioritizeAndValidate(parsed.data, input.strategy) };
    }
    const prioritized = planOutputSchema.parse(checkpoint.prioritizedOutput);
    await this.repository.setStage(job.id, leaseToken, {
      key: 'prioritizing_tasks', status: 'completed',
      summary: `${prioritized.items.length} items were ordered by dependencies and priority.`, checkpoint,
    });

    if (!checkpoint.finalOutput) {
      await this.repository.setStage(job.id, leaseToken, { key: 'planning_timeline', status: 'active' });
      checkpoint = { ...checkpoint, finalOutput: planTimeline(input, prioritized) };
    }
    const finalOutput = planOutputSchema.parse(checkpoint.finalOutput);
    await this.repository.setStage(job.id, leaseToken, {
      key: 'planning_timeline', status: 'completed',
      summary: `${finalOutput.warnings.length} schedule or context warning${finalOutput.warnings.length === 1 ? '' : 's'} were recorded.`, checkpoint,
    });

    await this.repository.setStage(job.id, leaseToken, { key: 'preparing_plan', status: 'active' });
    await this.context.assertCurrentAccess(job.creatorId, job.workspaceId, job.teamId);
    if (!(await this.credentialResolver.matchesCurrent(job.creatorId, job.credentialRevision))) {
      throw new PlannerAccessRevokedError('AI_CREDENTIAL_CHANGED');
    }
    const analysis = analyzePlanContext(input, input.contextSnapshot, finalOutput, input.revision);
    const completionDraft = input.revision ? mergeRevisionCandidate(analysis.output, input.revision) : analysis.output;
    await this.repository.complete(job.id, leaseToken, completionDraft, input.revision, analysis.assigneeSuggestions);
  }

  private async callProvider<T>(
    job: AiJob,
    leaseToken: string,
    jobSignal: AbortSignal,
    prompt: string,
    call: (apiKey: string, signal: AbortSignal) => Promise<GeminiResult<T>>,
    checkpointForResult: (value: T) => JobCheckpoint,
  ): Promise<GeminiResult<T> | null> {
    if (jobSignal.aborted) throw new AiProviderError('AI_TIMEOUT');
    const estimatedTokens = Math.ceil(Buffer.byteLength(prompt, 'utf8') / 3);
    if (estimatedTokens > job.maxInputTokens) throw new HttpError(413, 'AI_INPUT_TOO_LARGE', 'The selected input exceeds the configured token limit.');
    await this.context.assertCurrentAccess(job.creatorId, job.workspaceId, job.teamId);
    const apiKey = await this.credentialResolver.resolve(job.creatorId, job.credentialRevision);
    await this.repository.startProviderAttempt(job.id, leaseToken);
    const timedSignal = AbortSignal.any([jobSignal, AbortSignal.timeout(this.environment.AI_PROVIDER_TIMEOUT_MS)]);

    let result: GeminiResult<T>;
    try {
      result = await call(apiKey, timedSignal);
    } catch (error) {
      const providerError = error instanceof AiProviderError ? error :
        timedSignal.aborted ? new AiProviderError('AI_TIMEOUT') : new AiProviderError('AI_PROVIDER_UNAVAILABLE');
      const unknown = ['AI_TIMEOUT', 'AI_CANCELLED', 'AI_CREDENTIAL_CHANGED', 'AI_PROVIDER_UNAVAILABLE'].includes(providerError.code);
      await this.repository.finishProviderFailure(job.id, leaseToken, { code: providerError.code, unknown }).catch(ignoreLeaseLoss);
      return null;
    }

    try {
      await this.context.assertCurrentAccess(job.creatorId, job.workspaceId, job.teamId);
      if (!(await this.credentialResolver.matchesCurrent(job.creatorId, job.credentialRevision))) {
        await this.repository.recordProviderResult(job.id, leaseToken, { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens });
        await this.repository.fail(job.id, leaseToken, 'AI_CREDENTIAL_CHANGED', 'FAILED');
        return null;
      }
    } catch (error) {
      if (error instanceof LeaseLostError) return null;
      await this.repository.recordProviderResult(job.id, leaseToken, { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens }).catch(ignoreLeaseLoss);
      await this.repository.fail(job.id, leaseToken, 'ACCESS_REVOKED', 'FAILED').catch(ignoreLeaseLoss);
      return null;
    }

    if (result.usage.inputTokens > job.maxInputTokens || result.usage.outputTokens > job.maxOutputTokens) {
      await this.repository.recordProviderResult(job.id, leaseToken, { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens });
      await this.repository.fail(job.id, leaseToken, 'AI_TOKEN_LIMIT_EXCEEDED', 'FAILED');
      return null;
    }
    await this.repository.recordProviderResult(job.id, leaseToken, {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      checkpoint: checkpointForResult(result.value),
    });
    return result;
  }

  private async scheduleLeaseWake(): Promise<void> {
    if (!this.active || this.stopping) return;
    const expiry = await this.repository.nextLeaseExpiry().catch(() => null);
    if (this.leaseTimer) clearTimeout(this.leaseTimer);
    if (!expiry) return;
    const delay = Math.max(1, Math.min(LEASE_CHECK_MAX_DELAY_MS, expiry.getTime() - Date.now()));
    this.leaseTimer = setTimeout(() => {
      this.leaseTimer = undefined;
      this.wake();
    }, delay);
    this.leaseTimer.unref();
  }
}

function parsePersistedInput(value: unknown): PersistedInput {
  if (!isRecord(value)) throw new Error('Stored planner input is invalid.');
  const { contextSnapshot, consentVersion: _consentVersion, revision, ...request } = value;
  void _consentVersion;
  const parsed = createPlanSchema.safeParse(request);
  if (!parsed.success) throw new Error('Stored planner input is invalid.');
  const candidate = revision === undefined ? undefined : persistedCandidateSchema.parse(revision);
  return { ...parsed.data, consentVersion: '2026-10', contextSnapshot, ...(candidate ? { revision: candidate } : {}) };
}

function mergeRevisionCandidate(generated: PlanOutput, revision: PersistedCandidate): PlanOutput {
  const targets = new Set(revision.itemIds);
  const mask = new Set(revision.fieldMask);
  const overrides = new Set(revision.overrideLocks.map((lock) => `${lock.itemId}:${lock.field}`));
  const locks = new Set(revision.fieldLocks.map((lock) => `${lock.itemId}:${lock.field}`));
  const generatedItems = new Map(generated.items.map((item) => [item.id, item]));
  const items = revision.baseDraft.items.map((base) => {
    const {
      selected: _selected, assigneeId: _assigneeId, position: _position,
      ...baseContent
    } = base;
    void _selected;
    void _assigneeId;
    void _position;
    const providerItem = generatedItems.get(base.id);
    if (targets.has(base.id) && !providerItem) throw new AiProviderError('AI_OUTPUT_INVALID');
    const merged = { ...baseContent };
    if (targets.has(base.id) && providerItem) {
      for (const field of mask) {
        if (locks.has(`${base.id}:${field}`) && !overrides.has(`${base.id}:${field}`)) continue;
        Object.assign(merged, { [field]: providerItem[field] });
      }
    }
    return merged;
  });
  const candidate = {
    planTitle: revision.baseDraft.planTitle,
    goalSummary: revision.baseDraft.goalSummary,
    assumptions: revision.baseDraft.assumptions,
    warnings: [...new Set([...revision.baseDraft.warnings, ...generated.warnings])].slice(0, 20),
    items,
  };
  const parsed = planOutputSchema.safeParse(candidate);
  if (!parsed.success) throw new AiProviderError('AI_OUTPUT_INVALID');
  return parsed.data;
}

function parseCheckpoint(value: unknown): JobCheckpoint {
  if (!isRecord(value)) return {};
  return value as JobCheckpoint;
}

function plannerPromptData(input: PersistedInput) {
  const context = isRecord(input.contextSnapshot) ? input.contextSnapshot : {};
  const tasks = Array.isArray(context.tasks) ? context.tasks : [];
  const members = Array.isArray(context.members) ? context.members : [];
  const memberAliases = new Map(members.flatMap((member) => {
    const row = jsonRecord(member);
    return typeof row.id === 'string' && typeof row.alias === 'string' ? [[row.id, row.alias] as const] : [];
  }));
  return {
    goal: input.goal,
    constraints: input.constraints,
    detailLevel: input.detailLevel,
    strategy: input.strategy,
    startDate: input.startDate,
    targetDate: input.targetDate,
    durationDays: input.durationDays,
    selectedTasks: tasks.map((task, index) => {
      const row = jsonRecord(task);
      return {
        reference: `existing-${String(index + 1).padStart(2, '0')}`,
        title: row.title, description: row.description, status: row.status, priority: row.priority,
        estimateMinMinutes: row.estimateMinMinutes, estimateMaxMinutes: row.estimateMaxMinutes,
        dueDate: row.dueDate, plannedStartDate: row.plannedStartDate,
        assignee: typeof row.assigneeId === 'string' ? memberAliases.get(row.assigneeId) ?? null : null,
      };
    }),
    selectedMembers: members.map((member) => {
      const row = jsonRecord(member);
      return {
        alias: row.alias,
        capacityMinutesPerDay: row.capacityMinutesPerDay,
        workingDays: row.workingDays,
        role: row.role,
      };
    }),
    contextLimitNote: tasks.length || members.length ? 'Only selected context is provided; all other team facts are unknown.' : 'No existing task or member details were selected.',
  };
}

function safeJobErrorCode(error: unknown): string {
  if (error instanceof PlannerPlanError) return error.code;
  if (error instanceof HttpError) {
    if (error.code === 'AI_INPUT_TOO_LARGE') return 'AI_INPUT_TOO_LARGE';
    if (error.code === 'AI_CREDENTIAL_CHANGED' || error.code === 'AI_CREDENTIAL_UNAVAILABLE') return error.code;
    return error.statusCode === 404 ? 'ACCESS_REVOKED' : 'AI_PROVIDER_UNAVAILABLE';
  }
  if (error instanceof AiProviderError) return error.code;
  if (error instanceof ProviderAttemptLimitError) return 'AI_RETRY_LIMIT_REACHED';
  return 'AI_PROVIDER_UNAVAILABLE';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ignoreLeaseLoss(error: unknown): void {
  if (!(error instanceof LeaseLostError)) throw error;
}
