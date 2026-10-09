'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useT } from '@/i18n/locale-provider';
import type { PlanDraftItem } from '@/lib/dto';

import { dependencyCandidates } from './draft-utils';

/** Picks which other draft tasks must be finished first. Choices that would form a loop are not offered. */
export function DependencyEditor({
  items,
  itemId,
  value,
  onChange,
  disabled = false,
}: {
  items: readonly PlanDraftItem[];
  itemId: string;
  value: string[];
  onChange: (dependencies: string[]) => void;
  disabled?: boolean;
}) {
  const t = useT();
  // The loop check uses the dependencies being edited, not the saved ones.
  const current = items.map((item) => (item.id === itemId ? { ...item, dependencies: value } : item));
  const candidates = dependencyCandidates(current, itemId);

  if (candidates.length === 0) return <p className="text-sm text-muted-foreground">{t.planner.noPrerequisite}</p>;
  return (
    <ul className="grid max-h-40 gap-2 overflow-y-auto rounded-md border p-3">
      {candidates.map((candidate) => {
        const id = `dependency-${candidate.id}`;
        const checked = value.includes(candidate.id);
        return (
          <li key={candidate.id} className="flex items-start gap-2">
            <Checkbox
              id={id}
              checked={checked}
              disabled={disabled}
              className="mt-0.5"
              onCheckedChange={(next) => onChange(next === true ? [...value, candidate.id] : value.filter((dependency) => dependency !== candidate.id))}
            />
            <Label htmlFor={id} className="font-normal leading-snug">
              {candidate.title}
            </Label>
          </li>
        );
      })}
    </ul>
  );
}
