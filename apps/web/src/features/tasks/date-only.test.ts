import { afterEach, describe, expect, it } from 'vitest';

import { formatDateOnly, fromDateOnly, isOverdue, toDateOnly, todayDateOnly } from './date-only';

const originalZone = process.env.TZ;

afterEach(() => {
  process.env.TZ = originalZone;
});

describe.each(['America/Los_Angeles', 'Asia/Ho_Chi_Minh', 'UTC'])('date-only in %s', (zone) => {
  it('keeps the picked calendar day', () => {
    process.env.TZ = zone;

    expect(toDateOnly(new Date(2026, 0, 1))).toBe('2026-01-01');
    expect(toDateOnly(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31');
  });

  it('round-trips through the calendar value', () => {
    process.env.TZ = zone;

    for (const day of ['2026-03-08', '2026-11-01', '2024-02-29']) {
      expect(toDateOnly(fromDateOnly(day))).toBe(day);
    }
  });

  it('displays the same day', () => {
    process.env.TZ = zone;

    expect(formatDateOnly('2026-10-09')).toBe('Oct 9, 2026');
  });
});

describe('business day', () => {
  it('uses the business time zone, not the browser zone', () => {
    process.env.TZ = 'America/Los_Angeles';

    // 18:30 UTC on Oct 9 is already Oct 10 in Ho Chi Minh City.
    expect(todayDateOnly(new Date('2026-10-09T18:30:00Z'))).toBe('2026-10-10');
    expect(todayDateOnly(new Date('2026-10-09T16:59:00Z'))).toBe('2026-10-09');
  });
});

describe('isOverdue', () => {
  const today = '2026-10-09';

  it('is true only for unfinished tasks due before today', () => {
    expect(isOverdue({ dueDate: '2026-10-08', status: 'TODO' }, today)).toBe(true);
    expect(isOverdue({ dueDate: '2026-10-08', status: 'IN_PROGRESS' }, today)).toBe(true);
    expect(isOverdue({ dueDate: '2026-10-09', status: 'TODO' }, today)).toBe(false);
    expect(isOverdue({ dueDate: null, status: 'TODO' }, today)).toBe(false);
  });

  it('never marks a done task as overdue', () => {
    expect(isOverdue({ dueDate: '2020-01-01', status: 'DONE' }, today)).toBe(false);
  });
});
