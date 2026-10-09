import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { argon2id, hash } from 'argon2';
import { createPrismaClient } from '../src/shared/db/prisma.js';
import { loadEnvironment } from '../src/shared/config/env.js';
import { teams, users, workspaces } from './seed-data.js';

async function main(): Promise<void> {
  dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
  if (process.env.SEED_DEMO_DATA !== 'yes') throw new Error('Set SEED_DEMO_DATA=yes to create or refresh demo data.');
  const password = process.env.SEED_DEMO_PASSWORD;
  if (!password || password.length < 8 || password.length > 128) {
    throw new Error('Set SEED_DEMO_PASSWORD to a unique password with 8–128 characters.');
  }
  const environment = loadEnvironment();
  if (!environment.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  const passwordHash = await hash(password, { type: argon2id });
  const prisma = createPrismaClient(environment.DATABASE_URL);
  try {
    await prisma.$connect();
    await prisma.$transaction(async (tx) => {
      for (const { id, email, displayName } of Object.values(users)) {
        await tx.user.upsert({ where: { id }, create: { id, email, displayName, passwordHash }, update: { email, displayName, passwordHash } });
      }
      for (const { id, name, owner } of Object.values(workspaces)) {
        const userId = users[owner].id;
        await tx.workspace.upsert({ where: { id }, create: { id, name }, update: { name } });
        await tx.workspaceMember.upsert({ where: { workspaceId_userId: { workspaceId: id, userId } }, create: { workspaceId: id, userId, role: 'OWNER' }, update: { role: 'OWNER' } });
      }

      const today = businessDate();
      for (const team of Object.values(teams)) {
        const workspaceId = workspaces[team.workspace].id;
        const teamId = team.id;
        await tx.team.upsert({ where: { id: teamId }, create: { id: teamId, workspaceId, name: team.name }, update: { workspaceId, name: team.name } });
        for (const user of team.members) {
          const userId = users[user].id;
          await tx.teamMember.upsert({ where: { teamId_userId: { teamId, userId } }, create: { workspaceId, teamId, userId }, update: { workspaceId } });
        }

        const taskIds = team.tasks.map((_task, index) => `${team.taskIdPrefix}-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);
        for (const [index, task] of team.tasks.entries()) {
          const id = taskIds[index]!;
          const data = {
            workspaceId, teamId, title: task.title, description: task.description, status: task.status, priority: task.priority,
            createdBy: users[task.creator].id, assigneeId: task.assignee ? users[task.assignee].id : null,
            plannedStartDate: task.start === null ? null : dateOffset(today, task.start), dueDate: task.due === null ? null : dateOffset(today, task.due),
            estimateMinMinutes: task.estimate?.[0] ?? null, estimateMaxMinutes: task.estimate?.[1] ?? null,
            completionCriteria: task.completionCriteria, priorityReason: task.priorityReason, relativeStartDay: null, relativeDueDay: null,
          };
          await tx.task.upsert({ where: { id }, create: { id, ...data }, update: data });
        }

        // Checklists and dependencies are replaced, so a rerun restores them exactly as written in the seed data.
        await tx.taskChecklist.deleteMany({ where: { taskId: { in: taskIds } } });
        await tx.taskDependency.deleteMany({ where: { taskId: { in: taskIds } } });
        await tx.taskChecklist.createMany({
          data: team.tasks.flatMap((task, index) => (task.checklist ?? []).map(([title, isCompleted], position) => ({ taskId: taskIds[index]!, position, title, isCompleted }))),
        });
        await tx.taskDependency.createMany({
          data: team.tasks.flatMap((task, index) => (task.prerequisites ?? []).map((prerequisite) => ({ workspaceId, teamId, taskId: taskIds[index]!, prerequisiteId: taskIds[prerequisite]! }))),
        });
      }
    }, { timeout: 60_000 });
    process.stdout.write('Demo workspaces, memberships, teams, and date-boundary tasks are ready.\n');
    process.stdout.write(`Demo users: ${Object.values(users).map(({ email }) => email).join(', ')}. Use SEED_DEMO_PASSWORD to sign in.\n`);
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
