'use client';

import { useT } from '@/i18n/locale-provider';
import type { PlanDraftItem, TeamMember } from '@/lib/dto';
import { displayNameOf } from '@/lib/people';

import { DraftTaskItem } from './draft-task-item';

/** The task list of a draft version. Selection and editing are offered only when their handlers are passed. */
export function DraftItems({
  items,
  members,
  selectedIds,
  missingIds,
  disabled = false,
  onSelectedChange,
  onEdit,
}: {
  items: readonly PlanDraftItem[];
  members: readonly TeamMember[];
  selectedIds?: ReadonlySet<string>;
  missingIds?: ReadonlySet<string>;
  disabled?: boolean;
  onSelectedChange?: (itemId: string, selected: boolean) => void;
  onEdit?: (item: PlanDraftItem) => void;
}) {
  const t = useT();
  const titles = new Map(items.map((item) => [item.id, item.title]));
  const names = new Map(members.map((member) => [member.id, displayNameOf(member)]));

  return (
    <ol className="grid gap-3">
      {items.map((item, index) => (
        <DraftTaskItem
          key={item.id}
          item={item}
          number={index + 1}
          selected={selectedIds ? selectedIds.has(item.id) : item.selected}
          assigneeName={item.assigneeId ? (names.get(item.assigneeId) ?? t.tasks.formerMember) : null}
          dependencyTitles={item.dependencies.map((id) => titles.get(id) ?? t.planner.removedTask)}
          missingDependency={missingIds?.has(item.id) ?? false}
          disabled={disabled}
          {...(onSelectedChange ? { onSelectedChange: (selected: boolean) => onSelectedChange(item.id, selected) } : {})}
          {...(onEdit ? { onEdit: () => onEdit(item) } : {})}
        />
      ))}
    </ol>
  );
}
