'use client';

import { cn } from 'cn';

import { useT } from '@/i18n/locale-provider';
import { useRealtimeStatus, type RealtimeStatus } from '@/lib/realtime/realtime-provider';

const DOTS: Record<Exclude<RealtimeStatus, 'idle' | 'ready'>, string> = {
  connecting: 'bg-muted-foreground',
  reconnecting: 'bg-overdue',
  resync: 'bg-status-in-progress-foreground',
};

/** Stays out of the way while updates arrive live, and says in words when the screen is connecting or has fallen behind. */
export function ConnectionIndicator() {
  const t = useT();
  const status = useRealtimeStatus();
  if (status === 'idle' || status === 'ready') return null;
  const text = t.common.connection[status];
  const dot = DOTS[status];
  return (
    <p role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={cn('size-2 rounded-full', dot)} aria-hidden="true" />
      <span className="hidden sm:inline">{text}</span>
      <span className="sr-only sm:hidden">{text}</span>
    </p>
  );
}
