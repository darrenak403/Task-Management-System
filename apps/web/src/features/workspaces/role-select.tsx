'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useT } from '@/i18n/locale-provider';


type AssignableRole = 'ADMIN' | 'MEMBER';

/** Switches a member between Admin and Member. The Owner role is never assignable. */
export function RoleSelect({
  value,
  memberName,
  disabled,
  onChange,
}: {
  value: AssignableRole;
  memberName: string;
  disabled: boolean;
  onChange: (role: AssignableRole) => void;
}) {
  const t = useT();
  return (
    <Select value={value} onValueChange={(next) => onChange(next as AssignableRole)} disabled={disabled}>
      <SelectTrigger size="sm" className="w-28" aria-label={t.workspaces.roleOf(memberName)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="ADMIN">{t.common.role.ADMIN}</SelectItem>
        <SelectItem value="MEMBER">{t.common.role.MEMBER}</SelectItem>
      </SelectContent>
    </Select>
  );
}
