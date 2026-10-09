'use client';

import { EllipsisVerticalIcon, LogOutIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/components/ui/sidebar';
import { useAuth, useCurrentUser } from '@/features/auth/auth-provider';
import { useT } from '@/i18n/locale-provider';
import { errorMessage } from '@/lib/api-errors';
import { displayNameOf, initialsOf } from '@/lib/people';

export function NavUser() {
  const t = useT();
  const { isMobile } = useSidebar();
  const { logout } = useAuth();
  const user = useCurrentUser();
  const [pending, setPending] = useState(false);
  const name = displayNameOf(user);

  async function onLogout() {
    setPending(true);
    try {
      await logout();
    } catch (error) {
      setPending(false);
      toast.error(errorMessage(error, t.common.session.signOutFailed));
    }
  }

  const identity = (
    <>
      <Avatar className="size-8 rounded-lg">
        <AvatarFallback className="rounded-lg">{initialsOf(user)}</AvatarFallback>
      </Avatar>
      <div className="grid flex-1 text-left text-sm leading-tight">
        <span className="truncate font-medium">{name}</span>
        <span className="truncate text-xs text-muted-foreground">{user.email}</span>
      </div>
    </>
  );

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              {identity}
              <EllipsisVerticalIcon className="ml-auto size-4" aria-hidden="true" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? 'bottom' : 'right'}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5">{identity}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={pending} onSelect={() => void onLogout()}>
              <LogOutIcon aria-hidden="true" />
              {pending ? t.common.session.signingOut : t.common.session.logOut}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
