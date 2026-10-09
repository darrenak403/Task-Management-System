'use client';

import { SparklesIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { z } from 'zod';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { DeadlinePicker } from '@/features/tasks/deadline-picker';
import { useT } from '@/i18n/locale-provider';
import { msg } from '@/i18n/messages';
import { fieldErrors, isOutcomeUnknown } from '@/lib/api-errors';
import { validate, type FieldErrors } from '@/lib/form';
import { invalidationBus, topics } from '@/lib/realtime/invalidation-bus';
import { toRouteId } from '@/lib/route-id';
import { cn } from '@/lib/utils';

import { findJobByRequestKey } from './ai-jobs-api';
import { createPlan, newRequestKey, type CreatePlanInput } from './ai-plans-api';
import { plannerProblem, type PlannerProblem } from './planner-errors';

const schema = z.object({
  goal: z.string().trim().min(20, msg((m) => m.planner.goal.goalTooShort)).max(4000, msg((m) => m.planner.goal.goalTooLong)),
  constraints: z.string().trim().max(4000, msg((m) => m.planner.goal.constraintsTooLong)),
});

type DetailLevel = NonNullable<CreatePlanInput['detailLevel']>;
type Strategy = NonNullable<CreatePlanInput['strategy']>;

const CONSENTS = ['providerDisclosureAccepted', 'billingAuthorityConfirmed', 'selectedContextReviewed'] as const;

type ConsentId = (typeof CONSENTS)[number];

/** Starts a plan from a goal. Nothing is created on the board until the draft is confirmed. */
export function GoalForm({ workspaceId, teamId, disabled }: { workspaceId: string; teamId: string; disabled: boolean }) {
  const t = useT();
  const router = useRouter();
  const [detailLevel, setDetailLevel] = useState<DetailLevel>('BALANCED');
  const [strategy, setStrategy] = useState<Strategy>('BALANCED');
  const [startDate, setStartDate] = useState<string | null>(null);
  const [targetDate, setTargetDate] = useState<string | null>(null);
  const [includeExistingTasks, setIncludeExistingTasks] = useState(false);
  const [includeMembers, setIncludeMembers] = useState(false);
  const [consents, setConsents] = useState<Record<ConsentId, boolean>>({
    providerDisclosureAccepted: false,
    billingAuthorityConfirmed: false,
    selectedContextReviewed: false,
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [problem, setProblem] = useState<PlannerProblem | null>(null);
  const [pending, setPending] = useState(false);
  // Sending the same request again reuses its key, so the server answers with the job it already started.
  const lastRequest = useRef<{ key: string; body: string } | null>(null);

  const planPath = (planId: string) => `/workspaces/${toRouteId(workspaceId)}/teams/${toRouteId(teamId)}/ai-planner/${toRouteId(planId)}`;
  const allConsented = CONSENTS.every((consent) => consents[consent]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = validate(schema, { goal: form.get('goal') ?? '', constraints: form.get('constraints') ?? '' });
    setProblem(null);
    if (!allConsented) return;
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    if (startDate && targetDate && startDate > targetDate) {
      setErrors({ targetDate: t.planner.goal.dateOrder });
      return;
    }
    setErrors({});

    const body: Omit<CreatePlanInput, 'requestKey'> = {
      goal: result.data.goal,
      ...(result.data.constraints ? { constraints: result.data.constraints } : {}),
      detailLevel,
      strategy,
      startDate,
      targetDate,
      includeExistingTasks,
      includeMembers,
      // Only reached with every box ticked; the API accepts nothing but `true` here.
      consent: { providerDisclosureAccepted: true, billingAuthorityConfirmed: true, selectedContextReviewed: true },
    };
    const serialized = JSON.stringify(body);
    if (lastRequest.current?.body !== serialized) lastRequest.current = { key: newRequestKey(), body: serialized };
    const requestKey = lastRequest.current.key;

    setPending(true);
    try {
      const job = await createPlan(workspaceId, teamId, { ...body, requestKey });
      invalidationBus.publish(topics.planner(teamId));
      router.push(planPath(job.planId));
    } catch (error) {
      if (isOutcomeUnknown(error)) {
        // The request may have been accepted; look the job up before asking the user to send it again.
        const found = await findJobByRequestKey(workspaceId, teamId, requestKey).catch(() => null);
        if (found) {
          router.push(planPath(found.planId));
          return;
        }
      }
      setPending(false);
      const serverFields = fieldErrors(error);
      if (Object.keys(serverFields).length > 0) setErrors(serverFields);
      else setProblem(plannerProblem(error));
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="grid gap-5">
      {problem ? (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            {problem.message}
            {problem.next === 'open-ai-settings' ? (
              <Button asChild variant="outline" size="sm">
                <Link href={`/workspaces/${toRouteId(workspaceId)}/ai-settings`}>{t.planner.openAiSettings}</Link>
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <Field data-invalid={errors.goal ? true : undefined}>
        <FieldLabel htmlFor="goal">{t.planner.goal.goal}</FieldLabel>
        <Textarea
          id="goal"
          name="goal"
          rows={4}
          maxLength={4000}
          placeholder={t.planner.goal.goalPlaceholder}
          aria-invalid={errors.goal ? true : undefined}
          aria-describedby={errors.goal ? 'goal-error' : 'goal-hint'}
          disabled={disabled || pending}
        />
        {errors.goal ? <FieldError id="goal-error">{errors.goal}</FieldError> : <FieldDescription id="goal-hint">{t.planner.goal.goalHint}</FieldDescription>}
      </Field>

      <Field data-invalid={errors.constraints ? true : undefined}>
        <FieldLabel htmlFor="constraints">{t.planner.goal.constraints}</FieldLabel>
        <Textarea
          id="constraints"
          name="constraints"
          rows={2}
          maxLength={4000}
          placeholder={t.planner.goal.constraintsPlaceholder}
          aria-invalid={errors.constraints ? true : undefined}
          aria-describedby={errors.constraints ? 'constraints-error' : undefined}
          disabled={disabled || pending}
        />
        {errors.constraints ? <FieldError id="constraints-error">{errors.constraints}</FieldError> : null}
      </Field>

      <Section title={t.planner.goal.options} disabled={disabled || pending}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Segmented id="detailLevel" label={t.planner.goal.detailLevel} value={detailLevel} options={t.planner.goal.detail} onChange={setDetailLevel} />
          <Segmented id="strategy" label={t.planner.goal.strategyLabel} value={strategy} options={t.planner.goal.strategy} onChange={setStrategy} />
          <Field>
            <FieldLabel htmlFor="startDate">{t.planner.goal.startDate}</FieldLabel>
            <DeadlinePicker id="startDate" value={startDate} onChange={setStartDate} disabled={disabled || pending} emptyLabel={t.planner.notSet} />
          </Field>
          <Field data-invalid={errors.targetDate ? true : undefined}>
            <FieldLabel htmlFor="targetDate">{t.planner.goal.targetDate}</FieldLabel>
            <DeadlinePicker
              id="targetDate"
              value={targetDate}
              onChange={setTargetDate}
              disabled={disabled || pending}
              emptyLabel={t.planner.notSet}
              {...(errors.targetDate ? { describedBy: 'targetDate-error' } : {})}
            />
            {errors.targetDate ? <FieldError id="targetDate-error">{errors.targetDate}</FieldError> : null}
          </Field>
        </div>
      </Section>

      <Section title={t.planner.goal.context} disabled={disabled || pending}>
        <CheckRow id="includeExistingTasks" checked={includeExistingTasks} onChange={setIncludeExistingTasks} label={t.planner.goal.includeTasks} />
        <CheckRow id="includeMembers" checked={includeMembers} onChange={setIncludeMembers} label={t.planner.goal.includeMembers} />
        <FieldDescription>{t.planner.goal.contextHint}</FieldDescription>
      </Section>

      <Section
        title={t.planner.goal.before}
        disabled={disabled || pending}
        action={
          allConsented ? null : (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0"
              onClick={() => setConsents({ providerDisclosureAccepted: true, billingAuthorityConfirmed: true, selectedContextReviewed: true })}
            >
              {t.planner.goal.agreeAll}
            </Button>
          )
        }
      >
        {CONSENTS.map((consent) => (
          <CheckRow
            key={consent}
            id={consent}
            checked={consents[consent]}
            onChange={(checked) => setConsents((previous) => ({ ...previous, [consent]: checked }))}
            label={t.planner.goal.consents[consent]}
          />
        ))}
      </Section>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" disabled={disabled || pending || !allConsented}>
          <SparklesIcon aria-hidden="true" />
          {pending ? t.planner.goal.starting : t.planner.goal.generate}
        </Button>
        {!disabled && !allConsented ? <p className="text-sm text-muted-foreground">{t.planner.goal.consentHint}</p> : null}
      </div>
    </form>
  );
}

/** A titled group of related controls, set apart from the free-text fields above it. */
function Section({ title, action, disabled, children }: { title: string; action?: React.ReactNode; disabled: boolean; children: React.ReactNode }) {
  return (
    <fieldset className="grid gap-3 rounded-lg border bg-muted/30 p-4" disabled={disabled}>
      <legend className="sr-only">{title}</legend>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold" aria-hidden="true">
          {title}
        </span>
        {action}
      </div>
      {children}
    </fieldset>
  );
}

/** One-click choice between a few options that are all worth seeing at once. */
function Segmented<T extends string>({ id, label, value, options, onChange }: { id: string; label: string; value: T; options: Record<T, string>; onChange: (value: T) => void }) {
  return (
    <div className="grid gap-2">
      <span id={`${id}-label`} className="text-sm font-medium">
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={`${id}-label`} className="grid auto-cols-fr grid-flow-col gap-1 rounded-lg border bg-background p-1">
        {(Object.keys(options) as T[]).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={option === value}
            onClick={() => onChange(option)}
            className={cn(
              'rounded-md px-2 py-1.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
              option === value ? 'bg-primary font-medium text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {options[option]}
          </button>
        ))}
      </div>
    </div>
  );
}

function CheckRow({ id, checked, onChange, label }: { id: string; checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <div className="flex items-start gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={(value) => onChange(value === true)} className="mt-0.5" />
      <Label htmlFor={id} className="font-normal leading-snug">
        {label}
      </Label>
    </div>
  );
}
