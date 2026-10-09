import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';

import './globals.css';
import { QueryProvider } from '@/components/query-provider';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { LocaleProvider } from '@/i18n/locale-provider';
import { getLocale, getMessages } from '@/i18n/server';
import { cn } from '@/lib/utils';

const fontSans = Geist({ subsets: ['latin'], variable: '--font-sans' });
const fontMono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono' });

export async function generateMetadata(): Promise<Metadata> {
  return { title: { default: 'AIM', template: '%s · AIM' }, description: (await getMessages()).common.appDescription };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();

  return (
    <html lang={locale} suppressHydrationWarning className={cn('font-sans antialiased', fontSans.variable, fontMono.variable)}>
      <body>
        <ThemeProvider>
          <LocaleProvider initialLocale={locale}>
            <QueryProvider>
              <TooltipProvider>{children}</TooltipProvider>
            </QueryProvider>
          </LocaleProvider>
          <Toaster richColors closeButton />
        </ThemeProvider>
      </body>
    </html>
  );
}
