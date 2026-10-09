'use client';

import Link from 'next/link';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateOnly } from '@/features/tasks/date-only';
import { DueDate, PriorityBadge, StatusBadge } from '@/features/tasks/task-badges';
import { useT } from '@/i18n/locale-provider';
import type { Dashboard } from '@/lib/dto';
import { toRouteId } from '@/lib/route-id';

/** Unfinished work due inside the API's upcoming window, soonest first. */
export function UpcomingList({
  dashboard,
  teamName,
}: {
  dashboard: Dashboard;
  teamName: (teamId: string) => string | undefined;
}) {
  const t = useT();
  const { upcoming, upcomingTotal, window, scope } = dashboard;
  const hidden = upcomingTotal - upcoming.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.dashboard.upcoming}</CardTitle>
        <CardDescription>
          Due from {formatDateOnly(window.from)} to {formatDateOnly(window.to)}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {upcoming.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            {t.dashboard.nothingDue}
          </p>
        ) : (
          <ul className="divide-y">
            {upcoming.map((task) => (
              <li key={task.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3">
                <div className="min-w-0">
                  <Link
                    href={`/workspaces/${toRouteId(scope.workspaceId)}/teams/${toRouteId(task.teamId)}/tasks?q=${encodeURIComponent(task.title)}`}
                    className="block truncate text-sm font-medium underline-offset-4 hover:underline"
                  >
                    {task.title}
                  </Link>
                  <p className="text-xs text-muted-foreground">{teamName(task.teamId) ?? t.dashboard.team}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <StatusBadge status={task.status} />
                  <PriorityBadge priority={task.priority} />
                  <DueDate task={task} />
                </div>
              </li>
            ))}
          </ul>
        )}
        {hidden > 0 ? (
          <p className="pt-3 text-sm text-muted-foreground">
            and {hidden} more due in this period.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
