'use client';

import { SparklesIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { DeadlinePicker } from '@/features/tasks/deadline-picker';
import { useT } from '@/i18n/locale-provider';
import { invalidationBus, topics } from '@/lib/realtime/invalidation-bus';

import { AI_FIELDS, generateRevision, newRequestKey, type RevisionAction } from './ai-plans-api';
import { plannerProblem } from './planner-errors';

const ACTIONS = ['REGENERATE', 'SIMPLIFY', 'ADD_DETAIL'] as const satisfies readonly RevisionAction[];

/** Asks the AI to rework every task of the current draft. The result is offered as a separate version to accept. */
export function ReviseMenu({
  workspaceId,
  teamId,
  planId,
  versionId,
  itemIds,
}: {
  workspaceId: string;
  teamId: string;
  planId: string;
  versionId: string;
  itemIds: string[];
}) {
  const t = useT();
  const [pending, setPending] = useState(false);
  const [deadlineOpen, setDeadlineOpen] = useState(false);
  const [deadline, setDeadline] = useState<string | null>(null);

  async function revise(action: RevisionAction, extra: { deadline?: string } = {}) {
    setPending(true);
    try {
      await generateRevision(workspaceId, teamId, planId, {
        requestKey: newRequestKey(),
        action,
        baseVersionId: versionId,
        itemIds,
        ...(action === 'REGENERATE' ? { fieldMask: [...AI_FIELDS] } : {}),
        ...extra,
      });
      setDeadlineOpen(false);
    } catch (error) {
      toast.error(plannerProblem(error).message);
    } finally {
      setPending(false);
      invalidationBus.publish(topics.planner(teamId));
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" disabled={pending}>
            <SparklesIcon aria-hidden="true" />
            {t.planner.revise.trigger}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {ACTIONS.map((action) => (
            <DropdownMenuItem key={action} onSelect={() => void revise(action)}>
              {t.planner.revise.actions[action]}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem onSelect={() => setDeadlineOpen(true)}>{t.planner.revise.fitDeadlineItem}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={deadlineOpen} onOpenChange={(next) => (pending ? undefined : setDeadlineOpen(next))}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t.planner.revise.fitDeadline}</DialogTitle>
            <DialogDescription>{t.planner.revise.fitDeadlineDescription}</DialogDescription>
          </DialogHeader>
          <DeadlinePicker value={deadline} onChange={setDeadline} disabled={pending} emptyLabel={t.planner.revise.pickDate} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeadlineOpen(false)} disabled={pending}>
              {t.common.cancel}
            </Button>
            <Button onClick={() => (deadline ? void revise('ADJUST_DEADLINE', { deadline }) : undefined)} disabled={pending || !deadline}>
              {pending ? t.planner.goal.starting : t.planner.revise.reschedule}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
