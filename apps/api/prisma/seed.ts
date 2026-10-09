import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { argon2id, hash } from 'argon2';
import { createPrismaClient } from '../src/shared/db/prisma.js';
import { loadEnvironment } from '../src/shared/config/env.js';

const ids = {
  alphaOwner: '10000000-0000-4000-8000-000000000001',
  alphaMember: '10000000-0000-4000-8000-000000000002',
  betaOwner: '10000000-0000-4000-8000-000000000003',
  workspaceAlpha: '20000000-0000-4000-8000-000000000001',
  workspaceBeta: '20000000-0000-4000-8000-000000000002',
  teamAlpha: '30000000-0000-4000-8000-000000000001',
  teamBeta: '30000000-0000-4000-8000-000000000002',
} as const;

async function main(): Promise<void> {
  dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
  if (process.env.SEED_DEMO_DATA !== 'yes') throw new Error('Set SEED_DEMO_DATA=yes to create or refresh demo data.');
  const password = process.env.SEED_DEMO_PASSWORD;
  if (!password || password.length < 12 || password.length > 128) {
    throw new Error('Set SEED_DEMO_PASSWORD to a unique password with 12–128 characters.');
  }
  const environment = loadEnvironment();
  if (!environment.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  const passwordHash = await hash(password, { type: argon2id });
  const prisma = createPrismaClient(environment.DATABASE_URL);
  try {
    await prisma.$connect();
    await prisma.$transaction(async (tx) => {
      await tx.user.upsert({ where: { id: ids.alphaOwner }, create: { id: ids.alphaOwner, email: 'owner.alpha@example.test', displayName: 'Alex Owner', passwordHash }, update: { email: 'owner.alpha@example.test', displayName: 'Alex Owner', passwordHash } });
      await tx.user.upsert({ where: { id: ids.alphaMember }, create: { id: ids.alphaMember, email: 'member.alpha@example.test', displayName: 'Mai Member', passwordHash }, update: { email: 'member.alpha@example.test', displayName: 'Mai Member', passwordHash } });
      await tx.user.upsert({ where: { id: ids.betaOwner }, create: { id: ids.betaOwner, email: 'owner.beta@example.test', displayName: 'Bao Owner', passwordHash }, update: { email: 'owner.beta@example.test', displayName: 'Bao Owner', passwordHash } });

      await tx.workspace.upsert({ where: { id: ids.workspaceAlpha }, create: { id: ids.workspaceAlpha, name: 'Demo Workspace Alpha' }, update: { name: 'Demo Workspace Alpha' } });
      await tx.workspace.upsert({ where: { id: ids.workspaceBeta }, create: { id: ids.workspaceBeta, name: 'Demo Workspace Beta' }, update: { name: 'Demo Workspace Beta' } });
      await tx.workspaceMember.upsert({ where: { workspaceId_userId: { workspaceId: ids.workspaceAlpha, userId: ids.alphaOwner } }, create: { workspaceId: ids.workspaceAlpha, userId: ids.alphaOwner, role: 'OWNER' }, update: { role: 'OWNER' } });
      await tx.workspaceMember.upsert({ where: { workspaceId_userId: { workspaceId: ids.workspaceAlpha, userId: ids.alphaMember } }, create: { workspaceId: ids.workspaceAlpha, userId: ids.alphaMember, role: 'MEMBER' }, update: { role: 'MEMBER' } });
      await tx.workspaceMember.upsert({ where: { workspaceId_userId: { workspaceId: ids.workspaceBeta, userId: ids.betaOwner } }, create: { workspaceId: ids.workspaceBeta, userId: ids.betaOwner, role: 'OWNER' }, update: { role: 'OWNER' } });

      await tx.team.upsert({ where: { id: ids.teamAlpha }, create: { id: ids.teamAlpha, workspaceId: ids.workspaceAlpha, name: 'Product Engineering' }, update: { workspaceId: ids.workspaceAlpha, name: 'Product Engineering' } });
      await tx.team.upsert({ where: { id: ids.teamBeta }, create: { id: ids.teamBeta, workspaceId: ids.workspaceBeta, name: 'Private Operations' }, update: { workspaceId: ids.workspaceBeta, name: 'Private Operations' } });
      await tx.teamMember.upsert({ where: { teamId_userId: { teamId: ids.teamAlpha, userId: ids.alphaOwner } }, create: { workspaceId: ids.workspaceAlpha, teamId: ids.teamAlpha, userId: ids.alphaOwner }, update: { workspaceId: ids.workspaceAlpha } });
      await tx.teamMember.upsert({ where: { teamId_userId: { teamId: ids.teamAlpha, userId: ids.alphaMember } }, create: { workspaceId: ids.workspaceAlpha, teamId: ids.teamAlpha, userId: ids.alphaMember }, update: { workspaceId: ids.workspaceAlpha } });
      await tx.teamMember.upsert({ where: { teamId_userId: { teamId: ids.teamBeta, userId: ids.betaOwner } }, create: { workspaceId: ids.workspaceBeta, teamId: ids.teamBeta, userId: ids.betaOwner }, update: { workspaceId: ids.workspaceBeta } });

      const today = businessDate();
      const alphaTasks = [
        { id: '40000000-0000-4000-8000-000000000001', title: 'Resolve overdue production alert', description: 'Example task for an overdue deadline boundary.', status: 'IN_PROGRESS' as const, priority: 'HIGH' as const, createdBy: ids.alphaOwner, assigneeId: ids.alphaMember, dueDate: dateOffset(today, -1), plannedStartDate: dateOffset(today, -3) },
        { id: '40000000-0000-4000-8000-000000000002', title: 'Review today’s release checklist', description: 'Example task due on the current business date.', status: 'TODO' as const, priority: 'HIGH' as const, createdBy: ids.alphaOwner, assigneeId: ids.alphaMember, dueDate: dateOffset(today, 0), plannedStartDate: dateOffset(today, -1) },
        { id: '40000000-0000-4000-8000-000000000003', title: 'Prepare the next sprint board', description: 'Example upcoming task for Dashboard and List views.', status: 'TODO' as const, priority: 'MEDIUM' as const, createdBy: ids.alphaOwner, assigneeId: ids.alphaMember, dueDate: dateOffset(today, 1), plannedStartDate: dateOffset(today, 0) },
        { id: '40000000-0000-4000-8000-000000000004', title: 'Document the service ownership map', description: 'Example task without an absolute deadline.', status: 'TODO' as const, priority: 'LOW' as const, createdBy: ids.alphaOwner, assigneeId: null, dueDate: null, plannedStartDate: null },
        { id: '40000000-0000-4000-8000-000000000005', title: 'Close the completed onboarding task', description: 'Completed item to exercise status filters.', status: 'DONE' as const, priority: 'LOW' as const, createdBy: ids.alphaOwner, assigneeId: ids.alphaMember, dueDate: dateOffset(today, 2), plannedStartDate: dateOffset(today, 0) },
      ];
      for (const task of alphaTasks) {
        await tx.task.upsert({
          where: { id: task.id },
          create: { ...task, workspaceId: ids.workspaceAlpha, teamId: ids.teamAlpha, estimateMinMinutes: 30, estimateMaxMinutes: 90, completionCriteria: 'The team can verify the result.', priorityReason: `Seeded ${task.priority.toLowerCase()} priority example.`, relativeStartDay: null, relativeDueDay: null },
          update: { ...task, workspaceId: ids.workspaceAlpha, teamId: ids.teamAlpha, estimateMinMinutes: 30, estimateMaxMinutes: 90, completionCriteria: 'The team can verify the result.', priorityReason: `Seeded ${task.priority.toLowerCase()} priority example.`, relativeStartDay: null, relativeDueDay: null },
        });
      }
      await tx.task.upsert({
        where: { id: '50000000-0000-4000-8000-000000000001' },
        create: { id: '50000000-0000-4000-8000-000000000001', workspaceId: ids.workspaceBeta, teamId: ids.teamBeta, createdBy: ids.betaOwner, assigneeId: null, title: 'Review private operations queue', description: 'This task belongs only to Demo Workspace Beta.', status: 'TODO', priority: 'MEDIUM', dueDate: dateOffset(today, 0), plannedStartDate: null, relativeStartDay: null, relativeDueDay: null, estimateMinMinutes: null, estimateMaxMinutes: null, completionCriteria: '', priorityReason: '' },
        update: { workspaceId: ids.workspaceBeta, teamId: ids.teamBeta, createdBy: ids.betaOwner, assigneeId: null, title: 'Review private operations queue', description: 'This task belongs only to Demo Workspace Beta.', status: 'TODO', priority: 'MEDIUM', dueDate: dateOffset(today, 0), plannedStartDate: null, relativeStartDay: null, relativeDueDay: null, estimateMinMinutes: null, estimateMaxMinutes: null, completionCriteria: '', priorityReason: '' },
      });
    }, { timeout: 20_000 });
    process.stdout.write('Demo workspaces, memberships, teams, and date-boundary tasks are ready.\n');
    process.stdout.write('Demo users: owner.alpha@example.test, member.alpha@example.test, owner.beta@example.test. Use SEED_DEMO_PASSWORD to sign in.\n');
  } finally {
    await prisma.$disconnect();
  }
}

function businessDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function dateOffset(value: string, days: number): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Demo seed failed.'}\n`);
  process.exitCode = 1;
});
