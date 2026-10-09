import { describe, expect, it } from 'vitest';

import type { WorkspaceRole } from '@/lib/dto';

import { can, canChangeRole, canDeleteTask, canRemoveMember, type WorkspaceAction } from './permissions';

const ROLES: WorkspaceRole[] = ['OWNER', 'ADMIN', 'MEMBER'];

/** Expected [OWNER, ADMIN, MEMBER] per action, copied from the workspace permission matrix. */
const EXPECTED: Record<WorkspaceAction, [boolean, boolean, boolean]> = {
  'workspace.rename': [true, true, false],
  'team.create': [true, true, false],
  'team.rename': [true, true, false],
  'team.manageMembers': [true, true, false],
  'members.view': [true, true, false],
  'members.add': [true, true, false],
  'members.changeRole': [true, false, false],
  'tasks.manageAllTeams': [true, true, false],
};

describe('workspace permissions', () => {
  it.each(Object.entries(EXPECTED) as [WorkspaceAction, boolean[]][])('%s follows the matrix', (action, expected) => {
    expect(ROLES.map((role) => can(action, role))).toEqual(expected);
  });

  it('allows nothing before the role is known', () => {
    for (const action of Object.keys(EXPECTED) as WorkspaceAction[]) {
      expect(can(action, undefined)).toBe(false);
    }
  });

  it('lets the owner remove admins and members, but never the owner or themselves', () => {
    const owner = { id: 'owner', role: 'OWNER' as const };

    expect(canRemoveMember(owner, { id: 'a', role: 'ADMIN' })).toBe(true);
    expect(canRemoveMember(owner, { id: 'm', role: 'MEMBER' })).toBe(true);
    expect(canRemoveMember(owner, { id: 'owner', role: 'OWNER' })).toBe(false);
  });

  it('lets an admin remove only members other than themselves', () => {
    const admin = { id: 'admin', role: 'ADMIN' as const };

    expect(canRemoveMember(admin, { id: 'm', role: 'MEMBER' })).toBe(true);
    expect(canRemoveMember(admin, { id: 'a2', role: 'ADMIN' })).toBe(false);
    expect(canRemoveMember(admin, { id: 'owner', role: 'OWNER' })).toBe(false);
    expect(canRemoveMember(admin, { id: 'admin', role: 'ADMIN' })).toBe(false);
  });

  it('never lets a member remove anyone', () => {
    const member = { id: 'm1', role: 'MEMBER' as const };

    expect(canRemoveMember(member, { id: 'm2', role: 'MEMBER' })).toBe(false);
    expect(canRemoveMember(member, { id: 'a', role: 'ADMIN' })).toBe(false);
  });

  it('lets only the owner change the role of other non-owners', () => {
    const owner = { id: 'owner', role: 'OWNER' as const };

    expect(canChangeRole(owner, { id: 'a', role: 'ADMIN' })).toBe(true);
    expect(canChangeRole(owner, { id: 'm', role: 'MEMBER' })).toBe(true);
    expect(canChangeRole(owner, { id: 'owner', role: 'OWNER' })).toBe(false);
    expect(canChangeRole({ id: 'admin', role: 'ADMIN' }, { id: 'm', role: 'MEMBER' })).toBe(false);
    expect(canChangeRole({ id: 'm1', role: 'MEMBER' }, { id: 'm2', role: 'MEMBER' })).toBe(false);
  });

  it('lets owners and admins delete any task and members only their own', () => {
    const task = { createdBy: 'author' };

    expect(canDeleteTask({ id: 'x', role: 'OWNER' }, task)).toBe(true);
    expect(canDeleteTask({ id: 'x', role: 'ADMIN' }, task)).toBe(true);
    expect(canDeleteTask({ id: 'author', role: 'MEMBER' }, task)).toBe(true);
    expect(canDeleteTask({ id: 'other', role: 'MEMBER' }, task)).toBe(false);
    expect(canDeleteTask({ id: 'author', role: undefined }, task)).toBe(false);
  });
});
