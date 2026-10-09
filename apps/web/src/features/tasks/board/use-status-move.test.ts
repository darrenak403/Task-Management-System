import { describe, expect, it, vi } from 'vitest';

import { ApiError, NETWORK_ERROR } from '@/lib/api-errors';
import type { Task } from '@/lib/dto';

import { applyPendingMoves, runStatusMove, type BoardColumns, type MoveDeps, type PendingMove } from './use-status-move';

function task(id: string, status: Task['status'], updatedAt = 'v1'): Task {
  return { id, status, updatedAt, title: id } as Task;
}

function harness(overrides: Partial<MoveDeps> = {}) {
  const pending = new Map<string, PendingMove>();
  const history: (PendingMove | null)[] = [];
  const deps: MoveDeps = {
    patch: vi.fn().mockResolvedValue(undefined),
    refetch: vi.fn().mockResolvedValue(true),
    setPending: (taskId, move) => {
      history.push(move);
      if (move) pending.set(taskId, move);
      else pending.delete(taskId);
    },
    isPending: (taskId) => pending.get(taskId)?.saving === true,
    ...overrides,
  };
  return { deps, pending, history };
}

const rejected = new ApiError({ status: 403, code: 'FORBIDDEN', message: 'Not allowed' });
const lost = new ApiError({ status: 0, code: NETWORK_ERROR, message: 'offline' });

describe('runStatusMove', () => {
  it('does not call the API when the card stays in its column', async () => {
    const { deps, history } = harness();

    const result = await runStatusMove(deps, task('t1', 'TODO'), 'TODO');

    expect(result.outcome).toBe('noop');
    expect(deps.patch).not.toHaveBeenCalled();
    expect(history).toEqual([]);
  });

  it('locks the card while saving, then unlocks it and reloads both columns', async () => {
    const { deps, pending, history } = harness();

    const result = await runStatusMove(deps, task('t1', 'TODO'), 'DONE');

    expect(result.outcome).toBe('saved');
    expect(deps.patch).toHaveBeenCalledTimes(1);
    expect(history[0]).toEqual({ to: 'DONE', basedOn: 'v1', saving: true });
    expect(pending.get('t1')).toEqual({ to: 'DONE', basedOn: 'v1', saving: false });
    expect(deps.refetch).toHaveBeenCalledWith(['TODO', 'DONE']);
  });

  it('ignores a second move of a card that is still saving', async () => {
    let release: () => void = () => undefined;
    const { deps } = harness({ patch: vi.fn(() => new Promise<void>((resolve) => (release = resolve))) });

    const first = runStatusMove(deps, task('t1', 'TODO'), 'DONE');
    const second = await runStatusMove(deps, task('t1', 'TODO'), 'IN_PROGRESS');
    release();
    await first;

    expect(second.outcome).toBe('noop');
    expect(deps.patch).toHaveBeenCalledTimes(1);
  });

  it('returns the card to its column when the API rejects the move', async () => {
    const { deps, pending } = harness({ patch: vi.fn().mockRejectedValue(rejected) });

    const result = await runStatusMove(deps, task('t1', 'TODO'), 'DONE');

    expect(result).toEqual({ outcome: 'rejected', error: rejected });
    expect(pending.has('t1')).toBe(false);
  });

  it('refetches before concluding anything when the response is lost', async () => {
    const order: string[] = [];
    const { deps, pending } = harness({
      patch: vi.fn().mockRejectedValue(lost),
      refetch: vi.fn(async () => {
        order.push(pending.get('t1')?.saving ? 'refetch-while-locked' : 'refetch-unlocked');
        return true;
      }),
    });

    const result = await runStatusMove(deps, task('t1', 'TODO'), 'DONE');

    expect(order).toEqual(['refetch-while-locked']);
    expect(result.outcome).toBe('resolved');
    expect(pending.has('t1')).toBe(false);
  });

  it('reports an unconfirmed move when the confirming refetch also fails', async () => {
    const { deps } = harness({ patch: vi.fn().mockRejectedValue(lost), refetch: vi.fn().mockResolvedValue(false) });

    expect((await runStatusMove(deps, task('t1', 'TODO'), 'DONE')).outcome).toBe('unconfirmed');
  });

  it('keeps the saved result on screen when the reload after success fails', async () => {
    const { deps, pending } = harness({ refetch: vi.fn().mockResolvedValue(false) });

    const result = await runStatusMove(deps, task('t1', 'TODO'), 'DONE');

    expect(result.outcome).toBe('saved-unsynced');
    expect(pending.get('t1')).toMatchObject({ to: 'DONE', saving: false });
  });
});

describe('applyPendingMoves', () => {
  const columns: BoardColumns = { TODO: [task('a', 'TODO'), task('b', 'TODO')], IN_PROGRESS: [], DONE: [task('c', 'DONE')] };

  it('shows a pending card in its target column with the new status', () => {
    const shown = applyPendingMoves(columns, new Map([['a', { to: 'DONE', basedOn: 'v1', saving: true }]]));

    expect(shown.TODO.map((item) => item.id)).toEqual(['b']);
    expect(shown.DONE.map((item) => [item.id, item.status])).toEqual([['a', 'DONE'], ['c', 'DONE']]);
    expect(columns.TODO).toHaveLength(2);
  });

  it('lets newer server data win over an old pending move', () => {
    const fresh: BoardColumns = { ...columns, TODO: [task('a', 'TODO', 'v2'), task('b', 'TODO')] };

    const shown = applyPendingMoves(fresh, new Map([['a', { to: 'DONE', basedOn: 'v1', saving: false }]]));

    expect(shown).toEqual(fresh);
  });

  it('returns the same columns when nothing is pending', () => {
    expect(applyPendingMoves(columns, new Map())).toBe(columns);
  });
});
