'use client';

import { CalendarIcon, XIcon } from 'lucide-react';
import { vi } from 'date-fns/locale';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useLocale, useT } from '@/i18n/locale-provider';

import { formatDateOnly, fromDateOnly, toDateOnly } from './date-only';

/** Calendar-day deadline. Past days are allowed, and the deadline can be cleared. */
export function DeadlinePicker({
  id,
  value,
  onChange,
  disabled = false,
  emptyLabel,
  describedBy,
}: {
  id?: string;
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  /** Shown while no day is picked. */
  emptyLabel?: string;
  /** Id of an error message that belongs to this picker. */
  describedBy?: string;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [open, setOpen] = useState(false);
  const selected = value ? fromDateOnly(value) : undefined;

  return (
    <div className="flex items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            className="min-w-0 flex-1 justify-start font-normal"
            disabled={disabled}
            aria-describedby={describedBy}
            aria-invalid={describedBy ? true : undefined}
          >
            <CalendarIcon aria-hidden="true" />
            {value ? formatDateOnly(value) : <span className="text-muted-foreground">{emptyLabel ?? t.tasks.noDeadline}</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            {...(locale === 'vi' ? { locale: vi } : {})}
            selected={selected}
            defaultMonth={selected}
            onSelect={(date) => {
              // Only the picked year, month and day are read; the time and zone of `date` are ignored.
              onChange(date ? toDateOnly(date) : null);
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      {value ? (
        <Button type="button" variant="ghost" size="icon" onClick={() => onChange(null)} disabled={disabled} aria-label={t.tasks.clearDate}>
          <XIcon aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );
}
