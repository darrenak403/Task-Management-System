import type { Client, Notification } from 'pg';
import type { Logger } from 'pino';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { isRealtimeEventType } from './event-catalog.js';
import type { RealtimeConnectionRegistry } from './connection-registry.js';
import { connectRealtimeListener, REALTIME_CHANNEL } from './listener.js';
import { RealtimeRepository, type RealtimeClockSnapshot } from './realtime.repository.js';

const MAX_BACKOFF_MS = 30_000;

export class RealtimeDispatcher {
  private readonly repository: RealtimeRepository;
  private listener: Client | undefined;
  private stopping = false;
  private generation = 0;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private reconnectAttempt = 0;
  private drainTask: Promise<void> | undefined;
  private dirty = false;
  private epoch: string | undefined;
  private lastSeq = 0n;
  private readonly wakeHandlers = new Set<() => void>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly databaseUrl: string,
    private readonly connections: RealtimeConnectionRegistry,
    private readonly logger: Logger,
  ) {
    this.repository = new RealtimeRepository(prisma);
  }

  async start(): Promise<void> {
    await this.connectAndCatchUp();
  }

  isAvailable(): boolean {
    return this.connections.isAvailable();
  }

  subscribeToWake(handler: () => void): () => void {
    this.wakeHandlers.add(handler);
    return () => this.wakeHandlers.delete(handler);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.generation += 1;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    await this.connections.closeAll('server.draining', 'The API server is shutting down.');
    const listener = this.listener;
    this.listener = undefined;
    if (listener) {
      listener.removeAllListeners();
      await listener.end().catch(() => undefined);
    }
    await this.drainTask?.catch(() => undefined);
  }

  private async connectAndCatchUp(): Promise<void> {
    const generation = ++this.generation;
    const listener = await connectRealtimeListener(this.databaseUrl, {
      onNotification: (notification) => this.onNotification(generation, notification),
      onLoss: (error) => this.onListenerLoss(generation, error),
    });
    if (this.stopping || generation !== this.generation) {
      listener.removeAllListeners();
      await listener.end().catch(() => undefined);
      return;
    }
    this.listener = listener;
    let clock: RealtimeClockSnapshot;
    try {
      clock = await this.repository.getClock();
    } catch (error) {
      if (this.listener === listener) this.listener = undefined;
      listener.removeAllListeners();
      await listener.end().catch(() => undefined);
      throw error;
    }
    if (this.stopping || generation !== this.generation || this.listener !== listener) return;
    this.epoch = clock.epoch;
    this.lastSeq = clock.lastSeq;
    this.reconnectAttempt = 0;
    this.connections.setAvailable(true);
    this.logger.info({ epoch: clock.epoch, watermark: clock.watermarkId }, 'Realtime listener is ready after catch-up');
    this.wakeWorkers();
    if (this.dirty) this.requestDrain();
  }

  private onNotification(generation: number, notification: Notification): void {
    if (generation !== this.generation || notification.channel !== REALTIME_CHANNEL) return;
    this.wakeWorkers();
    this.dirty = true;
    if (this.connections.isAvailable()) this.requestDrain();
  }

  private wakeWorkers(): void {
    for (const handler of this.wakeHandlers) {
      try {
        handler();
      } catch (error) {
        const errorName = error instanceof Error ? error.name : 'UnknownError';
        this.logger.error({ errorName }, 'Realtime wake handler failed');
      }
    }
  }

  private onListenerLoss(generation: number, error: Error): void {
    if (generation !== this.generation || this.stopping) return;
    this.generation += 1;
    this.connections.setAvailable(false);
    const listener = this.listener;
    this.listener = undefined;
    if (listener) {
      listener.removeAllListeners();
      void listener.end().catch(() => undefined);
    }
    const errorName = error.name || 'Error';
    this.logger.error({ errorName }, 'Realtime LISTEN connection was lost');
    void this.connections.closeAll('server.unavailable', 'Realtime delivery was interrupted; reconnect and resync.');
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopping || this.reconnectTimer) return;
    const delay = Math.min(1_000 * (2 ** this.reconnectAttempt), MAX_BACKOFF_MS);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connectAndCatchUp().catch((error: unknown) => {
        const errorName = error instanceof Error ? error.name : 'UnknownError';
        this.logger.error({ errorName }, 'Realtime LISTEN reconnect failed');
        this.connections.setAvailable(false);
        this.scheduleReconnect();
      });
    }, delay);
    this.reconnectTimer.unref();
  }

  private requestDrain(): void {
    if (this.drainTask) {
      this.dirty = true;
      return;
    }
    const generation = this.generation;
    this.drainTask = this.drain(generation).catch((error: unknown) => {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      this.logger.error({ errorName }, 'Realtime outbox drain failed');
      this.onListenerLoss(generation, error instanceof Error ? error : new Error('Realtime drain failed.'));
    }).finally(() => {
      this.drainTask = undefined;
      if (this.dirty && this.connections.isAvailable()) this.requestDrain();
    });
  }

  private async drain(generation: number): Promise<void> {
    do {
      this.dirty = false;
      if (generation !== this.generation || !this.connections.isAvailable()) return;
      const clock = await this.repository.getClock();
      if (clock.epoch !== this.epoch || this.lastSeq < clock.purgedThrough) {
        await this.connections.resyncAll(clock.watermarkId, 'outbox_gap');
        this.epoch = clock.epoch;
        this.lastSeq = clock.lastSeq;
        continue;
      }

      while (this.lastSeq < clock.lastSeq) {
        if (generation !== this.generation || !this.connections.isAvailable()) return;
        const events = await this.repository.findAfter(clock.epoch, this.lastSeq, clock.lastSeq, 256);
        const first = events[0];
        if (!first || first.seq !== this.lastSeq + 1n) {
          await this.connections.resyncAll(clock.watermarkId, 'outbox_gap');
          this.lastSeq = clock.lastSeq;
          break;
        }
        for (const event of events) {
          if (generation !== this.generation || !this.connections.isAvailable()) return;
          if (event.seq !== this.lastSeq + 1n || event.schemaVersion !== 1 || !isRealtimeEventType(event.eventType)) {
            await this.connections.resyncAll(clock.watermarkId, 'unknown_or_out_of_order_event');
            this.lastSeq = clock.lastSeq;
            break;
          }
          await this.connections.publish(event);
          this.lastSeq = event.seq;
        }
      }
    } while (this.dirty && generation === this.generation && this.connections.isAvailable());
  }
}
