import { describe, expect, it } from 'vitest';
import { analyzePlanContext } from '../../src/modules/planner/context-analysis.js';
import { planTimeline, prioritizeAndValidate } from '../../src/modules/planner/plan-validator.js';
import { createPlanSchema, type CreatePlanInput, type PlanOutput } from '../../src/modules/planner/planner.schemas.js';
import { successfulPlan } from '../fakes/fake-gemini.js';

const consent = {
  providerDisclosureAccepted: true as const,
  billingAuthorityConfirmed: true as const,
  selectedContextReviewed: true as const,
};

function createInput(overrides: Partial<CreatePlanInput> = {}): CreatePlanInput {
  return createPlanSchema.parse({
    requestKey: 'planner-analysis-test-01',
    goal: 'Create a reviewable release plan for the team.',
    constraints: '',
    detailLevel: 'BALANCED',
    strategy: 'BALANCED',
    consent,
    ...overrides,
  });
}

function item(
  id: string,
  title: string,
  priority: PlanOutput['items'][number]['priority'],
  estimateMaxMinutes: number,
  dependencies: string[] = [],
  schedule: PlanOutput['items'][number]['schedule'] = { mode: 'NONE' },
): PlanOutput['items'][number] {
  const template = successfulPlan().items[0]!;
  return {
    ...template,
    id,
    title,
    priority,
    estimateMinMinutes: Math.min(template.estimateMinMinutes ?? estimateMaxMinutes, estimateMaxMinutes),
    estimateMaxMinutes,
    dependencies,
    schedule,
  };
}

function output(items: PlanOutput['items']): PlanOutput {
  return { ...successfulPlan(), items };
}

describe('AI planner analysis and timeline', () => {
  it('applies strategy ordering while preserving dependency order', () => {
    const source = output([
      item('cf0ec9e4-80d4-45d1-8ee0-ea18a8fa7d11', 'Slow high priority', 'HIGH', 300),
      item('cf0ec9e4-80d4-45d1-8ee0-ea18a8fa7d12', 'Quick low priority', 'LOW', 30),
      item('cf0ec9e4-80d4-45d1-8ee0-ea18a8fa7d13', 'Dependent task', 'HIGH', 10, ['cf0ec9e4-80d4-45d1-8ee0-ea18a8fa7d12']),
    ]);

    const fastest = prioritizeAndValidate(source, 'FASTEST').items.map((entry) => entry.title);
    const balanced = prioritizeAndValidate(source, 'BALANCED').items.map((entry) => entry.title);

    expect(fastest).toEqual(['Quick low priority', 'Dependent task', 'Slow high priority']);
    expect(balanced).toEqual(['Slow high priority', 'Quick low priority', 'Dependent task']);
  });

  it('reports capacity overload, dependency timing conflict, duplicate task, and a real member suggestion', () => {
    const memberId = 'cf0ec9e4-80d4-45d1-8ee0-ea18a8fa7d21';
    const prerequisiteId = 'cf0ec9e4-80d4-45d1-8ee0-ea18a8fa7d22';
    const proposedId = 'cf0ec9e4-80d4-45d1-8ee0-ea18a8fa7d23';
    const input = createInput({
      startDate: '2026-10-12',
      durationDays: 5,
      includeMembers: true,
      memberIds: [memberId],
    });
    const plan = output([
      item(prerequisiteId, 'Prepare deployment', 'HIGH', 60, [], { mode: 'RELATIVE', startDay: 2, dueDay: 3 }),
      item(proposedId, 'Define API contract', 'HIGH', 120, [prerequisiteId], { mode: 'RELATIVE', startDay: 1, dueDay: 2 }),
    ]);
    const context = {
      members: [{ id: memberId, alias: 'Member A', capacityMinutesPerDay: 60, role: 'Backend developer', workingDays: [1, 2, 3, 4, 5] }],
      tasks: [{
        id: 'existing-task', title: 'Define API contract', status: 'IN_PROGRESS', assigneeId: memberId,
        estimateMaxMinutes: 60, dueDate: null, plannedStartDate: null, relativeStartDay: 1, relativeDueDay: 1,
      }],
    };

    const analyzed = analyzePlanContext(input, context, plan);

    expect(analyzed.assigneeSuggestions.get(proposedId)).toBe(memberId);
    expect(analyzed.output.warnings.some((warning) => warning.includes('above the declared 60-minute daily capacity'))).toBe(true);
    expect(analyzed.output.warnings.some((warning) => warning.includes('scheduled before its prerequisite'))).toBe(true);
    expect(analyzed.output.warnings.some((warning) => warning.includes('Possible duplicate'))).toBe(true);
  });

  it('keeps dates unspecified when a relative plan has no user-provided anchor', () => {
    const source = output([
      item('cf0ec9e4-80d4-45d1-8ee0-ea18a8fa7d31', 'Unanchored task', 'MEDIUM', 90, [], { mode: 'RELATIVE', startDay: 1, dueDay: 2 }),
    ]);

    const planned = planTimeline(createInput(), source);

    expect(planned.items[0]?.schedule).toEqual({ mode: 'NONE' });
    expect(planned.warnings).toContain('No date anchor or duration was supplied; the plan keeps schedule dates unspecified.');
  });
});
