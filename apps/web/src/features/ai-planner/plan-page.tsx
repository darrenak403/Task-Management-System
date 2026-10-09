'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useReducer, useRef, useState } from 'react';
import { toast } from 'sonner';

import { ConfirmDialog } from '@/components/confirm-dialog';
import { ErrorState } from '@/components/error-state';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useCurrentUser } from '@/features/auth/auth-provider';
import { useTeam } from '@/features/teams/team-gate';
import { useTeamRoster } from '@/features/teams/use-team-roster';
import { useWorkspace } from '@/features/workspaces/workspace-scope';
import { useT } from '@/i18n/locale-provider';
import { errorMessage, isAccessLost, isApiError, isOutcomeUnknown } from '@/lib/api-errors';
import { invalidationBus, topics } from '@/lib/realtime/invalidation-bus';
import { fromRouteId, toRouteId } from '@/lib/route-id';
import { useResource } from '@/lib/use-resource';

import { getJob } from './ai-jobs-api';
import { clonePlan, confirmPlan, draftContentOf, generateRevision, getPlan, newRequestKey, saveVersion } from './ai-plans-api';
import { ClarifyForm } from './clarify-form';
import { DraftItems } from './draft-items';
import { DraftView } from './draft-view';
import { JobProgress } from './job-progress';
import { jobFailureProblem, plannerProblem, type PlannerProblem } from './planner-errors';
import { initialPlannerState, plannerReducer } from './planner-reducer';
import { ReviseMenu } from './revise-menu';
import { RevisionReady } from './revision-ready';
import { VersionsSheet } from './versions-sheet';

export function PlanPage() {
  const planId = fromRouteId(useParams<{ planId: string }>().planId);
  // Keyed by plan so nothing of one plan's flow carries over to another.
  return <PlanFlow key={planId} planId={planId} />;
}

