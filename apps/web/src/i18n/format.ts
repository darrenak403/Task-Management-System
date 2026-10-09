import { intlLocale } from './messages';

/** "Oct 9, 2026, 10:27 PM" in English, the matching form in other languages. */
export function formatDateTime(value: string | Date): string {
  return new Intl.DateTimeFormat(intlLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
