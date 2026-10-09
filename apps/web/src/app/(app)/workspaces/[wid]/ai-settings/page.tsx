import { AiSettingsPage } from '@/features/ai-settings/ai-settings-page';
import { titleMetadata } from '@/i18n/server';

export const generateMetadata = titleMetadata((m) => m.nav.aiSettings);

export default function Page() {
  return <AiSettingsPage />;
}
