'use client';

import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '@/i18n/format';
import { useT } from '@/i18n/locale-provider';
import type { Messages } from '@/i18n/messages';
import { toRouteId } from '@/lib/route-id';

import type { PlanSummary } from './ai-plans-api';

/** What a plan needs next, in words. */
function stateOf(plan: PlanSummary, text: Messages['planner']['list']): { label: string; variant: 'default' | 'secondary' | 'outline' } {
  if (plan.status === 'IMPORTED') return { label: text.confirmed, variant: 'default' };
  if (plan.status === 'EXPIRED') return { label: text.expired, variant: 'outline' };
  if (!plan.latestJob) return { label: text.draft, variant: 'secondary' };
  // A failed revision leaves the earlier draft usable.
  if (plan.activeVersionId && plan.latestJob.status !== 'QUEUED' && plan.latestJob.status !== 'RUNNING' && plan.latestJob.status !== 'NEEDS_CLARIFICATION') {
    return { label: text.draftReady, variant: 'secondary' };
  }
  return { label: text.job[plan.latestJob.status], variant: 'secondary' };
}

/** The caller's own plans in a team, in the order the API returns them. */
export function PlanList({ plans, basePath }: { plans: readonly PlanSummary[]; basePath: string }) {
  const t = useT();
  return (
    <ul className="grid gap-2">
      {plans.map((plan) => {
        const state = stateOf(plan, t.planner.list);
        return (
          <li key={plan.id}>
            <Link
              href={`${basePath}/${toRouteId(plan.id)}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span className="min-w-0">
                <span className="block font-medium">{t.planner.list.planFrom(formatDateTime(plan.createdAt))}</span>
                <span className="block text-sm text-muted-foreground">{t.planner.list.updated(formatDateTime(plan.updatedAt))}</span>
              </span>
              <Badge variant={state.variant}>{state.label}</Badge>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
