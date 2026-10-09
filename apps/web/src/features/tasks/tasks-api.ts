import { api } from '@/lib/api-client';
import type { CreateTaskInput, Page, Task, TaskPriority, TaskStatus, UpdateTaskInput } from '@/lib/dto';

export const TASK_PAGE_SIZE = 20;

export type TaskListFilter = {
  teamId?: string | undefined;
  assigneeId?: string | undefined;
  q?: string | undefined;
  status?: TaskStatus | undefined;
  priority?: TaskPriority | undefined;
  page: number;
  pageSize?: number;
};

/** Lists tasks of a workspace, limited by the API to the teams the caller can see. */
export function listTasks(workspaceId: string, filter: TaskListFilter, signal?: AbortSignal): Promise<Page<Task>> {
  return api(`/workspaces/${workspaceId}/tasks`, {
    query: {
      page: filter.page,
      pageSize: filter.pageSize ?? TASK_PAGE_SIZE,
      q: filter.q?.trim() || undefined,
      status: filter.status,
      priority: filter.priority,
      teamId: filter.teamId,
      assigneeId: filter.assigneeId,
    },
    signal,
  });
}

const taskPath = (workspaceId: string, teamId: string, taskId?: string) =>
  `/workspaces/${workspaceId}/teams/${teamId}/tasks${taskId ? `/${taskId}` : ''}`;

export async function createTask(workspaceId: string, teamId: string, input: CreateTaskInput): Promise<Task> {
  return (await api<{ data: Task }>(taskPath(workspaceId, teamId), { method: 'POST', body: input })).data;
}

export async function updateTask(workspaceId: string, teamId: string, taskId: string, input: UpdateTaskInput): Promise<Task> {
  return (await api<{ data: Task }>(taskPath(workspaceId, teamId, taskId), { method: 'PATCH', body: input })).data;
}

export function deleteTask(workspaceId: string, teamId: string, taskId: string): Promise<void> {
  return api(taskPath(workspaceId, teamId, taskId), { method: 'DELETE' });
}
