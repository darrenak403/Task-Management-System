import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createInvalidationBus } from './invalidation-bus';

const DELAY = 150;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

describe('invalidation bus', () => {
  it('coalesces a burst of signals into one refetch', async () => {
    const bus = createInvalidationBus(DELAY);
    const run = vi.fn();
    bus.subscribe(['tasks:t1'], run);

    bus.publish('tasks:t1');
    bus.publish('tasks:t1');
    bus.publish('tasks:t1');
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(DELAY);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runs exactly one follow-up for signals that arrive during a refetch', async () => {
    const bus = createInvalidationBus(DELAY);
    const first = deferred();
    const run = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    bus.subscribe(['tasks:t1'], run);

    bus.publish('tasks:t1');
    await vi.advanceTimersByTimeAsync(DELAY);
    bus.publish('tasks:t1');
    bus.publish('tasks:t1');
    await vi.advanceTimersByTimeAsync(DELAY * 3);
    expect(run).toHaveBeenCalledTimes(1);

    first.resolve();
    await vi.advanceTimersByTimeAsync(DELAY);

    expect(run).toHaveBeenCalledTimes(2);
  });

  it('only reaches subscribers of the published topic', async () => {
    const bus = createInvalidationBus(DELAY);
    const teamOne = vi.fn();
    const teamTwo = vi.fn();
    bus.subscribe(['tasks:t1'], teamOne);
    bus.subscribe(['tasks:t2'], teamTwo);

    bus.publish('tasks:t1');
    await vi.advanceTimersByTimeAsync(DELAY);

    expect(teamOne).toHaveBeenCalledTimes(1);
    expect(teamTwo).not.toHaveBeenCalled();
  });

  it('matches wildcards on either side', async () => {
    const bus = createInvalidationBus(DELAY);
    const anyTasks = vi.fn();
    const teamOne = vi.fn();
    const roster = vi.fn();
    bus.subscribe(['tasks:*'], anyTasks);
    bus.subscribe(['tasks:t1'], teamOne);
    bus.subscribe(['roster:t1'], roster);

    bus.publish('tasks:t1');
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(anyTasks).toHaveBeenCalledTimes(1);

    bus.publish('tasks:*');
    await vi.advanceTimersByTimeAsync(DELAY);

    expect(teamOne).toHaveBeenCalledTimes(2);
    expect(roster).not.toHaveBeenCalled();
  });

  it('reloads every subscriber once on publishAll', async () => {
    const bus = createInvalidationBus(DELAY);
    const tasks = vi.fn();
    const structure = vi.fn();
    bus.subscribe(['tasks:t1'], tasks);
    bus.subscribe(['structure'], structure);

    bus.publishAll();
    await vi.advanceTimersByTimeAsync(DELAY);

    expect(tasks).toHaveBeenCalledTimes(1);
    expect(structure).toHaveBeenCalledTimes(1);
  });

  it('does not run a subscriber that unsubscribed before the window closed', async () => {
    const bus = createInvalidationBus(DELAY);
    const run = vi.fn();
    const unsubscribe = bus.subscribe(['tasks:t1'], run);

    bus.publish('tasks:t1');
    unsubscribe();
    await vi.advanceTimersByTimeAsync(DELAY);

    expect(run).not.toHaveBeenCalled();
  });

  it('keeps working after a refetch fails', async () => {
    const bus = createInvalidationBus(DELAY);
    const run = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    bus.subscribe(['tasks:t1'], run);

    bus.publish('tasks:t1');
    await vi.advanceTimersByTimeAsync(DELAY);
    bus.publish('tasks:t1');
    await vi.advanceTimersByTimeAsync(DELAY);

    expect(run).toHaveBeenCalledTimes(2);
  });

  it('schedules nothing while idle', () => {
    const bus = createInvalidationBus(DELAY);
    bus.subscribe(['tasks:t1'], vi.fn());

    expect(vi.getTimerCount()).toBe(0);
  });
});
