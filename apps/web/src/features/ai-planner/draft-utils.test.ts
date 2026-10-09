import { describe, expect, it } from 'vitest';

import type { PlanDraftItem } from '@/lib/dto';

import { dependencyCandidates, dependsOn, formatEstimate, itemsMissingDependencies, locksAfterEdit } from './draft-utils';

const link = (id: string, ...dependencies: string[]) => ({ id, dependencies });

describe('draft dependencies', () => {
  const items = [link('a'), link('b', 'a'), link('c', 'b'), link('d')];

  it('follows dependencies through other items', () => {
    expect(dependsOn(items, 'c', 'a')).toBe(true);
    expect(dependsOn(items, 'a', 'c')).toBe(false);
  });

  it('terminates on data that already contains a loop', () => {
    expect(dependsOn([link('x', 'y'), link('y', 'x')], 'x', 'z')).toBe(false);
  });

  it('offers only prerequisites that cannot create a loop', () => {
    expect(dependencyCandidates(items, 'a').map((item) => item.id)).toEqual(['d']);
    expect(dependencyCandidates(items, 'c').map((item) => item.id)).toEqual(['a', 'b', 'd']);
  });

  it('reports selected items whose prerequisites are not selected', () => {
    expect(itemsMissingDependencies(items, new Set(['a', 'b', 'c'])).map((item) => item.id)).toEqual([]);
    expect(itemsMissingDependencies(items, new Set(['c', 'd'])).map((item) => item.id)).toEqual(['c']);
  });
});

describe('locksAfterEdit', () => {
  const item = { id: 'a', title: 'Old', checklist: ['x'], priority: 'LOW', dependencies: [], selected: true } as unknown as PlanDraftItem;

  it('locks each edited field once and keeps existing locks', () => {
    const existing = [{ itemId: 'a', field: 'title' } as const, { itemId: 'b', field: 'priority' } as const];
    const locks = locksAfterEdit(existing, item, { ...item, title: 'New', checklist: ['x', 'y'] });

    expect(locks).toEqual([...existing, { itemId: 'a', field: 'checklist' }]);
  });

  it('does not lock fields that are not lockable or did not change', () => {
    expect(locksAfterEdit([], item, { ...item, dependencies: ['b'], selected: false })).toEqual([]);
  });
});

describe('formatEstimate', () => {
  it('formats a range, a single value and no estimate', () => {
    expect(formatEstimate({ estimateMinMinutes: 90, estimateMaxMinutes: 180 })).toBe('1 h 30 min – 3 h');
    expect(formatEstimate({ estimateMinMinutes: 45, estimateMaxMinutes: 45 })).toBe('45 min');
    expect(formatEstimate({ estimateMinMinutes: null, estimateMaxMinutes: 120 })).toBe('2 h');
    expect(formatEstimate({ estimateMinMinutes: null, estimateMaxMinutes: null })).toBeNull();
  });
});
