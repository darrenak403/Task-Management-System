'use client';

import { PlusIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { KanbanColumn } from '@/components/ui/kanban';
import { Skeleton } from '@/components/ui/skeleton';
import { useT } from '@/i18n/locale-provider';
import { errorMessage } from '@/lib/api-errors';
import type { Task, TaskStatus } from '@/lib/dto';
import type { PagedList } from '@/lib/use-paged-list';


/** One status column: header with counts, its cards, and "Load more" for the rest. */
export function BoardColumn({
  status,
  list,
  shownCount,
  onCreate,
  children,
}: {
  status: TaskStatus;
  list: PagedList<Task>;
  /** Cards currently rendered, which can differ from the loaded count while a move is pending. */
  shownCount: number;
  onCreate: () => void;
  children: React.ReactNode;
}) {
  const t = useT();
  const label = t.common.status[status];
  return (
    <KanbanColumn value={status} className="w-72 shrink-0 bg-muted/50 md:w-auto md:min-w-0 md:flex-1 dark:bg-muted/30" aria-label={t.tasks.board.column(label)}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{label}</h2>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {list.loading ? t.common.loading : t.tasks.board.showing(shownCount, Math.max(list.total, shownCount))}
          </p>
        </div>
        <Button variant="ghost" size="icon" className="size-7" onClick={onCreate} aria-label={t.tasks.board.newIn(label)}>
          <PlusIcon aria-hidden="true" />
        </Button>
      </div>

      {list.error ? (
        <div role="alert" className="rounded-md border border-dashed p-3 text-xs">
          <p className="text-muted-foreground">{errorMessage(list.error)}</p>
          <Button variant="link" size="sm" className="h-auto px-0" onClick={() => void list.reload()}>
            {t.common.tryAgain}
          </Button>
        </div>
      ) : null}

      <div className="flex min-h-24 flex-col gap-2">
        {list.loading ? (
          <>
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </>
        ) : (
          children
        )}
        {!list.loading && !list.error && shownCount === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">{t.tasks.board.empty}</p>
        ) : null}
      </div>

      {list.hasMore ? (
        <Button variant="outline" size="sm" onClick={list.loadMore} disabled={list.loadingMore}>
          {list.loadingMore ? t.common.loading : t.common.loadMore}
        </Button>
      ) : null}
    </KanbanColumn>
  );
}
