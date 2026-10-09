'use client';

import { useState } from 'react';

import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n/locale-provider';

/** Sticky summary of the selection with the single action that creates real tasks. */
export function ConfirmBar({
  selectedCount,
  totalCount,
  missingCount,
  confirming,
  disabled,
  onConfirm,
}: {
  selectedCount: number;
  totalCount: number;
  /** Selected tasks that depend on unselected ones; confirming is blocked while there are any. */
  missingCount: number;
  confirming: boolean;
  disabled: boolean;
  onConfirm: () => Promise<void>;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const blocked = selectedCount === 0 || missingCount > 0;

  return (
    <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background/95 p-3 backdrop-blur">
      <p className="text-sm" aria-live="polite">
        <span className="font-medium">
          {t.planner.confirm.selected(selectedCount, totalCount)}
        </span>{' '}
        <span className={missingCount > 0 ? 'text-destructive' : 'text-muted-foreground'}>
          {missingCount > 0
            ? t.planner.confirm.missing(missingCount)
            : selectedCount === 0
              ? t.planner.confirm.selectOne
              : t.planner.confirm.nothingYet}
        </span>
      </p>
      <Button onClick={() => setOpen(true)} disabled={disabled || confirming || blocked}>
        {confirming ? t.planner.confirm.creating : t.planner.confirm.action}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t.planner.confirm.title(selectedCount)}
        description={t.planner.confirm.description}
        confirmLabel={t.planner.confirm.confirmLabel}
        destructive={false}
        onConfirm={onConfirm}
      />
    </div>
  );
}
