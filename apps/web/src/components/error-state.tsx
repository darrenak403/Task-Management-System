'use client';

import { TriangleAlertIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useT } from '@/i18n/locale-provider';

/** Shared "could not load" panel with an optional retry action. */
export function ErrorState({
  title,
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  const t = useT();
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center">
      <TriangleAlertIcon className="size-6 text-destructive" aria-hidden="true" />
      <div className="space-y-1">
        <p className="font-medium">{title ?? t.common.errors.loadTitle}</p>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          {t.common.tryAgain}
        </Button>
      ) : null}
    </div>
  );
}
