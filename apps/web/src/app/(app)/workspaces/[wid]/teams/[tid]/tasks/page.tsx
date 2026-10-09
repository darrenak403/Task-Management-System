import { Suspense } from 'react';

import { TeamTasksPage } from '@/features/tasks/team-tasks-page';
import { titleMetadata } from '@/i18n/server';

export const generateMetadata = titleMetadata((m) => m.nav.tasks);

export default function Page() {
  // Filters live in the URL; reading search params on the client requires a Suspense boundary.
  return (
    <Suspense>
      <TeamTasksPage />
    </Suspense>
  );
}
