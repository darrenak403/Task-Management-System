'use client';

import { useCallback } from 'react';

import { useCurrentUser } from '@/features/auth/auth-provider';
import type { TeamMember } from '@/lib/dto';
import { topics } from '@/lib/realtime/invalidation-bus';
import { usePagedList, type PagedList } from '@/lib/use-paged-list';

import { listTeamMembers } from './teams-api';

const ROSTER_PAGE_SIZE = 100;

/** People who can be assigned tasks of a team. Pass `undefined` to skip loading. */
export function useTeamRoster(workspaceId: string, teamId: string | undefined): PagedList<TeamMember> {
  const user = useCurrentUser();
  const load = useCallback(
    (page: number, signal: AbortSignal) => listTeamMembers(workspaceId, teamId as string, page, signal, ROSTER_PAGE_SIZE),
    [workspaceId, teamId],
  );
  return usePagedList(teamId ? `roster:${user.id}:${workspaceId}:${teamId}` : null, load, {
    topics: teamId ? [topics.roster(teamId), topics.members] : [],
  });
}
