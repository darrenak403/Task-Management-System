'use client';

import { toast } from 'sonner';

import { NameDialog } from '@/components/name-dialog';
import { useCurrentUser } from '@/features/auth/auth-provider';
import { useT } from '@/i18n/locale-provider';
import type { Team } from '@/lib/dto';
import { invalidationBus, topics } from '@/lib/realtime/invalidation-bus';

import { addTeamMember, createTeam, renameTeam } from './teams-api';

/** Creates a team with its creator as the first member, or renames `team` when one is given. */
export function TeamDialog({
  workspaceId,
  team,
  open,
  onOpenChange,
  onCreated,
}: {
  workspaceId: string;
  team?: Team | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (team: Team) => void;
}) {
  const t = useT();
  const user = useCurrentUser();

  return (
    <NameDialog
      // Remounts per team so the field starts from that team's current name.
      key={team?.id ?? 'new'}
      open={open}
      onOpenChange={onOpenChange}
      title={team ? t.teams.dialog.renameTitle : t.nav.createTeam}
      description={
        team ? t.teams.dialog.renameDescription : t.teams.dialog.createDescription
      }
      submitLabel={team ? t.common.save : t.nav.createTeam}
      initialName={team?.name ?? ''}
      onSubmit={async (name) => {
        let created: Team | undefined;
        if (team) await renameTeam(workspaceId, team.id, name);
        else {
          created = await createTeam(workspaceId, name);
          // Only team members can be given tasks, so the creator joins. The team is still usable if this step fails.
          await addTeamMember(workspaceId, created.id, user.id).catch(() => undefined);
        }
        // The sidebar lists teams from the same topic, so it follows every change here.
        invalidationBus.publish(topics.structure);
        toast.success(team ? t.teams.dialog.renamed : t.teams.dialog.created);
        if (created) onCreated?.(created);
      }}
    />
  );
}
