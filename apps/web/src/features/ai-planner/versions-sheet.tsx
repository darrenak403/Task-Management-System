'use client';

import { HistoryIcon } from 'lucide-react';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import { ConfirmDialog } from '@/components/confirm-dialog';
import { ErrorState } from '@/components/error-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useCurrentUser } from '@/features/auth/auth-provider';
import { formatDateTime } from '@/i18n/format';
import { useT } from '@/i18n/locale-provider';
import { errorMessage } from '@/lib/api-errors';
import type { TeamMember } from '@/lib/dto';
import { invalidationBus, topics } from '@/lib/realtime/invalidation-bus';
import { usePagedList } from '@/lib/use-paged-list';
import { useResource } from '@/lib/use-resource';

import { activateVersion, canActivate, getVersion, listVersions, type VersionSummary } from './ai-plans-api';
import { DraftItems } from './draft-items';
import { plannerProblem } from './planner-errors';

type Props = {
  workspaceId: string;
  teamId: string;
  planId: string;
  activeVersionId: string | null;
  members: readonly TeamMember[];
  /** A waiting AI revision can be made active only while the plan is still an editable draft. */
  editable: boolean;
};

export function VersionsSheet(props: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline">
          <HistoryIcon aria-hidden="true" />
          {t.planner.versions.title}
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{t.planner.versions.title}</SheetTitle>
          <SheetDescription>{t.planner.versions.description}</SheetDescription>
        </SheetHeader>
        {/* Loaded only while the sheet is open. */}
        {open ? <VersionList {...props} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function VersionList({ workspaceId, teamId, planId, activeVersionId, members, editable }: Props) {
  const t = useT();
  const user = useCurrentUser();
  const [target, setTarget] = useState<VersionSummary | null>(null);
  const load = useCallback((page: number, signal: AbortSignal) => listVersions(workspaceId, teamId, planId, page, signal), [workspaceId, teamId, planId]);
  const versions = usePagedList(`ai-plan-versions:${user.id}:${workspaceId}:${teamId}:${planId}`, load, { topics: [topics.planner(teamId)] });

  async function handleActivate() {
    if (!target) return;
    try {
      await activateVersion(workspaceId, teamId, planId, target.id, activeVersionId);
      toast.success(t.planner.versions.activated(target.ordinal));
    } catch (error) {
      toast.error(plannerProblem(error).message);
    } finally {
      invalidationBus.publish(topics.planner(teamId));
    }
  }

  if (versions.loading) return <Skeleton className="mx-4 h-40" aria-label={t.planner.versions.loading} />;
  if (versions.error && versions.items.length === 0) {
    return (
      <div className="px-4">
        <ErrorState message={errorMessage(versions.error)} onRetry={() => void versions.reload()} />
      </div>
    );
  }

  return (
    <div className="grid gap-3 px-4 pb-4">
      <ul className="grid gap-3">
        {versions.items.map((version) => (
          <VersionRow
            key={version.id}
            scope={{ workspaceId, teamId, planId }}
            version={version}
            members={members}
            {...(editable && !version.purged && canActivate(version, activeVersionId) ? { onActivate: () => setTarget(version) } : {})}
          />
        ))}
      </ul>
      {versions.hasMore ? (
        <Button variant="outline" onClick={versions.loadMore} disabled={versions.loadingMore}>
          {versions.loadingMore ? t.common.loading : t.planner.versions.loadMore}
        </Button>
      ) : null}
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(next) => (next ? undefined : setTarget(null))}
        title={t.planner.versions.activateTitle(target?.ordinal ?? '')}
        description={t.planner.versions.activateDescription}
        confirmLabel={t.planner.versions.makeActive}
        destructive={false}
        onConfirm={handleActivate}
      />
    </div>
  );
}


function VersionRow({
  scope,
  version,
  members,
  onActivate,
}: {
  scope: { workspaceId: string; teamId: string; planId: string };
  version: VersionSummary;
  members: readonly TeamMember[];
  onActivate?: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-lg border p-3">
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 font-medium">
              {t.planner.versions.version(version.ordinal)}
              {version.active ? <Badge>{t.planner.versions.active}</Badge> : null}
            </p>
            <p className="text-sm text-muted-foreground">
              {t.planner.versions.source[version.source]} · {formatDateTime(version.createdAt)}
            </p>
          </div>
          <div className="flex gap-2">
            {version.purged ? (
              <span className="text-sm text-muted-foreground">{t.planner.versions.contentExpired}</span>
            ) : (
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm">
                  {open ? t.planner.versions.hide : t.planner.versions.view}
                </Button>
              </CollapsibleTrigger>
            )}
            {onActivate ? (
              <Button variant="outline" size="sm" onClick={onActivate}>
                {t.planner.versions.makeActive}
              </Button>
            ) : null}
          </div>
        </div>
        <CollapsibleContent className="mt-3">{open ? <VersionContent {...scope} versionId={version.id} members={members} /> : null}</CollapsibleContent>
      </Collapsible>
    </li>
  );
}

/** The list carries no task content; it is loaded when a version is opened. */
function VersionContent({
  workspaceId,
  teamId,
  planId,
  versionId,
  members,
}: {
  workspaceId: string;
  teamId: string;
  planId: string;
  versionId: string;
  members: readonly TeamMember[];
}) {
  const t = useT();
  const user = useCurrentUser();
  const load = useCallback((signal: AbortSignal) => getVersion(workspaceId, teamId, planId, versionId, signal), [workspaceId, teamId, planId, versionId]);
  const content = useResource(`ai-plan-version:${user.id}:${workspaceId}:${teamId}:${planId}:${versionId}`, load);

  if (content.data) return <DraftItems items={content.data.draft.items} members={members} />;
  if (content.error) return <ErrorState message={plannerProblem(content.error).message} onRetry={() => void content.reload()} />;
  return <Skeleton className="h-24" aria-label={t.planner.versions.loadingVersion} />;
}
