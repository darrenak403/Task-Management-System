import { TeamGate } from '@/features/teams/team-gate';

export default function TeamLayout({ children }: { children: React.ReactNode }) {
  return <TeamGate>{children}</TeamGate>;
}
