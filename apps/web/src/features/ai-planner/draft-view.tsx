'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Plan, PlanContent, PlanDescription, PlanHeader, PlanTitle, PlanTrigger } from '@/components/ai-elements/plan';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useT } from '@/i18n/locale-provider';
import { isOutcomeUnknown } from '@/lib/api-errors';
import type { PlanDraftItem, TeamMember } from '@/lib/dto';
import { invalidationBus, topics } from '@/lib/realtime/invalidation-bus';
import type { PagedList } from '@/lib/use-paged-list';

import { draftContentOf, saveVersion, type ActiveVersion } from './ai-plans-api';
import { ConfirmBar } from './confirm-bar';
import { DraftItemDialog } from './draft-item-dialog';
import { DraftItems } from './draft-items';
import { itemsMissingDependencies, locksAfterEdit } from './draft-utils';
import { plannerProblem } from './planner-errors';

/**
 * The editable draft: pick tasks, edit them, then confirm. Mount it with the version id as `key`,
 * so a newer version restarts the selection from what that version stores.
 */
export function DraftView({
  workspaceId,
  teamId,
  planId,
  version,
  roster,
  confirming,
  onConfirm,
}: {
  workspaceId: string;
  teamId: string;
  planId: string;
  version: ActiveVersion;
  roster: PagedList<TeamMember>;
  confirming: boolean;
  onConfirm: (selectedItemIds: string[]) => Promise<void>;
}) {
  const t = useT();
  const draft = version.draft;
  const [selectedIds, setSelectedIds] = useState(() => new Set(draft.items.filter((item) => item.selected).map((item) => item.id)));
  const [editing, setEditing] = useState<PlanDraftItem | null>(null);
  const missing = useMemo(() => new Set(itemsMissingDependencies(draft.items, selectedIds).map((item) => item.id)), [draft.items, selectedIds]);

  function toggle(itemId: string, selected: boolean) {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (selected) next.add(itemId);
      else next.delete(itemId);
      return next;
    });
  }

  async function saveItem(next: PlanDraftItem): Promise<string | null> {
    const before = draft.items.find((item) => item.id === next.id);
    if (!before) return t.planner.item.gone;
    // The current selection is stored with the edit, so the new version opens with the same tasks picked.
    const items = draft.items.map((item) => ({ ...(item.id === next.id ? next : item), selected: selectedIds.has(item.id) }));
    try {
      await saveVersion(workspaceId, teamId, planId, {
        expectedActiveVersionId: version.id,
        draft: draftContentOf(draft, items),
        fieldLocks: locksAfterEdit(draft.fieldLocks ?? [], before, next),
      });
      toast.success(t.planner.item.saved);
      return null;
    } catch (error) {
      if (isOutcomeUnknown(error)) return t.planner.item.outcomeUnknown;
      const problem = plannerProblem(error);
      // The draft moved on; the dialog closes so the user sees the version that is active now.
      if (problem.next === 'reload') {
        toast.error(problem.message);
        return null;
      }
      return problem.message;
    } finally {
      invalidationBus.publish(topics.planner(teamId));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Plan defaultOpen>
        <PlanHeader>
          <div className="min-w-0 space-y-1">
            <PlanTitle>{draft.planTitle}</PlanTitle>
            <PlanDescription>{draft.goalSummary}</PlanDescription>
          </div>
          <PlanTrigger />
        </PlanHeader>
        <PlanContent className="grid gap-4">
          <Notes title={t.planner.draft.assumptions} notes={draft.assumptions} />
          <Notes title={t.planner.draft.warnings} notes={draft.warnings} warning />
          <DraftItems
            items={draft.items}
            members={roster.items}
            selectedIds={selectedIds}
            missingIds={missing}
            disabled={confirming}
            onSelectedChange={toggle}
            onEdit={setEditing}
          />
        </PlanContent>
      </Plan>

      <ConfirmBar
        selectedCount={selectedIds.size}
        totalCount={draft.items.length}
        missingCount={missing.size}
        confirming={confirming}
        disabled={editing !== null}
        // Sent in draft order, whatever order the tasks were ticked in.
        onConfirm={() => onConfirm(draft.items.filter((item) => selectedIds.has(item.id)).map((item) => item.id))}
      />

      <DraftItemDialog item={editing} items={draft.items} roster={roster} onSave={saveItem} onOpenChange={(open) => (open ? undefined : setEditing(null))} />
    </div>
  );
}

function Notes({ title, notes, warning = false }: { title: string; notes: string[]; warning?: boolean }) {
  if (notes.length === 0) return null;
  return (
    <Alert variant={warning ? 'destructive' : 'default'}>
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <ul className="list-disc pl-5">
          {notes.map((note, index) => (
            <li key={`${index}-${note}`}>{note}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
