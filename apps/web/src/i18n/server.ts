import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';

import { DEFAULT_LOCALE, DICTIONARIES, isLocale, LOCALE_COOKIE, type Locale, type Messages } from './messages';

/** The saved language, or the browser's preferred one on a first visit. */
export async function getLocale(): Promise<Locale> {
  const saved = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(saved)) return saved;
  const preferred = (await headers()).get('accept-language')?.trim().toLowerCase() ?? '';
  return preferred.startsWith('vi') ? 'vi' : DEFAULT_LOCALE;
}

export async function getMessages(): Promise<Messages> {
  return DICTIONARIES[await getLocale()];
}

/** `generateMetadata` for a page whose only metadata is a translated title. */
export function titleMetadata(pick: (m: Messages) => string): () => Promise<Metadata> {
  return async () => ({ title: pick(await getMessages()) });
}
