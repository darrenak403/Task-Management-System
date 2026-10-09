import { TASK_PRIORITIES, TASK_STATUSES, type TaskPriority, type TaskStatus } from '@/lib/dto';

export type TaskView = 'list' | 'board';

/** Task filters as they live in the URL, so a reload or a shared link shows the same list. */
export type TaskQuery = {
  view: TaskView;
  q: string;
  status: TaskStatus | undefined;
  priority: TaskPriority | undefined;
  /** User id of the assignee to filter by. */
  assignee: string | undefined;
  page: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function oneOf<T extends string>(allowed: readonly T[], value: string | null): T | undefined {
  return allowed.includes(value as T) ? (value as T) : undefined;
}

/** Unknown or malformed values fall back to defaults instead of reaching the API as a 400. */
export function parseTaskQuery(params: { get(name: string): string | null }): TaskQuery {
  const page = Number(params.get('page'));
  const assignee = params.get('assignee');
  return {
    view: params.get('view') === 'board' ? 'board' : 'list',
    q: (params.get('q') ?? '').slice(0, 200),
    status: oneOf(TASK_STATUSES, params.get('status')),
    priority: oneOf(TASK_PRIORITIES, params.get('priority')),
    assignee: assignee && UUID.test(assignee) ? assignee : undefined,
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

/** Query string for `current` with `patch` applied. Any change other than the page itself returns to page 1. */
export function taskQueryString(current: TaskQuery, patch: Partial<TaskQuery>): string {
  const next = { ...current, ...patch, page: 'page' in patch && patch.page !== undefined ? patch.page : 1 };
  const params = new URLSearchParams();
  if (next.view === 'board') params.set('view', 'board');
  if (next.q) params.set('q', next.q);
  if (next.status) params.set('status', next.status);
  if (next.priority) params.set('priority', next.priority);
  if (next.assignee) params.set('assignee', next.assignee);
  if (next.page > 1) params.set('page', String(next.page));
  const text = params.toString();
  return text ? `?${text}` : '';
}

export function hasActiveFilters(query: TaskQuery): boolean {
  return query.q.trim() !== '' || query.status !== undefined || query.priority !== undefined || query.assignee !== undefined;
}
