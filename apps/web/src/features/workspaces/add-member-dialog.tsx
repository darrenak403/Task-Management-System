'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';

import { TextField } from '@/components/text-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useT } from '@/i18n/locale-provider';
import { msg, type Messages } from '@/i18n/messages';
import { errorMessage, fieldErrors, isApiError } from '@/lib/api-errors';
import { validate } from '@/lib/form';
import { displayNameOf } from '@/lib/people';
import { invalidationBus, topics } from '@/lib/realtime/invalidation-bus';
import { useResource } from '@/lib/use-resource';

import { addWorkspaceMember, listMemberCandidates } from './workspaces-api';

const SEARCH_DEBOUNCE_MS = 250;

const schema = z.object({
  email: z.string().trim().min(1, msg((m) => m.common.emailRequired)).pipe(z.email(msg((m) => m.common.emailInvalid))),
});

/** Business errors that belong next to the email field rather than in a generic banner. */
const EMAIL_ERRORS: Record<string, (m: Messages) => string> = {
  USER_NOT_FOUND: (m) => m.workspaces.addMember.userNotFound,
  MEMBER_ALREADY_EXISTS: (m) => m.workspaces.addMember.alreadyMember,
};

export function AddMemberDialog({
  workspaceId,
  open,
  onOpenChange,
}: {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [email, setEmail] = useState('');
  const [search, setSearch] = useState('');

  // The list follows what is typed, a moment later, so each keystroke does not start a request.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(email.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [email]);

  const candidates = useResource(open ? `member-candidates:${workspaceId}:${search}` : null, (signal) => listMemberCandidates(workspaceId, search, signal), {
    topics: [topics.members],
  });

  function handleOpenChange(next: boolean) {
    if (pending) return;
    if (!next) {
      setFieldError(undefined);
      setFormError(null);
      setEmail('');
    }
    onOpenChange(next);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validate(schema, { email });
    setFormError(null);
    if (!result.ok) {
      setFieldError(result.errors.email);
      return;
    }
    void add(result.data.email);
  }

  async function add(address: string) {
    setFieldError(undefined);
    setFormError(null);
    setPending(true);
    try {
      const member = await addWorkspaceMember(workspaceId, address);
      invalidationBus.publish(topics.members);
      toast.success(t.workspaces.addMember.added(member.email));
      setPending(false);
      setEmail('');
      onOpenChange(false);
    } catch (error) {
      setPending(false);
      const known = isApiError(error) ? EMAIL_ERRORS[error.code]?.(t) : undefined;
      const serverField = known ?? fieldErrors(error).email;
      if (serverField) setFieldError(serverField);
      else setFormError(errorMessage(error));
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t.workspaces.addMember.title}</DialogTitle>
            <DialogDescription>
              {t.workspaces.addMember.description}
            </DialogDescription>
          </DialogHeader>
          {formError ? (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}
          <TextField
            id="email"
            label={t.workspaces.addMember.field}
            autoComplete="off"
            autoFocus
            placeholder={t.workspaces.addMember.placeholder}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            error={fieldError}
          />
          <div className="flex flex-col gap-1" aria-busy={candidates.loading}>
            <p className="text-xs font-medium text-muted-foreground">{t.workspaces.addMember.candidates}</p>
            {candidates.data && candidates.data.length > 0 ? (
              <ul className="max-h-56 overflow-y-auto rounded-lg border">
                {candidates.data.map((person) => (
                  <li key={person.id} className="border-b last:border-b-0">
                    <button
                      type="button"
                      className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:opacity-50"
                      disabled={pending}
                      onClick={() => void add(person.email)}
                    >
                      <span className="font-medium">{displayNameOf(person)}</span>
                      {person.displayName ? <span className="text-xs text-muted-foreground">{person.email}</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                {candidates.error
                  ? t.workspaces.addMember.loadFailed
                  : candidates.data
                    ? search
                      ? t.workspaces.addMember.noMatch
                      : t.workspaces.addMember.everyoneAdded
                    : t.common.loading}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={pending}>
              {t.common.cancel}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? t.workspaces.addMember.adding : t.workspaces.addMember.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
