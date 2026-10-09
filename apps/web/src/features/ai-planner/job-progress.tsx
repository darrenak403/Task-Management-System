'use client';

import { CheckIcon, CircleDashedIcon, CircleIcon, MinusIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Shimmer } from '@/components/ai-elements/shimmer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useT } from '@/i18n/locale-provider';
import type { AiJob } from '@/lib/dto';
import { invalidationBus, topics } from '@/lib/realtime/invalidation-bus';

import { cancelJob } from './ai-jobs-api';
import type { LatestJob } from './ai-plans-api';
import { plannerProblem } from './planner-errors';

type Stage = AiJob['stages'][number];

const STAGE_ICONS: Record<Stage['status'], React.ReactNode> = {
  pending: <CircleIcon className="size-4 text-muted-foreground" aria-hidden="true" />,
  active: <CircleDashedIcon className="size-4 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />,
  completed: <CheckIcon className="size-4 text-primary" aria-hidden="true" />,
  failed: <XIcon className="size-4 text-destructive" aria-hidden="true" />,
  skipped: <MinusIcon className="size-4 text-muted-foreground" aria-hidden="true" />,
};

/** Progress of a running request, as reported by the server; the page reloads it when the server signals a change. */
export function JobProgress({ workspaceId, teamId, latestJob, job }: { workspaceId: string; teamId: string; latestJob: LatestJob; job: AiJob | null }) {
  const t = useT();
  const [cancelling, setCancelling] = useState(false);
  const stages = job?.id === latestJob.id ? job.stages : [];

  async function handleCancel() {
    setCancelling(true);
    try {
      await cancelJob(workspaceId, teamId, latestJob.id);
    } catch (error) {
      toast.error(plannerProblem(error).message);
    } finally {
      setCancelling(false);
      invalidationBus.publish(topics.planner(teamId));
    }
  }

  return (
    <Card aria-live="polite">
      <CardHeader>
        <CardTitle>
          <Shimmer>{latestJob.status === 'QUEUED' ? t.planner.progress.queued : t.planner.progress.generating}</Shimmer>
        </CardTitle>
        <CardDescription>{t.planner.progress.keepsRunning}</CardDescription>
      </CardHeader>
      {stages.length > 0 ? (
        <CardContent>
          <ol className="grid gap-3">
            {stages.map((stage) => (
              <li key={stage.key} className="flex items-start gap-2 text-sm">
                <span className="mt-0.5">{STAGE_ICONS[stage.status]}</span>
                <span className="min-w-0">
                  <span className={stage.status === 'pending' ? 'text-muted-foreground' : 'font-medium'}>{t.planner.progress.stageNames[stage.key] ?? stage.label}</span>
                  <span className="text-muted-foreground"> · {t.planner.progress.stage[stage.status]}</span>
                  {stage.summary ? <span className="block text-muted-foreground">{stage.summary}</span> : null}
                </span>
              </li>
            ))}
          </ol>
        </CardContent>
      ) : null}
      <CardFooter>
        <Button variant="outline" onClick={() => void handleCancel()} disabled={cancelling}>
          {cancelling ? t.planner.progress.cancelling : t.common.cancel}
        </Button>
      </CardFooter>
    </Card>
  );
}
