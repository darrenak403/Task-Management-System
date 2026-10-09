'use client';

import { useRef, useState } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { useT } from '@/i18n/locale-provider';
import { isApiError } from '@/lib/api-errors';
import type { AiJob } from '@/lib/dto';
import { invalidationBus, topics } from '@/lib/realtime/invalidation-bus';

import { cancelJob, clarifyJob } from './ai-jobs-api';
import { newRequestKey } from './ai-plans-api';
import { plannerProblem } from './planner-errors';

/** Answers the questions a request asked before it can continue, or lets it proceed on its own assumptions. */
export function ClarifyForm({ workspaceId, teamId, job }: { workspaceId: string; teamId: string; job: AiJob }) {
  const t = useT();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per kind of reply, so sending the same reply twice is recognised by the server.
  const keys = useRef({ answers: newRequestKey(), assume: newRequestKey() });

  async function send(run: () => Promise<unknown>) {
    setPending(true);
    setError(null);
    try {
      await run();
    } catch (cause) {
      // A reply whose response was lost has already resumed the request; a different second reply changes nothing.
      if (isApiError(cause) && cause.code === 'IDEMPOTENCY_CONFLICT') return;
      setError(plannerProblem(cause).message);
    } finally {
      setPending(false);
      invalidationBus.publish(topics.planner(teamId));
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const answers = job.clarificationQuestions.map((_, index) => String(form.get(`answer-${index}`) ?? '').trim());
    if (answers.some((answer) => answer === '')) {
      setError(t.planner.clarify.incomplete);
      return;
    }
    void send(() => clarifyJob(workspaceId, teamId, job.id, { requestKey: keys.current.answers, answers }));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.planner.clarify.title}</CardTitle>
        <CardDescription>{t.planner.clarify.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} noValidate className="grid gap-4">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {job.clarificationQuestions.map((question, index) => (
            <Field key={question}>
              <FieldLabel htmlFor={`answer-${index}`}>{question}</FieldLabel>
              <Textarea id={`answer-${index}`} name={`answer-${index}`} rows={2} maxLength={1000} disabled={pending} />
            </Field>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? t.planner.clarify.sending : t.planner.clarify.send}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => void send(() => clarifyJob(workspaceId, teamId, job.id, { requestKey: keys.current.assume, allowAssumptions: true }))}
            >
              {t.planner.clarify.assume}
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={() => void send(() => cancelJob(workspaceId, teamId, job.id))}>
              {t.planner.clarify.cancel}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
