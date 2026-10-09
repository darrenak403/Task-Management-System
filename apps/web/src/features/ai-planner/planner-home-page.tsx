'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';

import { ErrorState } from '@/components/error-state';
import { PageControls } from '@/components/page-controls';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useCurrentUser } from '@/features/auth/auth-provider';
import { useTeam } from '@/features/teams/team-gate';
import { useWorkspace } from '@/features/workspaces/workspace-scope';
import { useT } from '@/i18n/locale-provider';
import { errorMessage } from '@/lib/api-errors';
import { topics } from '@/lib/realtime/invalidation-bus';
import { toRouteId } from '@/lib/route-id';
import { useResource } from '@/lib/use-resource';

import { listPlans } from './ai-plans-api';
import { GoalForm } from './goal-form';
import { PlanList } from './plan-list';

export function PlannerHomePage() {
  const t = useT();
  const user = useCurrentUser();
  const { workspaceId } = useWorkspace();
  const team = useTeam();
  const [page, setPage] = useState(1);
  const load = useCallback((signal: AbortSignal) => listPlans(workspaceId, team.id, page, signal), [workspaceId, team.id, page]);
  const plans = useResource(`ai-plans:${user.id}:${workspaceId}:${team.id}:${page}`, load, { topics: [topics.planner(team.id)] });

  const availability = plans.data?.availability;
  const reason = availability && !availability.available ? availability.unavailableReason : null;
  const needsSettings = reason === 'credential_required' || reason === 'model_required';
  const usage = availability?.dailyUsage;
  const exhausted = usage ? usage.used >= usage.limit : false;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t.nav.aiPlanner} description={t.planner.home.description(team.name)} />

      {availability && !availability.available ? (
        <Alert>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            {reason ? t.planner.home.unavailable[reason] : t.planner.home.unavailableGeneric}
            {needsSettings ? (
              <Button asChild size="sm">
                <Link href={`/workspaces/${toRouteId(workspaceId)}/ai-settings`}>{t.planner.openAiSettings}</Link>
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t.planner.page.newPlan}</CardTitle>
          <CardDescription>
            {t.planner.home.newPlanDescription}
            {availability?.model ? ` ${t.planner.home.model(availability.model)}` : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {/* The limits are stated up front, so running into one is never a surprise. */}
          {usage ? (
            <div className="rounded-lg border bg-muted/30 p-4 text-sm">
              <p className={exhausted ? 'font-medium text-destructive' : 'font-medium'}>
                {exhausted ? t.planner.home.usageExhausted : t.planner.home.usage(usage.used, usage.limit)}
              </p>
              <p className="mt-1 text-muted-foreground">{t.planner.home.usageRule(usage.attemptsPerRequest)}</p>
            </div>
          ) : null}
          {/* Usable only once the server says the planner is available for this user and uses are left. */}
          <GoalForm workspaceId={workspaceId} teamId={team.id} disabled={!availability?.available || exhausted} />
        </CardContent>
      </Card>

      <section className="flex flex-col gap-3" aria-labelledby="your-plans">
        <h2 id="your-plans" className="text-base font-semibold">
          {t.planner.home.yourPlans}
        </h2>
        {plans.data ? (
          plans.data.data.length > 0 ? (
            <>
              <PlanList plans={plans.data.data} basePath={`/workspaces/${toRouteId(workspaceId)}/teams/${toRouteId(team.id)}/ai-planner`} />
              <PageControls
                page={plans.data.meta.page}
                totalPages={plans.data.meta.totalPages}
                total={plans.data.meta.total}
                onPageChange={setPage}
                disabled={plans.fetching}
              />
            </>
          ) : (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              {t.planner.home.empty}
            </p>
          )
        ) : plans.error ? (
          <ErrorState message={errorMessage(plans.error)} onRetry={() => void plans.reload()} />
        ) : (
          <Skeleton className="h-24 w-full" aria-label={t.planner.home.loading} />
        )}
      </section>
    </div>
  );
}
