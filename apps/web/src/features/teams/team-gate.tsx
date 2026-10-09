'use client';

import Link from 'next/link';
import { createContext, useCallback, useContext } from 'react';

import { ErrorState } from '@/components/error-state';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useCurrentUser } from '@/features/auth/auth-provider';
import { useWorkspace, useWorkspaceScope } from '@/features/workspaces/workspace-scope';
import { useT } from '@/i18n/locale-provider';
import { errorMessage, isAccessLost } from '@/lib/api-errors';
import type { Team } from '@/lib/dto';
import { topics } from '@/lib/realtime/invalidation-bus';
import { toRouteId } from '@/lib/route-id';
import { useResource } from '@/lib/use-resource';

import { getTeam } from './teams-api';

const TeamContext = createContext<Team | null>(null);

/**
 * Renders team pages only once the team is confirmed visible to the caller.
 * A team that was removed, or that the caller left, shows a dead end instead of stale content.
 */
export function TeamGate({ children }: { children: React.ReactNode }) {
  const t = useT();
  const user = useCurrentUser();
  const { workspaceId } = useWorkspace();
  const { teamId } = useWorkspaceScope();
  const load = useCallback((signal: AbortSignal) => getTeam(workspaceId, teamId as string, signal), [workspaceId, teamId]);
  const team = useResource(teamId ? `team:${user.id}:${workspaceId}:${teamId}` : null, load, {
    topics: [topics.structure, ...(teamId ? [topics.roster(teamId)] : [])],
  });

  if (isAccessLost(team.error)) {
    return (
      <div className="flex flex-col items-center gap-3">
        <ErrorState title={t.teams.gate.unavailableTitle} message={t.teams.gate.unavailableMessage} />
        <Button asChild variant="outline">
          <Link href={`/workspaces/${toRouteId(workspaceId)}/dashboard`}>{t.teams.gate.back}</Link>
        </Button>
      </div>
    );
  }
  if (team.data) return <TeamContext.Provider value={team.data}>{children}</TeamContext.Provider>;
  if (team.error) return <ErrorState message={errorMessage(team.error)} onRetry={() => void team.reload()} />;
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label={t.teams.gate.loading}>
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

/** The team of the current `/teams/[tid]` page. */
export function useTeam(): Team {
  const team = useContext(TeamContext);
  if (!team) throw new Error('useTeam must be used inside TeamGate');
  return team;
}
