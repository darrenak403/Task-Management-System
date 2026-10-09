import { PlannerHomePage } from '@/features/ai-planner/planner-home-page';
import { titleMetadata } from '@/i18n/server';

export const generateMetadata = titleMetadata((m) => m.nav.aiPlanner);

export default function Page() {
  return <PlannerHomePage />;
}
