import { Suspense } from 'react';

import { MyTasksPage } from '@/features/tasks/my-tasks-page';
import { titleMetadata } from '@/i18n/server';

export const generateMetadata = titleMetadata((m) => m.nav.myTasks);

export default function Page() {
  return (
    <Suspense>
      <MyTasksPage />
    </Suspense>
  );
}
