'use client';

import { useParams } from 'next/navigation';
import { createContext, useCallback, useContext, useMemo } from 'react';

import { useCurrentUser } from '@/features/auth/auth-provider';
import { listTeams } from '@/features/teams/teams-api';
import type { Team, Workspace, WorkspaceRole } from '@/lib/dto';
import { topics } from '@/lib/realtime/invalidation-bus';
import { fromRouteId } from '@/lib/route-id';
import { usePagedList, type PagedList } from '@/lib/use-paged-list';
import { useResource, type Resource } from '@/lib/use-resource';

import { getWorkspace } from './workspaces-api';

type WorkspaceScope = {
  /** Workspace id from the URL; undefined on pages outside a workspace. */
  workspaceId: string | undefined;
  teamId: string | undefined;
  workspace: Resource<Workspace>;
  role: WorkspaceRole | undefined;
  /** Teams the current user may see in this workspace. */
  teams: PagedList<Team>;
};

const WorkspaceScopeContext = createContext<WorkspaceScope | null>(null);

/**
 * Current workspace and its visible teams, keyed by the URL and the signed-in user.
 * Switching workspace changes the keys, which aborts in-flight requests and drops the old data.
 */
export function WorkspaceScopeProvider({ children }: { children: React.ReactNode }) {
  const user = useCurrentUser();
  const params = useParams<{ wid?: string; tid?: string }>();
  const workspaceId = params.wid ? fromRouteId(params.wid) : undefined;
  const teamId = params.tid ? fromRouteId(params.tid) : undefined;

  const loadWorkspace = useCallback(
    (signal: AbortSignal) => getWorkspace(workspaceId as string, signal),
    [workspaceId],
  );
  const workspace = useResource(workspaceId ? `workspace:${user.id}:${workspaceId}` : null, loadWorkspace, {
    topics: [topics.structure],
  });

  const loadTeams = useCallback(
    (page: number, signal: AbortSignal) => listTeams(workspaceId as string, page, signal),
    [workspaceId],
  );
  const teams = usePagedList(workspaceId ? `teams:${user.id}:${workspaceId}` : null, loadTeams, {
    topics: [topics.structure],
  });

  const value = useMemo(
    () => ({ workspaceId, teamId, workspace, role: workspace.data?.role, teams }),
    [workspaceId, teamId, workspace, teams],
  );
  return <WorkspaceScopeContext.Provider value={value}>{children}</WorkspaceScopeContext.Provider>;
}

export function useWorkspaceScope(): WorkspaceScope {
  const value = useContext(WorkspaceScopeContext);
  if (!value) throw new Error('useWorkspaceScope must be used inside WorkspaceScopeProvider');
  return value;
}

/** For pages under `/workspaces/[wid]`, which render only after the workspace has loaded. */
export function useWorkspace(): { workspace: Workspace; role: WorkspaceRole; workspaceId: string } {
  const scope = useWorkspaceScope();
  if (!scope.workspace.data || !scope.workspaceId) throw new Error('useWorkspace requires a loaded workspace');
  return { workspace: scope.workspace.data, role: scope.workspace.data.role, workspaceId: scope.workspaceId };
}
