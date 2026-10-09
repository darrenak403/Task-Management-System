import { PlanPage } from '@/features/ai-planner/plan-page';
import { titleMetadata } from '@/i18n/server';

export const generateMetadata = titleMetadata((m) => m.nav.aiPlan);

export default function Page() {
  return <PlanPage />;
}
