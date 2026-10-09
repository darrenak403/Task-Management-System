'use client';

import { useCallback } from 'react';

import { ErrorState } from '@/components/error-state';
import { PageHeader } from '@/components/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { useCurrentUser } from '@/features/auth/auth-provider';
import { can } from '@/features/workspaces/permissions';
import { useWorkspace, useWorkspaceScope } from '@/features/workspaces/workspace-scope';
import { useT } from '@/i18n/locale-provider';
import { errorMessage } from '@/lib/api-errors';
import { topics } from '@/lib/realtime/invalidation-bus';
import { useResource } from '@/lib/use-resource';

import { getDashboard } from './dashboard-api';
import { DashboardCards } from './dashboard-cards';
import { UpcomingList } from './upcoming-list';

export function DashboardPage() {
  const t = useT();
  const user = useCurrentUser();
  const { workspace, workspaceId, role } = useWorkspace();
  const { teams } = useWorkspaceScope();
  const load = useCallback((signal: AbortSignal) => getDashboard(workspaceId, signal), [workspaceId]);
  const dashboard = useResource(`dashboard:${user.id}:${workspaceId}`, load, {
    // Counts depend on tasks and on which teams the caller can see.
    topics: [topics.anyTasks, topics.structure],
  });
  const teamName = useCallback((teamId: string) => teams.items.find((team) => team.id === teamId)?.name, [teams.items]);

  const description = can('tasks.manageAllTeams', role)
    ? t.dashboard.allTeams(workspace.name)
    : t.dashboard.yourTeams(workspace.name);

  return (
    <>
      <PageHeader title={t.nav.dashboard} description={description} />

      {dashboard.error && !dashboard.data ? (
        <ErrorState message={errorMessage(dashboard.error)} onRetry={() => void dashboard.reload()} />
      ) : (
        <>
          <DashboardCards counts={dashboard.data?.counts} />
          {dashboard.data ? (
            dashboard.data.counts.total === 0 ? (
              <p className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
                {teams.items.length === 0 && !teams.loading
                  ? t.dashboard.noTeams
                  : t.dashboard.noTasks}
              </p>
            ) : (
              <UpcomingList dashboard={dashboard.data} teamName={teamName} />
            )
          ) : (
            <Skeleton className="h-48 w-full" />
          )}
        </>
      )}
    </>
  );
}
