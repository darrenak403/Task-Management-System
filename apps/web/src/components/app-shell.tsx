'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { AppSidebar } from '@/components/app-sidebar';
import { ConnectionIndicator } from '@/components/connection-indicator';
import { ErrorState } from '@/components/error-state';
import { LanguageToggle } from '@/components/language-toggle';
import { ModeToggle } from '@/components/mode-toggle';
import { Separator } from '@/components/ui/separator';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { Skeleton } from '@/components/ui/skeleton';
import { AuthProvider, useAuth, useCurrentUser } from '@/features/auth/auth-provider';
import { useWorkspaceScope, WorkspaceScopeProvider } from '@/features/workspaces/workspace-scope';
import { useT } from '@/i18n/locale-provider';
import { errorMessage } from '@/lib/api-errors';
import { RealtimeProvider } from '@/lib/realtime/realtime-provider';

/** Client boundary of the protected area: session gate, workspace scope and the sidebar frame. */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <AuthGate>
        <WorkspaceScopeProvider>
          <Realtime>
            <SidebarProvider>
              <AppSidebar />
              <SidebarInset>
                <AppHeader />
                <main className="@container/main flex min-w-0 flex-1 flex-col gap-4 p-4 lg:p-6">{children}</main>
              </SidebarInset>
            </SidebarProvider>
          </Realtime>
        </WorkspaceScopeProvider>
      </AuthGate>
    </AuthProvider>
  );
}

/** Protected data is fetched only below this gate, after `me` has succeeded. */
function AuthGate({ children }: { children: React.ReactNode }) {
  const t = useT();
  const { state, retry } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (state.status === 'unauthenticated') router.replace('/login');
  }, [state.status, router]);

  if (state.status === 'authenticated') return children;

  if (state.status === 'error') {
    return (
      <main className="flex min-h-svh items-center justify-center p-6">
        <ErrorState title={t.common.session.verifyFailed} message={errorMessage(state.error)} onRetry={retry} />
      </main>
    );
  }

  return (
    <div className="flex min-h-svh" aria-busy="true" aria-label={t.common.loading}>
      <div className="hidden w-64 flex-col gap-3 border-r p-3 md:flex">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-6 w-2/3" />
      </div>
      <div className="flex flex-1 flex-col gap-4 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    </div>
  );
}

/** Opens the event stream only for a workspace the user is confirmed to have access to. */
function Realtime({ children }: { children: React.ReactNode }) {
  const user = useCurrentUser();
  const { workspaceId, workspace } = useWorkspaceScope();
  return (
    <RealtimeProvider userId={user.id} workspaceId={workspace.data ? workspaceId : undefined}>
      {children}
    </RealtimeProvider>
  );
}

function AppHeader() {
  const t = useT();
  const { workspace } = useWorkspaceScope();
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4 lg:px-6">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-4" />
      <p className="min-w-0 flex-1 truncate text-sm font-medium">{workspace.data?.name ?? t.nav.workspaces}</p>
      <ConnectionIndicator />
      <LanguageToggle />
      <ModeToggle />
    </header>
  );
}
