'use client';

import { cn } from 'cn';

import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useT } from '@/i18n/locale-provider';
import type { Messages } from '@/i18n/messages';
import type { Dashboard } from '@/lib/dto';

const CARDS: { key: keyof Dashboard['counts']; label: (m: Messages) => string; dot: string | null }[] = [
  { key: 'total', label: (m) => m.dashboard.total, dot: null },
  { key: 'todo', label: (m) => m.common.status.TODO, dot: 'bg-status-todo-foreground' },
  { key: 'inProgress', label: (m) => m.common.status.IN_PROGRESS, dot: 'bg-status-in-progress-foreground' },
  { key: 'done', label: (m) => m.common.status.DONE, dot: 'bg-status-done-foreground' },
];

/** Four task counters. `counts` is undefined while the first load is in flight. */
export function DashboardCards({ counts }: { counts: Dashboard['counts'] | undefined }) {
  const t = useT();
  return (
    <ul className="grid grid-cols-2 gap-4 @3xl/main:grid-cols-4" aria-busy={counts === undefined}>
      {CARDS.map((card) => (
        <li key={card.key}>
          <Card>
            <CardHeader>
              <CardDescription className="flex items-center gap-2">
                {card.dot ? <span className={cn('size-2 rounded-full', card.dot)} aria-hidden="true" /> : null}
                {card.label(t)}
              </CardDescription>
              <CardTitle className="text-3xl font-semibold tabular-nums">
                {counts ? counts[card.key] : <Skeleton className="h-9 w-12" />}
              </CardTitle>
            </CardHeader>
          </Card>
        </li>
      ))}
    </ul>
  );
}
