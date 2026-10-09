'use client';

import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useT } from '@/i18n/locale-provider';
import type { TeamMember } from '@/lib/dto';
import { displayNameOf } from '@/lib/people';
import type { PagedList } from '@/lib/use-paged-list';

/** Radix Select has no empty value, so "nobody" needs a sentinel. */
const NONE = '__none__';

/** Picks one person from a team roster, or nobody. `emptyLabel` names the "nobody" choice. */
export function AssigneeSelect({
  id,
  roster,
  value,
  onChange,
  emptyLabel,
  ariaLabel,
  disabled = false,
  invalid = false,
  className,
}: {
  id?: string;
  roster: PagedList<TeamMember>;
  value: string | null;
  onChange: (userId: string | null) => void;
  emptyLabel: string;
  ariaLabel?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
}) {
  const t = useT();
  const known = value === null || roster.items.some((member) => member.id === value);
  return (
    <div className="flex flex-col gap-1">
      <Select value={value ?? NONE} onValueChange={(next) => onChange(next === NONE ? null : next)} disabled={disabled}>
        <SelectTrigger id={id} className={className ?? 'w-full'} aria-label={ariaLabel} aria-invalid={invalid || undefined}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{emptyLabel}</SelectItem>
          {/* The current value stays selectable while the roster loads or after that person left the team. */}
          {!known && value ? <SelectItem value={value}>{roster.loading ? t.common.loading : t.tasks.formerMember}</SelectItem> : null}
          {roster.items.map((member) => (
            <SelectItem key={member.id} value={member.id}>
              {displayNameOf(member)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {roster.hasMore ? (
        <Button type="button" variant="link" size="sm" className="self-start px-0" onClick={roster.loadMore} disabled={roster.loadingMore}>
          {roster.loadingMore ? t.common.loading : t.tasks.loadMorePeople}
        </Button>
      ) : null}
    </div>
  );
}
