'use client';

import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import { ErrorState } from '@/components/error-state';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useCurrentUser } from '@/features/auth/auth-provider';
import { listWorkspaceMembers, NAV_PAGE_SIZE } from '@/features/workspaces/workspaces-api';
import { useT } from '@/i18n/locale-provider';
import { errorMessage, isApiError } from '@/lib/api-errors';
import type { Team, TeamMember } from '@/lib/dto';
import { notifyWriteError } from '@/lib/notify';
import { displayNameOf } from '@/lib/people';
import { invalidationBus, topics } from '@/lib/realtime/invalidation-bus';
import { usePagedList } from '@/lib/use-paged-list';

import { addTeamMember, removeTeamMember } from './teams-api';
import { useTeamRoster } from './use-team-roster';

/** Roster of one team: add workspace members to it or remove them. Open while `team` is set. */
export function TeamMembersSheet({
  workspaceId,
  team,
  onClose,
}: {
  workspaceId: string;
  team: Team | null;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <Sheet open={team !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{team ? t.teams.members.titleFor(team.name) : t.teams.members.title}</SheetTitle>
          <SheetDescription>{t.teams.members.description}</SheetDescription>
        </SheetHeader>
        {team ? <Roster key={team.id} workspaceId={workspaceId} team={team} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function Roster({ workspaceId, team }: { workspaceId: string; team: Team }) {
  const t = useT();
  const user = useCurrentUser();
  const [selected, setSelected] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);

  const roster = useTeamRoster(workspaceId, team.id);

  const loadPeople = useCallback(
    (page: number, signal: AbortSignal) => listWorkspaceMembers(workspaceId, page, signal, NAV_PAGE_SIZE),
    [workspaceId],
  );
  const people = usePagedList(`team-candidates:${user.id}:${workspaceId}`, loadPeople, { topics: [topics.members] });

  const inTeam = new Set(roster.items.map((member) => member.id));
  // Candidates are only trustworthy once the whole roster is known; otherwise a current member could be offered.
  const candidates = roster.loading || roster.hasMore ? [] : people.items.filter((person) => !inTeam.has(person.id));

  async function handleAdd() {
    if (!selected) return;
    setPendingId(selected);
    try {
      const added = await addTeamMember(workspaceId, team.id, selected);
      toast.success(t.teams.members.added(displayNameOf(added), team.name));
      setSelected('');
    } catch (error) {
      if (isApiError(error) && error.code === 'MEMBER_ALREADY_EXISTS') toast.error(t.teams.members.alreadyIn);
      else notifyWriteError(error);
    } finally {
      setPendingId(null);
      invalidationBus.publish(topics.roster(team.id));
    }
  }

  async function handleRemove(member: TeamMember) {
    setPendingId(member.id);
    try {
      await removeTeamMember(workspaceId, team.id, member.id);
      toast.success(t.teams.members.removed(displayNameOf(member), team.name));
    } catch (error) {
      notifyWriteError(error);
    } finally {
      setPendingId(null);
      invalidationBus.publish(topics.roster(team.id));
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 pb-4">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Select value={selected} onValueChange={setSelected} disabled={candidates.length === 0 || pendingId !== null}>
            <SelectTrigger className="w-full" aria-label={t.teams.members.addLabel}>
              <SelectValue placeholder={people.loading || roster.loading ? t.teams.members.loadingPeople : candidates.length === 0 ? t.teams.members.everyoneIn : t.teams.members.select} />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((person) => (
                <SelectItem key={person.id} value={person.id}>
                  {displayNameOf(person)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={() => void handleAdd()} disabled={!selected || pendingId !== null}>
          {t.common.add}
        </Button>
      </div>
      {people.hasMore ? (
        <Button variant="link" size="sm" className="self-start px-0" onClick={people.loadMore} disabled={people.loadingMore}>
          {people.loadingMore ? t.common.loading : t.teams.members.loadMorePeople}
        </Button>
      ) : null}

      {roster.error && roster.items.length === 0 ? (
        <ErrorState message={errorMessage(roster.error)} onRetry={() => void roster.reload()} />
      ) : null}

      {roster.loading ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : null}

      {!roster.loading && !roster.error && roster.items.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {t.teams.members.empty}
        </p>
      ) : null}

      <ul className="flex min-h-0 flex-col divide-y overflow-y-auto">
        {roster.items.map((member) => (
          <li key={member.id} className="flex items-center justify-between gap-2 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{displayNameOf(member)}</p>
              <p className="truncate text-xs text-muted-foreground">{member.email}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={() => void handleRemove(member)}
              disabled={pendingId !== null}
            >
              {t.common.remove}<span className="sr-only"> {displayNameOf(member)}</span>
            </Button>
          </li>
        ))}
      </ul>

      {roster.hasMore ? (
        <Button variant="outline" size="sm" onClick={roster.loadMore} disabled={roster.loadingMore}>
          {roster.loadingMore ? t.common.loading : t.common.loadMore}
        </Button>
      ) : null}
    </div>
  );
}
