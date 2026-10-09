import { WorkspacesPage } from '@/features/workspaces/workspaces-page';
import { titleMetadata } from '@/i18n/server';

export const generateMetadata = titleMetadata((m) => m.nav.workspaces);

export default function Page() {
  return <WorkspacesPage />;
}
