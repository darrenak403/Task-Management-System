'use client';

import { useRouter } from 'next/navigation';

import { NameDialog } from '@/components/name-dialog';
import { useT } from '@/i18n/locale-provider';
import { invalidationBus, topics } from '@/lib/realtime/invalidation-bus';
import { toRouteId } from '@/lib/route-id';

import { createWorkspace } from './workspaces-api';

export function CreateWorkspaceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT();
  const router = useRouter();
  return (
    <NameDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t.workspaces.create.title}
      description={t.workspaces.create.description}
      submitLabel={t.workspaces.create.title}
      onSubmit={async (name) => {
        const workspace = await createWorkspace(name);
        invalidationBus.publish(topics.structure);
        router.push(`/workspaces/${toRouteId(workspace.id)}/dashboard`);
      }}
    />
  );
}
