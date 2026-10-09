export const PLANNER_STAGES = [
  { key: 'understanding_goal', label: 'Understanding your goal' },
  { key: 'breaking_down_work', label: 'Breaking down the work' },
  { key: 'prioritizing_tasks', label: 'Prioritizing tasks' },
  { key: 'planning_timeline', label: 'Planning the timeline' },
  { key: 'preparing_plan', label: 'Preparing your plan' },
] as const;

export type PlannerStageKey = (typeof PLANNER_STAGES)[number]['key'];
export type PlannerStageStatus = 'pending' | 'active' | 'completed' | 'failed' | 'skipped';
export type PlannerStage = {
  key: PlannerStageKey;
  label: string;
  status: PlannerStageStatus;
  startedAt: string | null;
  completedAt: string | null;
  summary: string | null;
};

export function initialStages(): PlannerStage[] {
  return PLANNER_STAGES.map(({ key, label }) => ({ key, label, status: 'pending', startedAt: null, completedAt: null, summary: null }));
}

export function stageTransition(
  stagesInput: unknown,
  key: PlannerStageKey,
  status: PlannerStageStatus,
  now: Date,
  summary: string | null = null,
): PlannerStage[] {
  const stages = Array.isArray(stagesInput) ? stagesInput as PlannerStage[] : initialStages();
  return stages.map((stage) => stage.key === key
    ? {
      ...stage,
      status,
      startedAt: status === 'active' ? stage.startedAt ?? now.toISOString() : stage.startedAt,
      completedAt: status === 'completed' || status === 'failed' || status === 'skipped' ? now.toISOString() : stage.completedAt,
      summary: summary ?? stage.summary,
    }
    : stage);
}

export function activateStage(stagesInput: unknown, key: PlannerStageKey, now: Date): PlannerStage[] {
  let stages = Array.isArray(stagesInput) ? stagesInput as PlannerStage[] : initialStages();
  const targetIndex = stages.findIndex((stage) => stage.key === key);
  stages = stages.map((stage, index) => {
    if (index < targetIndex && stage.status === 'pending') {
      return { ...stage, status: 'completed', startedAt: stage.startedAt ?? now.toISOString(), completedAt: now.toISOString() };
    }
    return stage;
  });
  return stageTransition(stages, key, 'active', now);
}
