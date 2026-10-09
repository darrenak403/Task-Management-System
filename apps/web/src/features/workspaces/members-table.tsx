'use client';

import { UserPlusIcon } from 'lucide-react';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import { ConfirmDialog } from '@/components/confirm-dialog';
import { ErrorState } from '@/components/error-state';
import { PageControls } from '@/components/page-controls';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCurrentUser } from '@/features/auth/auth-provider';
import { useT } from '@/i18n/locale-provider';
import { errorMessage } from '@/lib/api-errors';
import type { WorkspaceMember } from '@/lib/dto';
import { notifyWriteError } from '@/lib/notify';
import { displayNameOf } from '@/lib/people';
import { invalidationBus, topics } from '@/lib/realtime/invalidation-bus';
import { useResource } from '@/lib/use-resource';

import { AddMemberDialog } from './add-member-dialog';
import { can, canChangeRole, canRemoveMember } from './permissions';
import { RoleSelect } from './role-select';
import { useWorkspace } from './workspace-scope';
import { changeMemberRole, listWorkspaceMembers, removeWorkspaceMember } from './workspaces-api';

export function MembersTable() {
  const t = useT();
  const user = useCurrentUser();
  const { workspaceId, role } = useWorkspace();
  const [page, setPage] = useState(1);
  const [addOpen, setAddOpen] = useState(false);
  const [removing, setRemoving] = useState<WorkspaceMember | null>(null);
  const [changingRoleOf, setChangingRoleOf] = useState<string | null>(null);

  const load = useCallback(
    (signal: AbortSignal) => listWorkspaceMembers(workspaceId, page, signal),
    [workspaceId, page],
  );
  const members = useResource(`members:${user.id}:${workspaceId}:${page}`, load, { topics: [topics.members] });
  const actor = { id: user.id, role };
  const rows = members.data?.data ?? [];

  async function handleRoleChange(member: WorkspaceMember, next: 'ADMIN' | 'MEMBER') {
    if (next === member.role) return;
    setChangingRoleOf(member.id);
    try {
      await changeMemberRole(workspaceId, member.id, next);
      toast.success(t.workspaces.members.roleChanged(displayNameOf(member), t.common.role[next]));
    } catch (error) {
      notifyWriteError(error);
    } finally {
      setChangingRoleOf(null);
      invalidationBus.publish(topics.members);
    }
  }

  async function handleRemove(member: WorkspaceMember) {
    try {
      await removeWorkspaceMember(workspaceId, member.id);
      toast.success(t.workspaces.members.removed(displayNameOf(member)));
      // Removing the last row of a later page would otherwise leave an empty page on screen.
      if (rows.length === 1 && page > 1) setPage(page - 1);
    } catch (error) {
      notifyWriteError(error);
    } finally {
      invalidationBus.publish(topics.members);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {members.data ? t.workspaces.members.count(members.data.meta.total) : ' '}
        </p>
        {can('members.add', role) ? (
          <Button onClick={() => setAddOpen(true)}>
            <UserPlusIcon aria-hidden="true" /> {t.workspaces.addMember.title}
          </Button>
        ) : null}
      </div>

      {members.error && !members.data ? (
        <ErrorState message={errorMessage(members.error)} onRetry={() => void members.reload()} />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table aria-busy={members.fetching}>
            <TableHeader>
              <TableRow>
                <TableHead>{t.common.name}</TableHead>
                <TableHead>{t.common.email}</TableHead>
                <TableHead>{t.workspaces.members.role}</TableHead>
                <TableHead className="text-right">{t.common.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.loading
                ? [0, 1, 2].map((row) => (
                    <TableRow key={row}>
                      <TableCell colSpan={4}>
                        <Skeleton className="h-6 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                : rows.map((member) => {
                    const name = displayNameOf(member);
                    const removable = canRemoveMember(actor, member);
                    return (
                      <TableRow key={member.id}>
                        <TableCell className="font-medium">
                          {name}
                          {member.id === user.id ? <span className="ml-2 text-xs text-muted-foreground">{t.workspaces.members.you}</span> : null}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{member.email}</TableCell>
                        <TableCell>
                          {canChangeRole(actor, member) && member.role !== 'OWNER' ? (
                            <RoleSelect
                              value={member.role}
                              memberName={name}
                              disabled={changingRoleOf === member.id}
                              onChange={(next) => void handleRoleChange(member, next)}
                            />
                          ) : (
                            <Badge variant="outline">{t.common.role[member.role]}</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {removable ? (
                            <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setRemoving(member)}>
                              {t.common.remove}<span className="sr-only"> {name}</span>
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
            </TableBody>
          </Table>
        </div>
      )}

      {members.data ? (
        <PageControls
          page={members.data.meta.page}
          totalPages={members.data.meta.totalPages}
          total={members.data.meta.total}
          onPageChange={setPage}
          disabled={members.fetching}
        />
      ) : null}

      <AddMemberDialog workspaceId={workspaceId} open={addOpen} onOpenChange={setAddOpen} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => (open ? undefined : setRemoving(null))}
        title={removing ? t.workspaces.members.removeTitle(displayNameOf(removing)) : t.workspaces.members.removeTitleGeneric}
        description={t.workspaces.members.removeDescription}
        confirmLabel={t.workspaces.members.removeConfirm}
        onConfirm={async () => {
          if (removing) await handleRemove(removing);
        }}
      />
    </div>
  );
}
