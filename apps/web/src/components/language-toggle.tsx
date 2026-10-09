'use client';

import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useLocale, useT } from '@/i18n/locale-provider';
import { isLocale, LOCALE_NAMES, LOCALES, type Locale } from '@/i18n/messages';

export function LanguageToggle({ className }: { className?: string }) {
  const { locale, setLocale } = useLocale();
  const t = useT();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className={className} aria-label={t.common.language.label}>
          <Flag locale={locale} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={locale} onValueChange={(next) => (isLocale(next) ? setLocale(next) : undefined)}>
          {LOCALES.map((option) => (
            <DropdownMenuRadioItem key={option} value={option} lang={option}>
              <Flag locale={option} />
              {LOCALE_NAMES[option]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Drawn inline because flag emoji do not render on Windows. */
function Flag({ locale }: { locale: Locale }) {
  return (
    <svg viewBox="0 0 30 20" aria-hidden="true" className="h-3.5 w-5 shrink-0 rounded-[3px] ring-1 ring-border">
      {locale === 'vi' ? (
        <>
          <rect width="30" height="20" fill="#da251d" />
          <polygon fill="#ff0" points="15,4 16.35,8.15 20.7,8.15 17.18,10.7 18.53,14.85 15,12.3 11.47,14.85 12.82,10.7 9.3,8.15 13.65,8.15" />
        </>
      ) : (
        <>
          <rect width="30" height="20" fill="#012169" />
          <path d="M0,0 30,20M30,0 0,20" stroke="#fff" strokeWidth="4" />
          <path d="M0,0 30,20M30,0 0,20" stroke="#c8102e" strokeWidth="1.5" />
          <path d="M15,0V20M0,10H30" stroke="#fff" strokeWidth="6.5" />
          <path d="M15,0V20M0,10H30" stroke="#c8102e" strokeWidth="4" />
        </>
      )}
    </svg>
  );
}
