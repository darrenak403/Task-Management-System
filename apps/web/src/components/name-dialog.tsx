'use client';

import { useState } from 'react';
import { z } from 'zod';

import { TextField } from '@/components/text-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useT } from '@/i18n/locale-provider';
import { msg } from '@/i18n/messages';
import { errorMessage, fieldErrors } from '@/lib/api-errors';
import { validate } from '@/lib/form';

/** Workspace and team names share one rule: trimmed, 1–100 characters. */
export const nameSchema = z.object({
  name: z.string().trim().min(1, msg((m) => m.common.nameRequired)).max(100, msg((m) => m.common.nameTooLong)),
});

/** Single-field create/rename dialog used for workspaces and teams. */
export function NameDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  initialName = '',
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  submitLabel: string;
  initialName?: string;
  /** Performs the write; the dialog closes when it resolves and shows the error when it rejects. */
  onSubmit: (name: string) => Promise<void>;
}) {
  const t = useT();
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function handleOpenChange(next: boolean) {
    if (pending) return;
    if (!next) {
      setFieldError(undefined);
      setFormError(null);
    }
    onOpenChange(next);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validate(nameSchema, { name: new FormData(event.currentTarget).get('name') });
    setFormError(null);
    if (!result.ok) {
      setFieldError(result.errors.name);
      return;
    }
    setFieldError(undefined);
    setPending(true);
    try {
      await onSubmit(result.data.name);
      setPending(false);
      onOpenChange(false);
    } catch (error) {
      setPending(false);
      const serverField = fieldErrors(error).name;
      if (serverField) setFieldError(serverField);
      else setFormError(errorMessage(error));
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {formError ? (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}
          <TextField id="name" label={t.common.name} defaultValue={initialName} maxLength={100} autoFocus error={fieldError} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={pending}>
              {t.common.cancel}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? t.common.saving : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
