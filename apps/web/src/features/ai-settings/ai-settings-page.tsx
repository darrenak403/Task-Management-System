'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { ConfirmDialog } from '@/components/confirm-dialog';
import { ErrorState } from '@/components/error-state';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useCurrentUser } from '@/features/auth/auth-provider';
import { plannerProblem } from '@/features/ai-planner/planner-errors';
import { formatDateTime } from '@/i18n/format';
import { useT } from '@/i18n/locale-provider';
import { errorMessage } from '@/lib/api-errors';
import type { GeminiCredential } from '@/lib/dto';
import { validate } from '@/lib/form';
import { useResource } from '@/lib/use-resource';

import { GeminiKeyForm, modelSchema } from './gemini-key-form';
import { GeminiModelField } from './gemini-model-field';
import { GEMINI_PRICING_URL } from './gemini-models';
import { deleteGeminiCredential, getGeminiCredential, testGeminiCredential, updateGeminiModel } from './gemini-settings-api';

const GEMINI_KEY_URL = 'https://aistudio.google.com/apikey';

export function AiSettingsPage() {
  const t = useT();
  const user = useCurrentUser();
  const credential = useResource(`gemini-credential:${user.id}`, getGeminiCredential);
  const reload = () => void credential.reload();

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <PageHeader title={t.nav.aiSettings} description={t.aiSettings.description} />
      {credential.data ? (
        <Card>
          {credential.data.configured ? <Connected credential={credential.data} onChanged={reload} /> : <Disconnected credential={credential.data} onChanged={reload} />}
          <CardFooter className="block text-xs text-muted-foreground">
            {t.aiSettings.billingNote}{' '}
            <a href={GEMINI_PRICING_URL} target="_blank" rel="noreferrer" className="underline underline-offset-4">
              {t.aiSettings.pricing}
            </a>
          </CardFooter>
        </Card>
      ) : credential.error ? (
        <ErrorState message={errorMessage(credential.error)} onRetry={reload} />
      ) : (
        <Skeleton className="h-64 w-full" aria-label={t.aiSettings.loading} />
      )}
    </div>
  );
}

function Disconnected({ credential, onChanged }: { credential: GeminiCredential; onChanged: () => void }) {
  const t = useT();
  return (
    <>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {t.aiSettings.connectTitle}
          <Badge variant="outline">{t.aiSettings.notConnected}</Badge>
        </CardTitle>
        <CardDescription>
          {t.aiSettings.connectBefore}{' '}
          <a href={GEMINI_KEY_URL} target="_blank" rel="noreferrer" className="underline underline-offset-4">
            Google AI Studio
          </a>{' '}
          {t.aiSettings.connectAfter}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <GeminiKeyForm credential={credential} onSaved={onChanged} />
      </CardContent>
    </>
  );
}

function Connected({ credential, onChanged }: { credential: GeminiCredential; onChanged: () => void }) {
  const t = useT();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [model, setModel] = useState(credential.model ?? '');
  const [modelError, setModelError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const busy = saving || testing;

  async function handleModelSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validate(modelSchema, new FormData(event.currentTarget).get('currentModel'));
    if (!result.ok) {
      setModelError(Object.values(result.errors)[0]);
      return;
    }
    setModelError(undefined);
    if (result.data === credential.model) return;
    setSaving(true);
    try {
      await updateGeminiModel(result.data);
      toast.success(t.aiSettings.modelUpdated);
    } catch (error) {
      setModelError(plannerProblem(error).message);
    } finally {
      setSaving(false);
      onChanged();
    }
  }

  async function handleTest() {
    setTesting(true);
    try {
      // A model picked but not saved yet is saved first, so the test covers the model shown in the field.
      if (model && model !== credential.model) await updateGeminiModel(model);
      const tested = await testGeminiCredential();
      toast.success(t.aiSettings.connectedWith(tested.model));
    } catch (error) {
      toast.error(plannerProblem(error).message);
    } finally {
      setTesting(false);
      onChanged();
    }
  }

  async function handleDelete() {
    try {
      await deleteGeminiCredential();
      toast.success(t.aiSettings.keyRemoved);
    } catch (error) {
      toast.error(plannerProblem(error).message);
    } finally {
      onChanged();
    }
  }

  return (
    <>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Gemini
          <Badge>{t.aiSettings.connected}</Badge>
        </CardTitle>
        <CardDescription>{t.aiSettings.lastChecked(credential.verifiedAt ? formatDateTime(credential.verifiedAt) : null)}</CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" onClick={handleTest} disabled={busy}>
            {testing ? t.aiSettings.testing : t.aiSettings.test}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {/* Keyed by the saved model so a change made elsewhere replaces the field value. */}
        <form key={credential.model} onSubmit={handleModelSubmit} noValidate className="flex flex-col items-start gap-3">
          <div className="w-full">
            <GeminiModelField id="currentModel" defaultValue={credential.model ?? ''} error={modelError} disabled={busy} onValueChange={setModel} />
          </div>
          {/* The button appears only when there is something to save. */}
          {model !== (credential.model ?? '') ? (
            <Button type="submit" size="sm" disabled={busy}>
              {saving ? t.common.saving : t.aiSettings.saveModel}
            </Button>
          ) : null}
        </form>

        <Separator />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">{t.aiSettings.apiKey}</p>
            <p className="text-sm text-muted-foreground">{t.aiSettings.keyStored}</p>
          </div>
          {replacing ? null : (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setReplacing(true)} disabled={busy}>
                {t.aiSettings.replace}
              </Button>
              <Button variant="destructive" size="sm" onClick={() => setConfirmDelete(true)} disabled={busy}>
                {t.common.remove}
              </Button>
            </div>
          )}
        </div>
        {replacing ? (
          <GeminiKeyForm
            credential={credential}
            onSaved={() => {
              setReplacing(false);
              onChanged();
            }}
            onCancel={() => setReplacing(false)}
          />
        ) : null}

        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={t.aiSettings.removeTitle}
          description={t.aiSettings.removeDescription}
          confirmLabel={t.aiSettings.removeConfirm}
          onConfirm={handleDelete}
        />
      </CardContent>
    </>
  );
}
