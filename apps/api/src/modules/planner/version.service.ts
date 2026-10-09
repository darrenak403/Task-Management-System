import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient, type AiPlan, type AiPlanVersion } from '../../generated/prisma/client.js';
import { resourceNotFound } from '../../shared/authorization/policy.js';
import { HttpError } from '../../shared/http/error-handler.js';
import { pageMeta, paginationOffset, type PaginationInput } from '../../shared/http/pagination.js';
import { appendRealtimeEvents } from '../realtime/outbox.js';
import type { PlannerContextService } from './context.service.js';
import type { RuntimeEnvironment } from '../../shared/config/env.js';
import { planDraftContentSchema, type ManualVersionRequest, type PlanDraftContent, type PlannerFieldLock } from './version.schemas.js';

type Scope = { workspaceId: string; teamId: string };
type VersionLock = { id: string; status: string; expires_at: Date };
type StoredDraft = PlanDraftContent & {
  schemaVersion: 1;
  source: 'GENERATED' | 'EDITED' | 'REGENERATED' | 'ADJUSTED';
  fieldLocks: PlannerFieldLock[];
};
const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

export class AiPlanVersionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly context: PlannerContextService,
    private readonly environment: RuntimeEnvironment,
  ) {}

  async listPlans(userId: string, scope: Scope, pagination: PaginationInput) {
    await this.context.assertCurrentAccess(userId, scope.workspaceId, scope.teamId);
    const where = { creatorId: userId, ...scope };
    const [plans, total] = await Promise.all([
      this.prisma.aiPlan.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: paginationOffset(pagination),
        take: pagination.pageSize,
        select: {
          id: true, status: true, activeVersionId: true, createdAt: true, updatedAt: true, expiresAt: true,
          jobs: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, status: true, currentStage: true, sequence: true } },
        },
      }),
      this.prisma.aiPlan.count({ where }),
    ]);
    return {
      data: plans.map((plan) => ({
        id: plan.id, status: plan.status, activeVersionId: plan.activeVersionId,
        createdAt: plan.createdAt.toISOString(), updatedAt: plan.updatedAt.toISOString(), expiresAt: plan.expiresAt.toISOString(),
        latestJob: plan.jobs[0] ?? null,
      })),
      meta: pageMeta(pagination, total),
      availability: await this.status(userId),
    };
  }

  async listVersions(userId: string, scope: Scope, planId: string, pagination: PaginationInput) {
    await this.requireOwnedPlan(userId, scope, planId);
    const where = { planId };
    const [versions, total, plan] = await Promise.all([
      this.prisma.aiPlanVersion.findMany({
        where,
        orderBy: [{ ordinal: 'desc' }, { id: 'desc' }],
        skip: paginationOffset(pagination),
        take: pagination.pageSize,
        select: { id: true, ordinal: true, source: true, baseVersionId: true, contentHash: true, createdAt: true },
      }),
      this.prisma.aiPlanVersion.count({ where }),
      this.prisma.aiPlan.findUniqueOrThrow({ where: { id: planId }, select: { activeVersionId: true, purgedAt: true } }),
    ]);
    return {
      data: versions.map((version) => ({
        ...version, active: plan.activeVersionId === version.id, purged: plan.purgedAt !== null,
        createdAt: version.createdAt.toISOString(),
      })),
      meta: pageMeta(pagination, total),
    };
  }

  async getVersion(userId: string, scope: Scope, planId: string, versionId: string) {
    const plan = await this.requireOwnedPlan(userId, scope, planId);
    if (plan.purgedAt || plan.expiresAt <= new Date() || plan.status === 'EXPIRED') {
      throw new HttpError(410, 'VERSION_EXPIRED', 'This plan version has expired.');
    }
    const version = await this.prisma.aiPlanVersion.findFirst({ where: { id: versionId, planId } });
    if (!version) throw resourceNotFound();
    return {
      data: {
        id: version.id, ordinal: version.ordinal, parentVersionId: version.parentVersionId,
        baseVersionId: version.baseVersionId, source: version.source, schemaVersion: version.schemaVersion,
        draft: version.draft, fieldLocks: version.fieldLocks, contentHash: version.contentHash,
        createdAt: version.createdAt.toISOString(),
      },
    };
  }

  async saveManualVersion(userId: string, scope: Scope, planId: string, input: ManualVersionRequest) {
    const created = await this.prisma.$transaction(async (tx) => {
      const assigneeIds = [...new Set(input.draft.items.flatMap((item) => item.assigneeId ? [item.assigneeId] : []))];
      await this.context.lockAndCheckAccess(tx, userId, scope.workspaceId, scope.teamId, { additionalMemberIds: assigneeIds });
      const plan = await this.lockOwnedPlan(tx, userId, scope, planId);
      assertEditablePlan(plan);
      if (plan.activeVersionId !== input.expectedActiveVersionId) throw versionConflict();

      const parent = plan.activeVersionId
        ? await tx.aiPlanVersion.findFirst({ where: { id: plan.activeVersionId, planId }, select: { inputSnapshot: true, contextSnapshot: true } })
        : null;
      const contextTaskIds = getContextTaskIds(parent?.contextSnapshot ?? null);
      validateDependencies(input.draft, contextTaskIds);
      const maxOrdinal = await tx.aiPlanVersion.aggregate({ where: { planId }, _max: { ordinal: true } });
      const ordinal = (maxOrdinal._max.ordinal ?? 0) + 1;
      const draft = storedDraft(input.draft, 'EDITED', input.fieldLocks);
      const contentHash = hashJson(draft);
      const version = await tx.aiPlanVersion.create({
        data: {
          planId, ordinal, parentVersionId: plan.activeVersionId, baseVersionId: plan.activeVersionId,
          source: 'EDITED', schemaVersion: 1, draft: json(draft),
          inputSnapshot: parent?.inputSnapshot ?? json({ source: 'manual' }),
          contextSnapshot: parent?.contextSnapshot ?? Prisma.DbNull,
          fieldLocks: json(input.fieldLocks), contentHash,
        },
      });
      await tx.aiPlan.update({ where: { id: planId }, data: { activeVersionId: version.id } });
      await appendPlanVersionEvent(tx, plan, version, 'A manual plan revision is available.');
      return toVersionDto(version, true);
    }, { timeout: 10_000 });
    return { data: created };
  }

  async activateCandidate(userId: string, scope: Scope, planId: string, versionId: string, expectedActiveVersionId: string | null) {
    const candidateHint = await this.prisma.aiPlanVersion.findFirst({
      where: { id: versionId, planId, plan: { id: planId, creatorId: userId, ...scope } },
      select: { draft: true },
    });
    const parsedHint = candidateHint ? planDraftContentSchema.safeParse(stripVersionMetadata(candidateHint.draft)) : null;
    const assigneeIds = parsedHint?.success
      ? [...new Set(parsedHint.data.items.flatMap((item) => item.assigneeId ? [item.assigneeId] : []))]
      : [];
    return this.prisma.$transaction(async (tx) => {
      await this.context.lockAndCheckAccess(tx, userId, scope.workspaceId, scope.teamId, { additionalMemberIds: assigneeIds });
      const plan = await this.lockOwnedPlan(tx, userId, scope, planId);
      assertEditablePlan(plan);
      if (plan.activeVersionId !== expectedActiveVersionId) throw versionConflict();
      const candidate = await tx.aiPlanVersion.findFirst({ where: { id: versionId, planId } });
      if (!candidate) throw resourceNotFound();
      if (candidate.source === 'EDITED' || candidate.baseVersionId !== expectedActiveVersionId) throw versionConflict();
      const parsed = planDraftContentSchema.safeParse(stripVersionMetadata(candidate.draft));
      if (!parsed.success) throw new HttpError(410, 'VERSION_EXPIRED', 'This plan version is no longer available.');
      const contextTaskIds = getContextTaskIds(candidate.contextSnapshot);
      validateDependencies(parsed.data, contextTaskIds);
      await tx.aiPlan.update({ where: { id: planId }, data: { activeVersionId: candidate.id } });
      await appendPlanVersionEvent(tx, plan, candidate, 'A generated plan revision was accepted.');
      return { data: { planId, activeVersionId: candidate.id, source: candidate.source } };
    }, { timeout: 10_000 });
  }

  async clonePlan(userId: string, scope: Scope, sourcePlanId: string, requestKey: string) {
    const requestHash = hashJson({ sourcePlanId });
    try {
      const cloned = await this.prisma.$transaction(async (tx) => {
        await this.context.lockAndCheckAccess(tx, userId, scope.workspaceId, scope.teamId);
        const prior = await tx.aiPlan.findFirst({
          where: { creatorId: userId, ...scope, cloneRequestKey: requestKey },
          select: { id: true, cloneRequestHash: true, activeVersionId: true, status: true },
        });
        if (prior) {
          if (prior.cloneRequestHash !== requestHash) throw idempotencyConflict();
          return { planId: prior.id, activeVersionId: prior.activeVersionId, status: prior.status };
        }

        const source = await this.lockOwnedPlan(tx, userId, scope, sourcePlanId);
        if (source.purgedAt || source.expiresAt <= new Date() || !source.activeVersionId) {
          throw new HttpError(410, 'PLAN_EXPIRED', 'This plan can no longer be cloned.');
        }
        const sourceVersion = await tx.aiPlanVersion.findFirst({ where: { id: source.activeVersionId, planId: sourcePlanId } });
        if (!sourceVersion) throw resourceNotFound();
        const parsed = planDraftContentSchema.safeParse(stripVersionMetadata(sourceVersion.draft));
        if (!parsed.success) throw new HttpError(410, 'VERSION_EXPIRED', 'This plan version has expired.');

        const idMap = new Map(parsed.data.items.map((item) => [item.id, randomUUID()]));
        const warnings = [...parsed.data.warnings, 'Review and select tasks before importing this clone. Previous assignments and linked existing tasks were not copied.'];
        const content: PlanDraftContent = {
          ...parsed.data,
          warnings: [...new Set(warnings)].slice(0, 20),
          items: parsed.data.items.map((item) => ({
            ...item,
            id: idMap.get(item.id) ?? randomUUID(),
            selected: false,
            assigneeId: null,
            dependencies: item.dependencies.flatMap((dependency) => idMap.get(dependency) ?? []),
          })),
        };
        const draft = storedDraft(content, 'EDITED', []);
        const now = new Date();
        const plan = await tx.aiPlan.create({
          data: {
            workspaceId: scope.workspaceId, teamId: scope.teamId, creatorId: userId,
            expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000),
            cloneRequestKey: requestKey, cloneRequestHash: requestHash,
          },
        });
        const version = await tx.aiPlanVersion.create({
          data: {
            planId: plan.id, ordinal: 1, source: 'EDITED', schemaVersion: 1,
            draft: json(draft), inputSnapshot: json(cloneInputSnapshot(sourceVersion.inputSnapshot, sourcePlanId)),
            contextSnapshot: Prisma.DbNull, fieldLocks: json([]), contentHash: hashJson(draft),
          },
        });
        await tx.aiPlan.update({ where: { id: plan.id }, data: { activeVersionId: version.id } });
        await appendPlanVersionEvent(tx, plan, version, 'A plan clone is ready for review.');
        return { planId: plan.id, activeVersionId: version.id, status: 'DRAFT' as const };
      }, { timeout: 12_000 });
      return { data: cloned };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const prior = await this.prisma.aiPlan.findFirst({
        where: { creatorId: userId, ...scope, cloneRequestKey: requestKey },
        select: { id: true, cloneRequestHash: true, activeVersionId: true, status: true },
      });
      if (!prior) throw error;
      if (prior.cloneRequestHash !== requestHash) throw idempotencyConflict();
      return { data: { planId: prior.id, activeVersionId: prior.activeVersionId, status: prior.status } };
    }
  }

  async lockOwnedPlan(tx: Prisma.TransactionClient, userId: string, scope: Scope, planId: string): Promise<AiPlan> {
    const locked = await tx.$queryRaw<VersionLock[]>`
      SELECT id, status::text AS status, expires_at FROM ai_plans
      WHERE id = ${planId}::uuid AND creator_id = ${userId}::uuid
        AND workspace_id = ${scope.workspaceId}::uuid AND team_id = ${scope.teamId}::uuid
      FOR UPDATE
    `;
    if (!locked[0]) throw resourceNotFound();
    return tx.aiPlan.findUniqueOrThrow({ where: { id: planId } });
  }

  private async requireOwnedPlan(userId: string, scope: Scope, planId: string) {
    await this.context.assertCurrentAccess(userId, scope.workspaceId, scope.teamId);
    const plan = await this.prisma.aiPlan.findFirst({
      where: { id: planId, creatorId: userId, ...scope },
      select: { id: true, activeVersionId: true, purgedAt: true, status: true, expiresAt: true },
    });
    if (!plan) throw resourceNotFound();
    return plan;
  }

  private async status(userId: string) {
    const [rows, credential] = await Promise.all([
      this.prisma.$queryRaw<Array<{ quarantined: boolean }>>`
        SELECT quarantined FROM ai_runtime_control WHERE id = 1
      `,
      this.prisma.userGeminiCredential.findUnique({ where: { userId }, select: { model: true, verifiedAt: true } }),
    ]);
    const quarantined = rows[0]?.quarantined !== false;
    const credentialRequired = !credential?.verifiedAt;
    const modelRequired = Boolean(credential?.verifiedAt && !credential.model);
    const available = this.environment.AI_ENABLED && !quarantined && !credentialRequired && !modelRequired;
    return {
      available,
      model: credential?.model ?? null,
      credentialRequired,
      unavailableReason: quarantined ? 'restore_quarantine'
        : !this.environment.AI_ENABLED ? this.environment.aiUnavailableReason
          : credentialRequired ? 'credential_required' : modelRequired ? 'model_required' : this.environment.aiUnavailableReason,
    };
  }
}

