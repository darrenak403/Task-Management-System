/**
 * Turns realtime events into "refetch what this screen shows" signals.
 *
 * - Signals for the same subscriber are coalesced inside a short window.
 * - A signal that arrives while the subscriber's refetch is in flight sets a dirty flag,
 *   so exactly one follow-up refetch runs after it settles.
 *
 * This is event-driven debouncing; nothing here runs on an interval.
 */

export type InvalidationBus = {
  /** `topics` may contain exact names or a `prefix:*` wildcard. */
  subscribe(topics: readonly string[], run: () => Promise<unknown> | void): () => void;
  publish(topic: string): void;
  /** Used after a resync: every subscriber reloads its snapshot once. */
  publishAll(): void;
};

type Subscriber = {
  topics: readonly string[];
  run: () => Promise<unknown> | void;
  timer: ReturnType<typeof setTimeout> | undefined;
  running: boolean;
  dirty: boolean;
  active: boolean;
};

export const INVALIDATION_DELAY_MS = 150;

function matches(pattern: string, topic: string): boolean {
  if (pattern === topic) return true;
  if (pattern.endsWith(':*')) return topic.startsWith(pattern.slice(0, -1));
  // A wildcard publish such as `tasks:*` reaches every `tasks:<id>` subscriber.
  if (topic.endsWith(':*')) return pattern.startsWith(topic.slice(0, -1));
  return false;
}

export function createInvalidationBus(delayMs = INVALIDATION_DELAY_MS): InvalidationBus {
  const subscribers = new Set<Subscriber>();

  function fire(subscriber: Subscriber): void {
    subscriber.timer = undefined;
    if (!subscriber.active) return;
    if (subscriber.running) {
      subscriber.dirty = true;
      return;
    }
    subscriber.running = true;
    void Promise.resolve()
      .then(() => subscriber.run())
      .catch(() => {
        // The subscriber surfaces its own load error; the bus only sequences refetches.
      })
      .finally(() => {
        subscriber.running = false;
        if (subscriber.dirty && subscriber.active) {
          subscriber.dirty = false;
          schedule(subscriber);
        }
      });
  }

  function schedule(subscriber: Subscriber): void {
    if (!subscriber.active || subscriber.timer !== undefined) return;
    subscriber.timer = setTimeout(() => fire(subscriber), delayMs);
  }

  return {
    subscribe(topics, run) {
      const subscriber: Subscriber = { topics, run, timer: undefined, running: false, dirty: false, active: true };
      subscribers.add(subscriber);
      return () => {
        subscriber.active = false;
        if (subscriber.timer !== undefined) clearTimeout(subscriber.timer);
        subscribers.delete(subscriber);
      };
    },
    publish(topic) {
      for (const subscriber of subscribers) {
        if (subscriber.topics.some((pattern) => matches(pattern, topic))) schedule(subscriber);
      }
    },
    publishAll() {
      for (const subscriber of subscribers) schedule(subscriber);
    },
  };
}

/** One bus per tab; the realtime provider publishes, feature hooks subscribe. */
export const invalidationBus = createInvalidationBus();

export const topics = {
  tasks: (teamId: string) => `tasks:${teamId}`,
  anyTasks: 'tasks:*',
  roster: (teamId: string) => `roster:${teamId}`,
  structure: 'structure',
  members: 'members',
  planner: (teamId: string) => `planner:${teamId}`,
} as const;
