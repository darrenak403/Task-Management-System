'use client';

import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useCurrentUser } from '@/features/auth/auth-provider';
import { useT } from '@/i18n/locale-provider';
import type { TeamMember } from '@/lib/dto';
import { invalidationBus, topics } from '@/lib/realtime/invalidation-bus';
import { useResource } from '@/lib/use-resource';

import { activateVersion, canActivate, getVersion } from './ai-plans-api';
import { DraftItems } from './draft-items';
import { plannerProblem } from './planner-errors';

/**
 * An AI revision is stored next to the active draft and replaces it only when the user accepts it.
 * Nothing is shown once the draft it was based on is no longer the active one.
 */
export function RevisionReady({
  workspaceId,
  teamId,
  planId,
  versionId,
  activeVersionId,
  members,
}: {
  workspaceId: string;
  teamId: string;
  planId: string;
  versionId: string;
  activeVersionId: string;
  members: readonly TeamMember[];
}) {
  const t = useT();
  const user = useCurrentUser();
  const [pending, setPending] = useState(false);
  const load = useCallback((signal: AbortSignal) => getVersion(workspaceId, teamId, planId, versionId, signal), [workspaceId, teamId, planId, versionId]);
  const revision = useResource(`ai-plan-version:${user.id}:${workspaceId}:${teamId}:${planId}:${versionId}`, load);

  async function accept() {
    setPending(true);
    try {
      await activateVersion(workspaceId, teamId, planId, versionId, activeVersionId);
      toast.success(t.planner.revise.accepted);
    } catch (error) {
      toast.error(plannerProblem(error).message);
    } finally {
      setPending(false);
      invalidationBus.publish(topics.planner(teamId));
    }
  }

  if (!revision.data || !canActivate(revision.data, activeVersionId)) return null;

  return (
    <Alert>
      <AlertTitle>{t.planner.revise.readyTitle}</AlertTitle>
      <AlertDescription>
        <Collapsible className="grid w-full gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>{t.planner.revise.readyDescription(revision.data.ordinal)}</span>
            <span className="flex gap-2">
              <CollapsibleTrigger asChild>
                <Button variant="outline" size="sm">
                  {t.planner.revise.preview}
                </Button>
              </CollapsibleTrigger>
              <Button size="sm" onClick={() => void accept()} disabled={pending}>
                {pending ? t.planner.revise.applying : t.planner.revise.use}
              </Button>
            </span>
          </div>
          <CollapsibleContent>
            <DraftItems items={revision.data.draft.items} members={members} />
          </CollapsibleContent>
        </Collapsible>
      </AlertDescription>
    </Alert>
  );
}