function assertEditablePlan(plan: AiPlan): void {
  if (plan.expiresAt <= new Date() || plan.status === 'EXPIRED') throw new HttpError(410, 'PLAN_EXPIRED', 'This plan has expired.');
  if (plan.status !== 'DRAFT') throw new HttpError(409, 'PLAN_NOT_EDITABLE', 'Imported plans can only be edited through a new clone.');
}

function storedDraft(content: PlanDraftContent, source: StoredDraft['source'], fieldLocks: PlannerFieldLock[]): StoredDraft {
  const parsed = planDraftContentSchema.parse(content);
  return {
    ...parsed,
    schemaVersion: 1,
    source,
    fieldLocks: [...fieldLocks].sort((left, right) => `${left.itemId}:${left.field}`.localeCompare(`${right.itemId}:${right.field}`)),
    items: [...parsed.items].sort((left, right) => left.position - right.position),
  };
}

function stripVersionMetadata(value: Prisma.JsonValue): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const { schemaVersion: _schemaVersion, source: _source, fieldLocks: _fieldLocks, ...content } = value;
  void _schemaVersion;
  void _source;
  void _fieldLocks;
  return content;
}

function getContextTaskIds(value: Prisma.JsonValue | null): Set<string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || !('tasks' in value) || !Array.isArray(value.tasks)) return new Set();
  return new Set(value.tasks.flatMap((task) =>
    typeof task === 'object' && task !== null && 'id' in task && typeof task.id === 'string' ? [task.id] : []));
}

