import { intlLocale } from '@/i18n/messages';

/**
 * Deadlines are calendar dates (`YYYY-MM-DD`) with no time or zone. Everything that converts
 * between them and `Date` lives here, so no caller reaches for `toISOString()` and shifts a day.
 */

/** The API counts "today" and the upcoming window in this zone; the UI uses the same one for overdue labels. */
export const BUSINESS_TIME_ZONE = 'Asia/Ho_Chi_Minh';

const pad = (value: number, length = 2) => String(value).padStart(length, '0');

/** Reads the calendar day the user picked, in their own zone. */
export function toDateOnly(date: Date): string {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local midnight of the given calendar day, for calendar widgets. */
export function fromDateOnly(value: string): Date {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, day);
}


/** "Oct 9, 2026" in English, for the same calendar day in every time zone. */
export function formatDateOnly(value: string): string {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(intlLocale(), { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, day)));
}

const businessDayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function todayDateOnly(now: Date = new Date()): string {
  return businessDayFormat.format(now);
}

/** A finished task is never overdue, whatever its deadline. */
export function isOverdue(task: { dueDate: string | null; status: string }, today: string = todayDateOnly()): boolean {
  return task.dueDate !== null && task.status !== 'DONE' && task.dueDate < today;
}
