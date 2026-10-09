'use client';

import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';

import { messages } from '@/i18n/messages';
import { errorMessage, isAccessLost, isOutcomeUnknown } from '@/lib/api-errors';
import { TASK_STATUSES, type Task, type TaskStatus } from '@/lib/dto';
import { invalidationBus, topics } from '@/lib/realtime/invalidation-bus';

import { updateTask } from '../tasks-api';

export type BoardColumns = Record<TaskStatus, Task[]>;

/**
 * A status change shown before the server data reflects it.
 * `basedOn` is the task's `updatedAt` when the move started: once the server returns a newer
 * version of the task, the entry no longer applies and the server data wins.
 */
export type PendingMove = { to: TaskStatus; basedOn: string; saving: boolean };
export type PendingMoves = ReadonlyMap<string, PendingMove>;

/** Server columns with pending moves applied on top. */
export function applyPendingMoves(columns: BoardColumns, pending: PendingMoves): BoardColumns {
  if (pending.size === 0) return columns;
  const result: BoardColumns = { TODO: [...columns.TODO], IN_PROGRESS: [...columns.IN_PROGRESS], DONE: [...columns.DONE] };
  for (const status of TASK_STATUSES) {
    for (const task of columns[status]) {
      const move = pending.get(task.id);
      if (!move || move.basedOn !== task.updatedAt || move.to === status) continue;
      result[status] = result[status].filter((item) => item.id !== task.id);
      result[move.to] = [{ ...task, status: move.to }, ...result[move.to]];
    }
  }
  return result;
}

export type MoveOutcome = 'noop' | 'resolved' | 'saved' | 'saved-unsynced' | 'rejected' | 'unconfirmed';

export type MoveDeps = {
  patch: (task: Task, to: TaskStatus) => Promise<unknown>;
  /** Reloads the columns touched by a move; resolves to whether fresh data arrived. */
  refetch: (statuses: TaskStatus[]) => Promise<boolean>;
  setPending: (taskId: string, move: PendingMove | null) => void;
  isPending: (taskId: string) => boolean;
};

/**
 * One optimistic status change:
 * - same status, or a card that is still saving: nothing is sent;
 * - clear rejection: the card returns to its column;
 * - lost response: the columns are refetched before anything is concluded;
 * - success: the card is unlocked and the columns reload; if that reload fails the saved result stays on screen.
 */
export async function runStatusMove(deps: MoveDeps, task: Task, to: TaskStatus): Promise<{ outcome: MoveOutcome; error?: unknown }> {
  if (to === task.status || deps.isPending(task.id)) return { outcome: 'noop' };
  const move: PendingMove = { to, basedOn: task.updatedAt, saving: true };
  deps.setPending(task.id, move);
  const touched = [task.status, to];

  try {
    await deps.patch(task, to);
  } catch (error) {
    if (isOutcomeUnknown(error)) {
      const confirmed = await deps.refetch(touched);
      // Fresh columns now show what the server holds, whichever way the request went.
      deps.setPending(task.id, null);
      return confirmed ? { outcome: 'resolved' } : { outcome: 'unconfirmed', error };
    }
    deps.setPending(task.id, null);
    void deps.refetch(touched);
    return { outcome: 'rejected', error };
  }

  deps.setPending(task.id, { ...move, saving: false });
  const synced = await deps.refetch(touched);
  return { outcome: synced ? 'saved' : 'saved-unsynced' };
}

/** Pending moves of one board plus the action that starts a move. */
export function useStatusMove(
  workspaceId: string,
  teamId: string,
  refetch: (statuses: TaskStatus[]) => Promise<boolean>,
): { pending: PendingMoves; move: (task: Task, to: TaskStatus) => void } {
  const [pending, setPendingState] = useState<PendingMoves>(new Map());
  const pendingRef = useRef(pending);

  const setPending = useCallback((taskId: string, next: PendingMove | null) => {
    const updated = new Map(pendingRef.current);
    if (next) updated.set(taskId, next);
    else updated.delete(taskId);
    pendingRef.current = updated;
    setPendingState(updated);
  }, []);

  const move = useCallback(
    (task: Task, to: TaskStatus) => {
      void runStatusMove(
        {
          patch: (target, status) => updateTask(workspaceId, teamId, target.id, { status }),
          refetch,
          setPending,
          isPending: (taskId) => pendingRef.current.get(taskId)?.saving === true,
        },
        task,
        to,
      ).then(({ outcome, error }) => {
        if (outcome === 'rejected') {
          toast.error(messages().tasks.board.notMoved(task.title, errorMessage(error)));
          if (isAccessLost(error)) invalidationBus.publish(topics.structure);
        } else if (outcome === 'unconfirmed') {
          toast.error(messages().tasks.board.unconfirmed);
        } else if (outcome === 'saved-unsynced') {
          toast.warning(messages().tasks.board.savedUnsynced);
        }
      });
    },
    [workspaceId, teamId, refetch, setPending],
  );

  return { pending, move };
}