function cloneInputSnapshot(value: Prisma.JsonValue, sourcePlanId: string): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { clonedFromPlanId: sourcePlanId };
  const { revision: _revision, contextSnapshot: _contextSnapshot, ...input } = value;
  void _revision;
  void _contextSnapshot;
  return {
    ...input,
    includeExistingTasks: false,
    existingTaskIds: [],
    includeMembers: false,
    memberIds: [],
    memberProfiles: [],
    clonedFromPlanId: sourcePlanId,
  };
}

function validateDependencies(draft: PlanDraftContent, contextTaskIds: Set<string>): void {
  const itemIds = new Set(draft.items.map((item) => item.id));
  for (const [index, item] of draft.items.entries()) {
    const missing = item.dependencies.some((dependency) => !itemIds.has(dependency) && !contextTaskIds.has(dependency));
    if (missing) throw new HttpError(422, 'INVALID_PLAN', `A dependency on item ${index + 1} is not in this plan or its approved context.`);
  }
  const indegree = new Map(draft.items.map((item) => [item.id, 0]));
  const dependents = new Map(draft.items.map((item) => [item.id, [] as string[]]));
  for (const item of draft.items) {
    for (const dependency of item.dependencies) {
      if (!itemIds.has(dependency)) continue;
      indegree.set(item.id, (indegree.get(item.id) ?? 0) + 1);
      dependents.get(dependency)?.push(item.id);
    }
  }
  const ready = [...indegree].filter(([, degree]) => degree === 0).map(([id]) => id);
  let visited = 0;
  while (ready.length > 0) {
    const itemId = ready.pop();
    if (!itemId) continue;
    visited += 1;
    for (const dependent of dependents.get(itemId) ?? []) {
      const degree = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, degree);
      if (degree === 0) ready.push(dependent);
    }
  }
  if (visited !== draft.items.length) throw new HttpError(422, 'DEPENDENCY_CYCLE', 'The draft dependencies contain a cycle.');
}

function versionConflict(): HttpError {
  return new HttpError(409, 'VERSION_CONFLICT', 'The active plan version changed. Reload the plan before saving or accepting this revision.');
}

function idempotencyConflict(): HttpError {
  return new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'This request key was already used with a different operation.');
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

function toVersionDto(version: AiPlanVersion, active: boolean) {
  return {
    id: version.id, ordinal: version.ordinal, source: version.source, baseVersionId: version.baseVersionId,
    draft: version.draft, fieldLocks: version.fieldLocks, contentHash: version.contentHash,
    active, createdAt: version.createdAt.toISOString(),
  };
}

async function appendPlanVersionEvent(
  tx: Prisma.TransactionClient,
  plan: Pick<AiPlan, 'id' | 'workspaceId' | 'teamId' | 'creatorId'>,
  version: Pick<AiPlanVersion, 'id' | 'ordinal'>,
  summary: string,
): Promise<void> {
  await appendRealtimeEvents(tx, [{
    eventType: 'planner.plan_changed', workspaceId: plan.workspaceId, teamId: plan.teamId,
    targetUserId: plan.creatorId, resourceId: plan.id,
    payload: { versionId: version.id, versionOrdinal: version.ordinal, summary },
  }]);
}
