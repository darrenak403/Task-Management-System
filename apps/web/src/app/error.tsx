'use client';

import { ErrorState } from '@/components/error-state';
import { useT } from '@/i18n/locale-provider';

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT();
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <ErrorState title={t.common.errors.pageTitle} message={t.common.errors.pageMessage} onRetry={reset} />
    </main>
  );
}
