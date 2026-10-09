'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';

import { TextField } from '@/components/text-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { plannerProblem } from '@/features/ai-planner/planner-errors';
import { useT } from '@/i18n/locale-provider';
import { msg } from '@/i18n/messages';
import { fieldErrors, isOutcomeUnknown } from '@/lib/api-errors';
import type { GeminiCredential } from '@/lib/dto';
import { validate, type FieldErrors } from '@/lib/form';

import { GeminiModelField } from './gemini-model-field';
import { DEFAULT_GEMINI_MODEL } from './gemini-models';
import { saveGeminiCredential } from './gemini-settings-api';

export const modelSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/, msg((m) => m.aiSettings.keyForm.modelInvalid));

const schema = z.object({
  key: z
    .string()
    .min(20, msg((m) => m.aiSettings.keyForm.keyTooShort))
    .max(512, msg((m) => m.aiSettings.keyForm.keyTooLong))
    .regex(/^\S+$/, msg((m) => m.aiSettings.keyForm.keyHasSpaces)),
  model: modelSchema,
});

/**
 * Sends a Gemini key to the server. The key lives only in the password input: it is read once on
 * submit, the input is cleared before the request starts, and it is never put in state or storage.
 */
export function GeminiKeyForm({
  credential,
  onSaved,
  onCancel,
}: {
  credential: GeminiCredential;
  onSaved: () => void;
  /** Shown as a Cancel button when given, for the form that replaces an existing key. */
  onCancel?: () => void;
}) {
  const t = useT();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const result = validate(schema, { key: data.get('key'), model: data.get('model') });
    setFormError(null);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    const keyInput = form.elements.namedItem('key');
    if (keyInput instanceof HTMLInputElement) keyInput.value = '';

    setPending(true);
    try {
      await saveGeminiCredential(result.data);
      toast.success(t.aiSettings.keyForm.saved);
      onSaved();
    } catch (error) {
      onSaved();
      const serverFields = fieldErrors(error);
      if (Object.keys(serverFields).length > 0) setErrors(serverFields);
      else if (isOutcomeUnknown(error)) setFormError(t.aiSettings.keyForm.outcomeUnknown);
      else setFormError(plannerProblem(error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate autoComplete="off" className="grid gap-4">
      {formError ? (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      ) : null}
      <TextField
        id="key"
        label={credential.configured ? t.aiSettings.keyForm.newKey : t.aiSettings.apiKey}
        type="password"
        autoComplete="new-password"
        data-1p-ignore
        data-lpignore="true"
        spellCheck={false}
        maxLength={512}
        error={errors.key}
        description={t.aiSettings.keyForm.keyHint}
        disabled={pending}
      />
      {credential.model ? (
        // A replacement key keeps the model already in use; it is changed separately.
        <input type="hidden" name="model" value={credential.model} />
      ) : (
        <GeminiModelField id="model" defaultValue={DEFAULT_GEMINI_MODEL} error={errors.model} disabled={pending} />
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? t.aiSettings.keyForm.verifying : credential.configured ? t.aiSettings.keyForm.saveNew : t.aiSettings.keyForm.connect}
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
            {t.common.cancel}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
