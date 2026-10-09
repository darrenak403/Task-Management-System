'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { nameSchema } from '@/components/name-dialog';
import { TextField } from '@/components/text-field';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useT } from '@/i18n/locale-provider';
import { fieldErrors } from '@/lib/api-errors';
import { validate } from '@/lib/form';
import { notifyWriteError } from '@/lib/notify';
import { invalidationBus, topics } from '@/lib/realtime/invalidation-bus';

import { can } from './permissions';
import { useWorkspace } from './workspace-scope';
import { renameWorkspace } from './workspaces-api';

export function RenameWorkspaceForm() {
  const t = useT();
  const { workspace, role, workspaceId } = useWorkspace();
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);
  const editable = can('workspace.rename', role);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validate(nameSchema, { name: new FormData(event.currentTarget).get('name') });
    if (!result.ok) {
      setError(result.errors.name);
      return;
    }
    setError(undefined);
    if (result.data.name === workspace.name) return;
    setPending(true);
    try {
      await renameWorkspace(workspaceId, result.data.name);
      invalidationBus.publish(topics.structure);
      toast.success(t.workspaces.rename.renamed);
    } catch (cause) {
      const serverField = fieldErrors(cause).name;
      if (serverField) setError(serverField);
      else notifyWriteError(cause);
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      {/* Keyed by the saved name so a rename made elsewhere replaces the field value. */}
      <form key={workspace.name} onSubmit={handleSubmit} noValidate className="contents">
        <CardHeader>
          <CardTitle>{t.workspaces.rename.title}</CardTitle>
          <CardDescription>{t.workspaces.rename.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <TextField id="name" label={t.common.name} defaultValue={workspace.name} maxLength={100} error={error} disabled={!editable} className="max-w-md" />
        </CardContent>
        {editable ? (
          <CardFooter>
            <Button type="submit" disabled={pending}>
              {pending ? t.common.saving : t.common.save}
            </Button>
          </CardFooter>
        ) : null}
      </form>
    </Card>
  );
}