function PlanFlow({ planId }: { planId: string }) {
  const t = useT();
  const user = useCurrentUser();
  const router = useRouter();
  const { workspaceId } = useWorkspace();
  const team = useTeam();
  const teamId = team.id;
  const roster = useTeamRoster(workspaceId, teamId);
  const [state, dispatch] = useReducer(plannerReducer, initialPlannerState);
  const [notice, setNotice] = useState<PlannerProblem | null>(null);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  // A repeated confirm of the same selection reuses its key, so the server answers with the tasks it already created.
  const confirmRequest = useRef<{ selection: string; key: string } | null>(null);
  const confirmInFlight = useRef(false);

  const plannerHome = `/workspaces/${toRouteId(workspaceId)}/teams/${toRouteId(teamId)}/ai-planner`;
  const scope = `${user.id}:${workspaceId}:${teamId}:${planId}`;

  // Loaded snapshots go through the reducer, which decides the phase and drops late job snapshots.
  const loadPlan = useCallback(
    async (signal: AbortSignal) => {
      const plan = await getPlan(workspaceId, teamId, planId, signal);
      if (!signal.aborted) dispatch({ type: 'plan_loaded', plan });
      return plan;
    },
    [workspaceId, teamId, planId],
  );
  const plan = useResource(`ai-plan:${scope}`, loadPlan, { topics: [topics.planner(teamId)] });

  // The plan names its newest job and that job's sequence; a new sequence means there is a newer snapshot to fetch.
  const latestJob = plan.data?.status === 'DRAFT' ? plan.data.latestJob : null;
  const loadJob = useCallback(
    async (signal: AbortSignal) => {
      const job = await getJob(workspaceId, teamId, latestJob?.id as string, signal);
      if (!signal.aborted) dispatch({ type: 'job_loaded', job });
      return job;
    },
    [workspaceId, teamId, latestJob?.id],
  );
  const jobSnapshot = useResource(latestJob ? `ai-job:${scope}:${latestJob.id}:${latestJob.sequence}` : null, loadJob);

  const reloadPlan = () => invalidationBus.publish(topics.planner(teamId));

  async function handleConfirm(selectedItemIds: string[]) {
    const version = state.plan?.version;
    if (!version || confirmInFlight.current) return;
    confirmInFlight.current = true;
    // Saving a changed selection replaces the version, so the key follows the selection only.
    const selection = selectedItemIds.join(',');
    if (confirmRequest.current?.selection !== selection) confirmRequest.current = { selection, key: newRequestKey() };

    setNotice(null);
    dispatch({ type: 'confirm_started' });
    try {
      // Tasks are created from the selection a version stores, so a changed selection is saved as a version first.
      const selected = new Set(selectedItemIds);
      const stored = version.draft.items.filter((item) => item.selected).map((item) => item.id);
      const versionId =
        stored.join(',') === selectedItemIds.join(',')
          ? version.id
          : (
              await saveVersion(workspaceId, teamId, planId, {
                expectedActiveVersionId: version.id,
                draft: draftContentOf(
                  version.draft,
                  version.draft.items.map((item) => ({ ...item, selected: selected.has(item.id) })),
                ),
                fieldLocks: version.draft.fieldLocks ?? [],
              })
            ).id;
      const receipt = await confirmPlan(workspaceId, teamId, planId, { versionId, selectedItemIds, requestKey: confirmRequest.current.key });
      toast.success(t.planner.confirm.created(receipt.createdCount));
    } catch (error) {
      setNotice(
        isOutcomeUnknown(error)
          ? { message: t.planner.confirm.outcomeUnknown, next: 'none' }
          : plannerProblem(error),
      );
    } finally {
      // The server is asked what happened before the page unlocks: a lost response may still have created the tasks.
      await plan.reload();
      dispatch({ type: 'confirm_settled' });
      confirmInFlight.current = false;
      invalidationBus.publish(topics.tasks(teamId));
    }
  }

  async function handleRetry() {
    if (!state.plan?.latestJob) return;
    setRetrying(true);
    setNotice(null);
    try {
      await generateRevision(workspaceId, teamId, planId, {
        requestKey: newRequestKey(),
        action: 'RETRY',
        retryJobId: state.plan.latestJob.id,
        baseVersionId: state.plan.activeVersionId,
      });
    } catch (error) {
      setNotice(plannerProblem(error));
    } finally {
      setRetrying(false);
      reloadPlan();
    }
  }

  async function handleClone() {
    try {
      const clone = await clonePlan(workspaceId, teamId, planId, newRequestKey());
      invalidationBus.publish(topics.planner(teamId));
      toast.success(t.planner.page.duplicated);
      router.push(`${plannerHome}/${clone.planId}`);
    } catch (error) {
      toast.error(plannerProblem(error).message);
    }
  }

  const backLink = (
    <Button asChild variant="outline">
      <Link href={plannerHome}>{t.planner.page.allPlans}</Link>
    </Button>
  );

  if (isApiError(plan.error) && (plan.error.code === 'PLAN_EXPIRED' || isAccessLost(plan.error))) {
    const expired = plan.error.code === 'PLAN_EXPIRED';
    return (
      <div className="flex flex-col items-center gap-3">
        <ErrorState
          title={expired ? t.planner.page.expiredTitle : t.planner.page.unavailableTitle}
          message={expired ? t.planner.page.expiredMessage : t.planner.page.unavailableMessage}
        />
        {backLink}
      </div>
    );
  }

  const { phase, job } = state;
  const current = state.plan;
  if (!current) {
    if (plan.error) return <ErrorState message={errorMessage(plan.error)} onRetry={() => void plan.reload()} />;
    return <Skeleton className="h-64 w-full" aria-label={t.planner.loadingPlan} />;
  }

  const version = current.version;
  // A snapshot older than what the plan reports is not shown; the newer one is on its way.
  const latest = current.latestJob;
  const jobOfPlan = job && latest && job.id === latest.id && job.sequence >= latest.sequence ? job : null;
  // A revision that failed leaves the previous draft in place; its reason is shown above that draft.
  const revisionFailure =
    phase === 'draft' && jobOfPlan && (jobOfPlan.status === 'FAILED' || jobOfPlan.status === 'INTERRUPTED') ? jobFailureProblem(jobOfPlan.safeErrorCode) : null;
  // A finished revision waits as a separate version until the user accepts it.
  const revisionId =
    phase === 'draft' && jobOfPlan?.status === 'SUCCEEDED' && jobOfPlan.outputVersionId && jobOfPlan.outputVersionId !== current.activeVersionId
      ? jobOfPlan.outputVersionId
      : null;
  const failure = phase === 'failed' ? jobFailureProblem(jobOfPlan?.safeErrorCode ?? null) : null;
  // Once the plan is confirmed, an earlier "could not confirm" notice no longer applies.
  const shown = phase === 'confirmed' ? null : (notice ?? revisionFailure);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={version?.draft.planTitle ?? t.planner.page.newPlan} description={t.planner.page.subtitle(team.name)}>
        {backLink}
        {version ? (
          <VersionsSheet
            workspaceId={workspaceId}
            teamId={teamId}
            planId={planId}
            activeVersionId={current.activeVersionId}
            members={roster.items}
            editable={phase === 'draft'}
          />
        ) : null}
        {phase === 'draft' && version ? (
          <ReviseMenu workspaceId={workspaceId} teamId={teamId} planId={planId} versionId={version.id} itemIds={version.draft.items.map((item) => item.id)} />
        ) : null}
        {version && phase !== 'generating' && phase !== 'confirming' ? (
          <Button variant="outline" onClick={() => setCloneOpen(true)}>
            {t.planner.page.duplicate}
          </Button>
        ) : null}
      </PageHeader>

      {plan.error ? (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            {errorMessage(plan.error)}
            <Button variant="outline" size="sm" onClick={() => void plan.reload()}>
              {t.common.tryAgain}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {shown ? (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            {shown.message}
            {shown.next === 'open-ai-settings' ? <AiSettingsLink workspaceId={workspaceId} /> : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {phase === 'generating' && current.latestJob ? <JobProgress workspaceId={workspaceId} teamId={teamId} latestJob={current.latestJob} job={jobOfPlan} /> : null}
      {phase === 'generating' && !current.latestJob ? <Skeleton className="h-40 w-full" aria-label={t.planner.loadingPlan} /> : null}
      {phase === 'loading' ? <Skeleton className="h-40 w-full" aria-label={t.planner.loadingPlan} /> : null}

      {phase === 'awaiting-clarification' ? (
        jobOfPlan ? (
          <ClarifyForm key={jobOfPlan.id} workspaceId={workspaceId} teamId={teamId} job={jobOfPlan} />
        ) : jobSnapshot.error ? (
          <ErrorState message={errorMessage(jobSnapshot.error)} onRetry={() => void jobSnapshot.reload()} />
        ) : (
          <Skeleton className="h-40 w-full" aria-label={t.planner.page.loadingQuestions} />
        )
      ) : null}

      {revisionId && version ? (
        <RevisionReady key={revisionId} workspaceId={workspaceId} teamId={teamId} planId={planId} versionId={revisionId} activeVersionId={version.id} members={roster.items} />
      ) : null}

      {(phase === 'draft' || phase === 'confirming') && version ? (
        <DraftView
          key={version.id}
          workspaceId={workspaceId}
          teamId={teamId}
          planId={planId}
          version={version}
          roster={roster}
          confirming={phase === 'confirming'}
          onConfirm={handleConfirm}
        />
      ) : null}

      {phase === 'failed' || phase === 'cancelled' ? (
        <Card>
          <CardHeader>
            <CardTitle>{phase === 'cancelled' ? t.planner.page.cancelledTitle : t.planner.page.failedTitle}</CardTitle>
            <CardDescription>{failure ? failure.message : t.planner.page.noDraft}</CardDescription>
          </CardHeader>
          <CardFooter className="flex flex-wrap gap-2">
            {failure?.next === 'open-ai-settings' ? <AiSettingsLink workspaceId={workspaceId} /> : null}
            {!failure || failure.next === 'retry' || failure.next === 'wait' ? (
              <Button onClick={() => void handleRetry()} disabled={retrying}>
                {retrying ? t.planner.goal.starting : t.common.tryAgain}
              </Button>
            ) : null}
            <Button asChild variant="outline">
              <Link href={plannerHome}>{t.planner.page.startNew}</Link>
            </Button>
          </CardFooter>
        </Card>
      ) : null}

      {phase === 'confirmed' ? (
        <>
          <Alert>
            <AlertTitle>{t.planner.page.confirmedTitle}</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
              {current.importReceipt
                ? t.planner.page.added(current.importReceipt.itemTaskMap.length)
                : t.planner.page.addedGeneric}
              <Button asChild size="sm">
                <Link href={`/workspaces/${toRouteId(workspaceId)}/teams/${toRouteId(teamId)}/tasks`}>{t.planner.page.openTasks}</Link>
              </Button>
            </AlertDescription>
          </Alert>
          {version ? (
            <Card>
              <CardHeader>
                <CardTitle>{version.draft.planTitle}</CardTitle>
                <CardDescription>{version.draft.goalSummary}</CardDescription>
              </CardHeader>
              <CardContent>
                <DraftItems
                  items={version.draft.items}
                  members={roster.items}
                  {...(current.importReceipt ? { selectedIds: new Set(current.importReceipt.itemTaskMap.map((entry) => entry.itemId)) } : {})}
                />
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : null}

      {phase === 'expired' ? (
        <ErrorState title={t.planner.page.expiredTitle} message={t.planner.page.expiredLocked} />
      ) : null}

      <ConfirmDialog
        open={cloneOpen}
        onOpenChange={setCloneOpen}
        title={t.planner.page.duplicateTitle}
        description={t.planner.page.duplicateDescription}
        confirmLabel={t.planner.page.duplicate}
        destructive={false}
        onConfirm={handleClone}
      />
    </div>
  );
}

function AiSettingsLink({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  return (
    <Button asChild variant="outline" size="sm">
      <Link href={`/workspaces/${toRouteId(workspaceId)}/ai-settings`}>{t.planner.openAiSettings}</Link>
    </Button>
  );
}
