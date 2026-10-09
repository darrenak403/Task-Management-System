'use client';

import {
  KeyRoundIcon,
  LayoutDashboardIcon,
  ListTodoIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SettingsIcon,
  SparklesIcon,
  SquareKanbanIcon,
  UserPlusIcon,
  UsersIcon,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

import { NavUser } from '@/components/nav-user';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';
import { TeamDialog } from '@/features/teams/team-dialog';
import { TeamMembersSheet } from '@/features/teams/team-members-sheet';
import { AddMemberDialog } from '@/features/workspaces/add-member-dialog';
import { can } from '@/features/workspaces/permissions';
import { useWorkspaceScope } from '@/features/workspaces/workspace-scope';
import { WorkspaceSwitcher } from '@/features/workspaces/workspace-switcher';
import { useT } from '@/i18n/locale-provider';
import type { Team } from '@/lib/dto';
import { toRouteId } from '@/lib/route-id';

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const t = useT();
  // Links carry short ids; an address opened with plain UUIDs is brought to the same form so the current item still lights up.
  const pathname = usePathname().split('/').map(toRouteId).join('/');
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();
  const { workspaceId, role, teams, workspace } = useWorkspaceScope();
  const base = workspaceId ? `/workspaces/${toRouteId(workspaceId)}` : null;
  // Navigating from the mobile sheet closes it, so the page is visible right away.
  const closeMobile = () => setOpenMobile(false);
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  // `undefined` = closed, `null` = creating, a team = renaming it.
  const [editingTeam, setEditingTeam] = useState<Team | null | undefined>(undefined);
  const [rosterOf, setRosterOf] = useState<Team | null>(null);
  const [inviting, setInviting] = useState(false);
  const canManageTeam = can('team.manageMembers', role) || can('team.rename', role);

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 pt-1 text-lg font-bold tracking-tight group-data-[collapsible=icon]:px-0">
          <Image src="/aim-logo.png" alt="" width={32} height={32} className="size-8 shrink-0 dark:invert" />
          <span className="group-data-[collapsible=icon]:hidden">AIM</span>
        </div>
        <WorkspaceSwitcher />
      </SidebarHeader>
      <SidebarContent>
        {base && workspace.data ? (
          <>
            <SidebarGroup>
              <SidebarGroupLabel>{t.nav.workspace}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <NavItem href={`${base}/dashboard`} label={t.nav.dashboard} icon={<LayoutDashboardIcon />} active={isActive(`${base}/dashboard`)} onNavigate={closeMobile} />
                  <NavItem href={`${base}/my-tasks`} label={t.nav.myTasks} icon={<ListTodoIcon />} active={isActive(`${base}/my-tasks`)} onNavigate={closeMobile} />
                  {can('members.add', role) ? (
                    <SidebarMenuItem>
                      <SidebarMenuButton tooltip={t.nav.invitePeople} onClick={() => setInviting(true)}>
                        <UserPlusIcon aria-hidden="true" />
                        <span>{t.nav.invitePeople}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ) : null}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarGroup>
              <SidebarGroupLabel>{t.nav.teams}</SidebarGroupLabel>
              {can('team.create', role) ? (
                <SidebarGroupAction title={t.nav.createTeam} onClick={() => setEditingTeam(null)}>
                  <PlusIcon aria-hidden="true" />
                  <span className="sr-only">{t.nav.createTeam}</span>
                </SidebarGroupAction>
              ) : null}
              <SidebarGroupContent>
                <SidebarMenu>
                  {teams.loading ? (
                    <>
                      <SidebarMenuSkeleton showIcon />
                      <SidebarMenuSkeleton showIcon />
                    </>
                  ) : null}
                  {teams.error && teams.items.length === 0 ? (
                    <SidebarMenuItem>
                      <SidebarMenuButton onClick={() => void teams.reload()}>{t.nav.teamsLoadFailed}</SidebarMenuButton>
                    </SidebarMenuItem>
                  ) : null}
                  {!teams.loading && !teams.error && teams.items.length === 0 ? (
                    can('team.create', role) ? (
                      <SidebarMenuItem>
                        <SidebarMenuButton tooltip={t.nav.createFirstTeam} onClick={() => setEditingTeam(null)}>
                          <PlusIcon aria-hidden="true" />
                          <span>{t.nav.createFirstTeam}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ) : (
                      <li className="px-2 py-1.5 text-xs text-sidebar-foreground/70 group-data-[collapsible=icon]:hidden">{t.nav.noTeams}</li>
                    )
                  ) : null}
                  {teams.items.map((team) => {
                    const teamBase = `${base}/teams/${toRouteId(team.id)}`;
                    return (
                      <SidebarMenuItem key={team.id}>
                        <SidebarMenuButton asChild tooltip={team.name} isActive={isActive(teamBase)}>
                          <Link href={`${teamBase}/tasks`} onClick={closeMobile}>
                            <UsersIcon aria-hidden="true" />
                            <span>{team.name}</span>
                          </Link>
                        </SidebarMenuButton>
                        {canManageTeam ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <SidebarMenuAction>
                                <MoreHorizontalIcon aria-hidden="true" />
                                <span className="sr-only">{t.nav.manageTeam(team.name)}</span>
                              </SidebarMenuAction>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent side={isMobile ? 'bottom' : 'right'} align="start" className="min-w-40">
                              {can('team.manageMembers', role) ? (
                                <DropdownMenuItem onSelect={() => setRosterOf(team)}>
                                  <UsersIcon aria-hidden="true" /> {t.nav.members}
                                </DropdownMenuItem>
                              ) : null}
                              {can('team.rename', role) ? (
                                <DropdownMenuItem onSelect={() => setEditingTeam(team)}>
                                  <PencilIcon aria-hidden="true" /> {t.nav.rename}
                                </DropdownMenuItem>
                              ) : null}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : null}
                        <SidebarMenuSub>
                          <SidebarMenuSubItem>
                            <SidebarMenuSubButton asChild isActive={isActive(`${teamBase}/tasks`)}>
                              <Link href={`${teamBase}/tasks`} onClick={closeMobile}>
                                <SquareKanbanIcon aria-hidden="true" />
                                <span>{t.nav.tasks}</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                          <SidebarMenuSubItem>
                            <SidebarMenuSubButton asChild isActive={isActive(`${teamBase}/ai-planner`)}>
                              <Link href={`${teamBase}/ai-planner`} onClick={closeMobile}>
                                <SparklesIcon aria-hidden="true" />
                                <span>{t.nav.aiPlanner}</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        </SidebarMenuSub>
                      </SidebarMenuItem>
                    );
                  })}
                  {teams.hasMore ? (
                    <SidebarMenuItem>
                      <SidebarMenuButton onClick={teams.loadMore} disabled={teams.loadingMore}>
                        {teams.loadingMore ? t.common.loading : t.nav.loadMoreTeams}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ) : null}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarGroup className="mt-auto">
              <SidebarGroupContent>
                <SidebarMenu>
                  <NavItem href={`${base}/ai-settings`} label={t.nav.aiSettings} icon={<KeyRoundIcon />} active={isActive(`${base}/ai-settings`)} onNavigate={closeMobile} />
                  {can('members.view', role) ? (
                    <NavItem href={`${base}/settings`} label={t.nav.settings} icon={<SettingsIcon />} active={isActive(`${base}/settings`)} onNavigate={closeMobile} />
                  ) : null}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        ) : null}
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
      {workspaceId ? (
        <>
          <TeamDialog
            workspaceId={workspaceId}
            team={editingTeam ?? null}
            open={editingTeam !== undefined}
            onOpenChange={(open) => (open ? undefined : setEditingTeam(undefined))}
            onCreated={(team) => {
              closeMobile();
              router.push(`/workspaces/${toRouteId(workspaceId)}/teams/${toRouteId(team.id)}/tasks`);
            }}
          />
          <TeamMembersSheet workspaceId={workspaceId} team={rosterOf} onClose={() => setRosterOf(null)} />
          <AddMemberDialog workspaceId={workspaceId} open={inviting} onOpenChange={setInviting} />
        </>
      ) : null}
    </Sidebar>
  );
}

function NavItem({
  href,
  label,
  icon,
  active,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onNavigate: () => void;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild tooltip={label} isActive={active}>
        <Link href={href} onClick={onNavigate} aria-current={active ? 'page' : undefined}>
          {icon}
          <span>{label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
