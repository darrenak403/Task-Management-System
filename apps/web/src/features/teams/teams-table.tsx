'use client';

import { PlusIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { ErrorState } from '@/components/error-state';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { can } from '@/features/workspaces/permissions';
import { useWorkspace, useWorkspaceScope } from '@/features/workspaces/workspace-scope';
import { useT } from '@/i18n/locale-provider';
import { errorMessage } from '@/lib/api-errors';
import type { Team } from '@/lib/dto';
import { toRouteId } from '@/lib/route-id';

import { TeamDialog } from './team-dialog';
import { TeamMembersSheet } from './team-members-sheet';

export function TeamsTable() {
  const t = useT();
  const { workspaceId, role } = useWorkspace();
  const { teams } = useWorkspaceScope();
  // `undefined` = closed, `null` = creating, a team = renaming it.
  const [editing, setEditing] = useState<Team | null | undefined>(undefined);
  const [rosterOf, setRosterOf] = useState<Team | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {teams.loading ? ' ' : `${teams.total} ${teams.total === 1 ? 'team' : 'teams'}`}
        </p>
        {can('team.create', role) ? (
          <Button onClick={() => setEditing(null)}>
            <PlusIcon aria-hidden="true" /> {t.teams.table.newTeam}
          </Button>
        ) : null}
      </div>

      {teams.error && teams.items.length === 0 ? (
        <ErrorState message={errorMessage(teams.error)} onRetry={() => void teams.reload()} />
      ) : null}

      {teams.loading ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : null}

      {!teams.loading && !teams.error && teams.items.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {t.teams.table.empty}
        </p>
      ) : null}

      {teams.items.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.teams.table.team}</TableHead>
                <TableHead className="text-right">{t.common.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {teams.items.map((team) => (
                <TableRow key={team.id}>
                  <TableCell className="font-medium">
                    <Link href={`/workspaces/${toRouteId(workspaceId)}/teams/${toRouteId(team.id)}/tasks`} className="underline-offset-4 hover:underline">
                      {team.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right">
                    {can('team.manageMembers', role) ? (
                      <Button variant="ghost" size="sm" onClick={() => setRosterOf(team)}>
                        {t.nav.members}<span className="sr-only"> {t.teams.table.of(team.name)}</span>
                      </Button>
                    ) : null}
                    {can('team.rename', role) ? (
                      <Button variant="ghost" size="sm" onClick={() => setEditing(team)}>
                        {t.nav.rename}<span className="sr-only"> {team.name}</span>
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {teams.hasMore ? (
        <Button variant="outline" className="self-center" onClick={teams.loadMore} disabled={teams.loadingMore}>
          {teams.loadingMore ? t.common.loading : t.nav.loadMoreTeams}
        </Button>
      ) : null}

      <TeamDialog
        workspaceId={workspaceId}
        team={editing ?? null}
        open={editing !== undefined}
        onOpenChange={(open) => (open ? undefined : setEditing(undefined))}
      />
      <TeamMembersSheet workspaceId={workspaceId} team={rosterOf} onClose={() => setRosterOf(null)} />
    </div>
  );
}
