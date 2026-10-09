'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { toast } from 'sonner';

import { ErrorState } from '@/components/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useT } from '@/i18n/locale-provider';
import { messages } from '@/i18n/messages';
import { errorMessage, isAccessLost } from '@/lib/api-errors';

import { useWorkspaceScope } from './workspace-scope';

/**
 * Renders workspace pages only once the workspace (and the caller's role in it) is known.
 * When access is gone, nothing cached is shown and the user returns to the workspace list.
 */
export function WorkspaceGate({ children }: { children: React.ReactNode }) {
  const t = useT();
  const { workspace } = useWorkspaceScope();
  const router = useRouter();
  const accessLost = isAccessLost(workspace.error);

  useEffect(() => {
    if (!accessLost) return;
    toast.error(messages().workspaces.unavailable);
    router.replace('/workspaces');
  }, [accessLost, router]);

  if (accessLost) return null;
  if (workspace.data) return children;
  if (workspace.error) {
    return <ErrorState message={errorMessage(workspace.error)} onRetry={() => void workspace.reload()} />;
  }
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label={t.workspaces.loading}>
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}
