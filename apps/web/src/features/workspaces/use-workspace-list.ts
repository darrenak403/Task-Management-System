'use client';

import { useCallback } from 'react';

import { useCurrentUser } from '@/features/auth/auth-provider';
import { topics } from '@/lib/realtime/invalidation-bus';
import { usePagedList } from '@/lib/use-paged-list';

import { listWorkspaces } from './workspaces-api';

/** Workspaces the signed-in user belongs to, with their role in each. */
export function useWorkspaceList() {
  const user = useCurrentUser();
  const load = useCallback((page: number, signal: AbortSignal) => listWorkspaces(page, signal), []);
  return usePagedList(`workspaces:${user.id}`, load, { topics: [topics.structure] });
}
