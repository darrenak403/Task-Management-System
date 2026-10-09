import { describe, expect, it } from 'vitest';

import { hasActiveFilters, parseTaskQuery, taskQueryString } from './task-query';

const assignee = '65b54d46-ed41-40d7-a189-b44f01dab0c7';
const parse = (search: string) => parseTaskQuery(new URLSearchParams(search));

describe('task query', () => {
  it('uses defaults for an empty URL', () => {
    expect(parse('')).toEqual({ view: 'list', q: '', status: undefined, priority: undefined, assignee: undefined, page: 1 });
  });

  it('reads combined filters', () => {
    expect(parse(`view=board&q=api&status=IN_PROGRESS&priority=HIGH&assignee=${assignee}&page=3`)).toEqual({
      view: 'board',
      q: 'api',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      assignee,
      page: 3,
    });
  });

  it('drops values the API would reject', () => {
    expect(parse('status=LATER&priority=urgent&assignee=me&page=-2&view=grid')).toEqual(parse(''));
    expect(parse('page=1.5').page).toBe(1);
  });

  it('returns to page 1 when a filter changes', () => {
    const current = parse('status=TODO&page=4');

    expect(taskQueryString(current, { priority: 'HIGH' })).toBe('?status=TODO&priority=HIGH');
    expect(taskQueryString(current, { q: 'bug' })).toBe('?q=bug&status=TODO');
    expect(taskQueryString(current, { status: undefined })).toBe('');
  });

  it('keeps the filters when only the page changes', () => {
    const current = parse('q=bug&status=TODO');

    expect(taskQueryString(current, { page: 2 })).toBe('?q=bug&status=TODO&page=2');
  });

  it('round-trips through the URL', () => {
    const search = `?view=board&q=a+b&status=DONE&priority=LOW&assignee=${assignee}&page=2`;
    const query = parse(search);

    expect(taskQueryString(query, { page: query.page })).toBe(search);
  });

  it('knows when a filter narrows the list', () => {
    expect(hasActiveFilters(parse('page=2&view=board'))).toBe(false);
    expect(hasActiveFilters(parse('q=%20'))).toBe(false);
    expect(hasActiveFilters(parse('priority=LOW'))).toBe(true);
  });
});
