'use client';

import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';

import { DEFAULT_LOCALE, DICTIONARIES, LOCALE_COOKIE, setActiveLocale, type Locale, type Messages } from './messages';

type LocaleContextValue = { locale: Locale; setLocale: (locale: Locale) => void };

// Without a provider (unit tests) the interface is English and the language cannot be changed.
const LocaleContext = createContext<LocaleContextValue>({ locale: DEFAULT_LOCALE, setLocale: () => undefined });

/** Holds the interface language. The server passes the saved choice so the first render already matches it. */
export function LocaleProvider({ initialLocale, children }: { initialLocale: Locale; children: React.ReactNode }) {
  const [locale, setLocaleState] = useState(initialLocale);
  const router = useRouter();
  setActiveLocale(locale);

  const setLocale = useCallback(
    (next: Locale) => {
      document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
      document.documentElement.lang = next;
      setLocaleState(next);
      // Page titles are rendered on the server from the cookie.
      router.refresh();
    },
    [router],
  );

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  return useContext(LocaleContext);
}

/** Texts of the interface in the current language. */
export function useT(): Messages {
  return DICTIONARIES[useContext(LocaleContext).locale];
}
