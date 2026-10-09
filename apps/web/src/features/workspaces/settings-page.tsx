'use client';

import { ErrorState } from '@/components/error-state';
import { PageHeader } from '@/components/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TeamsTable } from '@/features/teams/teams-table';
import { useT } from '@/i18n/locale-provider';

import { MembersTable } from './members-table';
import { can } from './permissions';
import { RenameWorkspaceForm } from './rename-form';
import { useWorkspace } from './workspace-scope';

export function SettingsPage() {
  const t = useT();
  const { workspace, role } = useWorkspace();

  if (!can('members.view', role)) {
    return (
      <ErrorState
        title={t.workspaces.settings.restrictedTitle}
        message={t.workspaces.settings.restrictedMessage}
      />
    );
  }

  return (
    <>
      <PageHeader title={t.nav.settings} description={t.workspaces.settings.description(workspace.name)} />
      <Tabs defaultValue="general" className="gap-4">
        <TabsList>
          <TabsTrigger value="general">{t.workspaces.settings.general}</TabsTrigger>
          <TabsTrigger value="members">{t.workspaces.settings.members}</TabsTrigger>
          <TabsTrigger value="teams">{t.workspaces.settings.teams}</TabsTrigger>
        </TabsList>
        <TabsContent value="general">
          <RenameWorkspaceForm />
        </TabsContent>
        <TabsContent value="members">
          <MembersTable />
        </TabsContent>
        <TabsContent value="teams">
          <TeamsTable />
        </TabsContent>
      </Tabs>
    </>
  );
}
