'use client';

import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useT } from '@/i18n/locale-provider';

/** Previous/next controls for a server-paginated list. Renders nothing when there is a single page. */
export function PageControls({
  page,
  totalPages,
  total,
  onPageChange,
  disabled = false,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
}) {
  const t = useT();
  if (totalPages <= 1) return null;
  return (
    <nav aria-label={t.common.pagination.label} className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {t.common.pagination.summary(page, totalPages, total)}
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => onPageChange(page - 1)} disabled={disabled || page <= 1}>
          <ChevronLeftIcon aria-hidden="true" /> {t.common.pagination.previous}
        </Button>
        <Button variant="outline" size="sm" onClick={() => onPageChange(page + 1)} disabled={disabled || page >= totalPages}>
          {t.common.pagination.next} <ChevronRightIcon aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}
