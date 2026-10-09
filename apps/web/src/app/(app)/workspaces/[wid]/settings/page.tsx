import { SettingsPage } from '@/features/workspaces/settings-page';
import { titleMetadata } from '@/i18n/server';

export const generateMetadata = titleMetadata((m) => m.nav.settings);

export default function Page() {
  return <SettingsPage />;
}
