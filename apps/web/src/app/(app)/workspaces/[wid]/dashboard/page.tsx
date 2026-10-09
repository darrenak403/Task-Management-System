import { DashboardPage } from '@/features/dashboard/dashboard-page';
import { titleMetadata } from '@/i18n/server';

export const generateMetadata = titleMetadata((m) => m.nav.dashboard);

export default function Page() {
  return <DashboardPage />;
}
