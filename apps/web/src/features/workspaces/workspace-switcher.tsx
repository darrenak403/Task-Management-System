'use client';

import { BuildingIcon, ChevronsUpDownIcon, LayoutGridIcon, PlusIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/components/ui/sidebar';
import { useT } from '@/i18n/locale-provider';
import { toRouteId } from '@/lib/route-id';

import { CreateWorkspaceDialog } from './create-workspace-dialog';
import { useWorkspaceList } from './use-workspace-list';
import { useWorkspaceScope } from './workspace-scope';

export function WorkspaceSwitcher() {
  const t = useT();
  const { isMobile } = useSidebar();
  const { workspace } = useWorkspaceScope();
  const workspaces = useWorkspaceList();
  const [createOpen, setCreateOpen] = useState(false);
  const active = workspace.data;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <BuildingIcon className="size-4" aria-hidden="true" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{active ? active.name : t.workspaces.switcher.select}</span>
                <span className="truncate text-xs">{active ? t.common.role[active.role] : t.workspaces.switcher.none}</span>
              </div>
              <ChevronsUpDownIcon className="ml-auto" aria-hidden="true" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-64" align="start" side={isMobile ? 'bottom' : 'right'} sideOffset={4}>
            <DropdownMenuLabel className="text-xs text-muted-foreground">{t.nav.workspaces}</DropdownMenuLabel>
            {workspaces.loading ? <DropdownMenuItem disabled>{t.common.loading}</DropdownMenuItem> : null}
            {workspaces.error && workspaces.items.length === 0 ? (
              <DropdownMenuItem onSelect={() => void workspaces.reload()}>{t.workspaces.switcher.loadFailed}</DropdownMenuItem>
            ) : null}
            {workspaces.items.map((item) => (
              <DropdownMenuItem key={item.id} asChild className="gap-2 p-2">
                <Link href={`/workspaces/${toRouteId(item.id)}/dashboard`}>
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  <Badge variant="outline">{t.common.role[item.role]}</Badge>
                </Link>
              </DropdownMenuItem>
            ))}
            {workspaces.hasMore ? (
              <DropdownMenuItem
                disabled={workspaces.loadingMore}
                onSelect={(event) => {
                  // Keep the menu open so the newly loaded workspaces appear in place.
                  event.preventDefault();
                  workspaces.loadMore();
                }}
              >
                {workspaces.loadingMore ? t.common.loading : t.common.loadMore}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild className="gap-2 p-2">
              <Link href="/workspaces">
                <LayoutGridIcon className="size-4" aria-hidden="true" />
                {t.workspaces.switcher.all}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2 p-2" onSelect={() => setCreateOpen(true)}>
              <PlusIcon className="size-4" aria-hidden="true" />
              {t.workspaces.create.title}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
      <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
    </SidebarMenu>
  );
}
