'use client';

import { BuildingIcon, PlusIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { ErrorState } from '@/components/error-state';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useT } from '@/i18n/locale-provider';
import { errorMessage } from '@/lib/api-errors';
import { toRouteId } from '@/lib/route-id';

import { CreateWorkspaceDialog } from './create-workspace-dialog';
import { useWorkspaceList } from './use-workspace-list';

export function WorkspacesPage() {
  const t = useT();
  const workspaces = useWorkspaceList();
  const [createOpen, setCreateOpen] = useState(false);
  const isEmpty = !workspaces.loading && !workspaces.error && workspaces.items.length === 0;

  return (
    <>
      <PageHeader title={t.nav.workspaces} description={t.workspaces.page.description}>
        {!isEmpty ? (
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon aria-hidden="true" /> {t.workspaces.page.newWorkspace}
          </Button>
        ) : null}
      </PageHeader>

      {workspaces.loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : null}

      {workspaces.error && workspaces.items.length === 0 ? (
        <ErrorState message={errorMessage(workspaces.error)} onRetry={() => void workspaces.reload()} />
      ) : null}

      {isEmpty ? (
        <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed p-10 text-center">
          <BuildingIcon className="size-8 text-muted-foreground" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-medium">{t.workspaces.page.firstTitle}</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              {t.workspaces.page.firstMessage}
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon aria-hidden="true" /> {t.workspaces.create.title}
          </Button>
        </div>
      ) : null}

      {workspaces.items.length > 0 ? (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {workspaces.items.map((workspace) => (
            <li key={workspace.id}>
              <Link
                href={`/workspaces/${toRouteId(workspace.id)}/dashboard`}
                className="block rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <Card className="transition-colors hover:bg-muted/50">
                  <CardHeader>
                    <CardTitle className="truncate">{workspace.name}</CardTitle>
                    <CardDescription>
                      <Badge variant="outline">{t.common.role[workspace.role]}</Badge>
                    </CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {workspaces.hasMore ? (
        <Button variant="outline" className="self-center" onClick={workspaces.loadMore} disabled={workspaces.loadingMore}>
          {workspaces.loadingMore ? t.common.loading : t.common.loadMore}
        </Button>
      ) : null}

      <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
