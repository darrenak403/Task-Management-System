'use client';

import { SearchIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useT } from '@/i18n/locale-provider';
import { TASK_PRIORITIES, TASK_STATUSES, type TaskPriority, type TaskStatus, type TeamMember } from '@/lib/dto';
import type { PagedList } from '@/lib/use-paged-list';

import { AssigneeSelect } from './assignee-select';
import { hasActiveFilters, type TaskQuery } from './task-query';

const ALL = '__all__';
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Search and filter controls. They hold no filter state of their own: every change is sent
 * to `onChange`, which writes the URL, and the URL comes back in as `query`.
 */
export function TaskFilters({
  query,
  onChange,
  roster,
  showStatus = true,
}: {
  query: TaskQuery;
  onChange: (patch: Partial<TaskQuery>) => void;
  /** When given, an assignee filter is offered. */
  roster?: PagedList<TeamMember>;
  /** The board already splits tasks by status, so it hides this filter. */
  showStatus?: boolean;
}) {
  const t = useT();
  const [text, setText] = useState(query.q);
  const [syncedQ, setSyncedQ] = useState(query.q);
  // The URL changed from outside (back button, link, "Clear filters"): show its value.
  if (query.q !== syncedQ) {
    setSyncedQ(query.q);
    setText(query.q);
  }

  useEffect(() => {
    if (text === query.q) return;
    const timer = setTimeout(() => onChange({ q: text }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, query.q, onChange]);

  return (
    <div className="flex flex-wrap items-center gap-2" role="search" aria-label={t.tasks.filters.label}>
      <div className="relative min-w-48 flex-1 sm:max-w-xs">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          type="search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={t.tasks.filters.searchPlaceholder}
          aria-label={t.tasks.filters.searchLabel}
          maxLength={200}
          className="pl-8"
        />
      </div>

      {showStatus ? (
        <Select value={query.status ?? ALL} onValueChange={(value) => onChange({ status: value === ALL ? undefined : (value as TaskStatus) })}>
          <SelectTrigger className="w-36" aria-label={t.tasks.filters.byStatus}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t.tasks.filters.anyStatus}</SelectItem>
            {TASK_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {t.common.status[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

      <Select value={query.priority ?? ALL} onValueChange={(value) => onChange({ priority: value === ALL ? undefined : (value as TaskPriority) })}>
        <SelectTrigger className="w-36" aria-label={t.tasks.filters.byPriority}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t.tasks.filters.anyPriority}</SelectItem>
          {TASK_PRIORITIES.map((priority) => (
            <SelectItem key={priority} value={priority}>
              {t.common.priority[priority]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {roster ? (
        <AssigneeSelect
          roster={roster}
          value={query.assignee ?? null}
          onChange={(userId) => onChange({ assignee: userId ?? undefined })}
          emptyLabel={t.tasks.filters.anyAssignee}
          ariaLabel={t.tasks.filters.byAssignee}
          className="w-44"
        />
      ) : null}

      {hasActiveFilters(query) ? (
        <Button variant="ghost" size="sm" onClick={() => onChange({ q: '', status: undefined, priority: undefined, assignee: undefined })}>
          {t.tasks.filters.clear}
        </Button>
      ) : null}
    </div>
  );
}
