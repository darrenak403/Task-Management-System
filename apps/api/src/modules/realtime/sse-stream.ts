import type { Response } from 'express';
import type { RealtimeEvent } from '../../generated/prisma/client.js';
import type { RealtimeStreamSink } from './connection-registry.js';

const MAX_EVENT_BYTES = 4 * 1_024;
const MAX_QUEUE_EVENTS = 64;
const MAX_QUEUE_BYTES = 256 * 1_024;
const HEARTBEAT_MS = 15_000;
const TERMINAL_DRAIN_TIMEOUT_MS = 2_000;
const MAX_TIMER_MS = 2_147_000_000;

type QueuedFrame = { text: string; bytes: number; eventSeq?: bigint };

function formatFrame(event: string, id: string | undefined, data: unknown): QueuedFrame {
  const fields = [
    ...(id ? [`id: ${id}`] : []),
    `event: ${event}`,
    `data: ${JSON.stringify(data)}`,
    '',
    '',
  ];
  const text = fields.join('\n');
  return { text, bytes: Buffer.byteLength(text, 'utf8') };
}

function publicEvent(event: RealtimeEvent): Record<string, unknown> {
  return {
    eventId: event.id,
    schemaVersion: event.schemaVersion,
    type: event.eventType,
    ...(event.workspaceId ? { workspaceId: event.workspaceId } : {}),
    ...(event.teamId ? { teamId: event.teamId } : {}),
    ...(event.resourceId ? { resourceId: event.resourceId } : {}),
    payload: event.payload,
  };
}

export class SseStream implements RealtimeStreamSink {
  private readonly queue: QueuedFrame[] = [];
  private queueBytes = 0;
  private blocked = false;
  private holdingLiveEvents = true;
  private terminal = false;
  private endAfterQueue = false;
  private closed = false;
  private cleaned = false;
  private barrierSeq: bigint | null = null;
  private expiryTimer: NodeJS.Timeout | undefined;
  private terminalCloseTimer: NodeJS.Timeout | undefined;
  private readonly heartbeat: NodeJS.Timeout;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly response: Response, private readonly onClose: () => void) {
    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store, no-transform');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();
    if (!response.write('retry: 3000\n\n')) this.blocked = true;
    response.on('drain', this.onDrain);
    response.once('close', this.onResponseClose);
    response.once('finish', this.onResponseClose);
    this.heartbeat = setInterval(() => {
      if (this.closed || this.blocked) return;
      if (!response.write(': keep-alive\n\n')) this.blocked = true;
    }, HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  startExpiry(expiresAt: Date): void {
    const schedule = (): void => {
      if (this.closed) return;
      const remaining = expiresAt.getTime() - Date.now();
      if (remaining <= 0) {
        void this.control('auth.expired', undefined, { reason: 'session_expired' }).then(() => this.end());
        return;
      }
      this.expiryTimer = setTimeout(schedule, Math.min(remaining, MAX_TIMER_MS));
      this.expiryTimer.unref();
    };
    schedule();
  }

  async control(event: string, id?: string, data: unknown = {}): Promise<void> {
    if (this.closed || (this.terminal && event !== 'resync_required')) return;
    const frame = formatFrame(event, id, data);
    if (['auth.expired', 'resync_required', 'server.unavailable', 'server.draining'].includes(event)) {
      this.terminateWithFrame(frame);
      return;
    }
    while (this.blocked && !this.closed) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    if (!this.closed && (!this.terminal || event === 'resync_required')) this.write(frame);
  }

  async offer(event: RealtimeEvent): Promise<void> {
    if (this.closed || this.terminal) return;
    const frame = formatFrame(event.eventType, event.id, publicEvent(event));
    if (frame.bytes > MAX_EVENT_BYTES) {
      this.requestResync(event.id, 'event_too_large');
      return;
    }
    if (event.eventType === 'auth.revoked' || event.eventType === 'access.changed') {
      this.terminateWithFrame(frame);
      return;
    }
    if (this.barrierSeq !== null && event.seq <= this.barrierSeq) return;
    this.enqueueOrWrite({ ...frame, eventSeq: event.seq }, event.id);
  }

  async sendReplay(event: RealtimeEvent): Promise<void> {
    if (this.closed || this.terminal) return;
    const frame = formatFrame(event.eventType, event.id, publicEvent(event));
    if (frame.bytes > MAX_EVENT_BYTES) {
      this.requestResync(event.id, 'event_too_large');
      return;
    }
    if (event.eventType === 'auth.revoked' || event.eventType === 'access.changed') {
      this.terminateWithFrame(frame);
      return;
    }
    while (this.blocked && !this.closed) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    if (!this.closed) this.write(frame);
    if (this.blocked && !this.closed) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }

  prepareBarrier(afterSeq: bigint): void {
    if (this.closed) return;
    this.barrierSeq = afterSeq;
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      if (this.queue[index]?.eventSeq !== undefined && this.queue[index]!.eventSeq! <= afterSeq) {
        this.queueBytes -= this.queue[index]?.bytes ?? 0;
        this.queue.splice(index, 1);
      }
    }
  }

  activate(): void {
    if (this.closed) return;
    this.holdingLiveEvents = false;
    this.flushQueue();
  }

  end(): void {
    if (this.closed) return;
    this.endAfterQueue = true;
    if (!this.blocked && !this.holdingLiveEvents) this.flushQueue();
    else if (!this.blocked && this.queue.length === 0) this.finishResponse();
  }

  get isClosed(): boolean {
    return this.closed;
  }

  get isTerminal(): boolean {
    return this.terminal;
  }

  private enqueueOrWrite(frame: QueuedFrame, eventId?: string): void {
    if (this.closed) return;
    if (!this.blocked && !this.holdingLiveEvents && this.queue.length === 0) {
      this.write(frame);
      return;
    }
    if (this.queue.length >= MAX_QUEUE_EVENTS || this.queueBytes + frame.bytes > MAX_QUEUE_BYTES) {
      this.requestResync(eventId, 'slow_client');
      return;
    }
    this.queue.push(frame);
    this.queueBytes += frame.bytes;
    void eventId;
    if (!this.holdingLiveEvents && !this.blocked) this.flushQueue();
  }

  private requestResync(id: string | undefined, reason: string): void {
    if (this.closed || this.terminal) return;
    this.terminal = true;
    this.queue.length = 0;
    this.queueBytes = 0;
    this.holdingLiveEvents = false;
    const frame = formatFrame('resync_required', id, { reason });
    this.queue.push(frame);
    this.queueBytes = frame.bytes;
    this.endAfterQueue = true;
    if (this.blocked) this.scheduleTerminalClose();
    if (!this.blocked) this.flushQueue();
  }

  private terminateWithFrame(frame: QueuedFrame): void {
    if (this.closed) return;
    this.terminal = true;
    this.holdingLiveEvents = false;
    this.queue.length = 0;
    this.queueBytes = 0;
    this.endAfterQueue = true;
    if (this.blocked) {
      this.queue.push(frame);
      this.queueBytes = frame.bytes;
      this.scheduleTerminalClose();
      return;
    }
    this.write(frame);
    if (!this.blocked) this.finishResponse();
    else this.scheduleTerminalClose();
  }

  private write(frame: QueuedFrame): void {
    if (this.closed) return;
    try {
      if (!this.response.write(frame.text)) this.blocked = true;
    } catch {
      this.finishResponse();
    }
  }

  private flushQueue(): void {
    if (this.closed || this.blocked || this.holdingLiveEvents) return;
    while (this.queue.length > 0 && !this.blocked) {
      const frame = this.queue.shift();
      if (!frame) break;
      this.queueBytes -= frame.bytes;
      this.write(frame);
    }
    if (this.blocked && this.endAfterQueue) this.scheduleTerminalClose();
    if (!this.blocked && this.queue.length === 0 && this.endAfterQueue) this.finishResponse();
  }

  private readonly onDrain = (): void => {
    this.blocked = false;
    for (const resolve of this.waiters.splice(0)) resolve();
    this.flushQueue();
  };

  private readonly onResponseClose = (): void => {
    this.cleanup();
  };

  private scheduleTerminalClose(): void {
    if (this.terminalCloseTimer || this.closed) return;
    this.terminalCloseTimer = setTimeout(() => {
      this.terminalCloseTimer = undefined;
      if (this.closed) return;
      this.response.destroy();
      this.cleanup();
    }, TERMINAL_DRAIN_TIMEOUT_MS);
    this.terminalCloseTimer.unref();
  }

  private finishResponse(): void {
    if (this.closed) return;
    this.closed = true;
    this.response.end();
    this.cleanup();
  }

  private cleanup(): void {
    if (this.cleaned) return;
    this.closed = true;
    this.cleaned = true;
    clearInterval(this.heartbeat);
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    if (this.terminalCloseTimer) clearTimeout(this.terminalCloseTimer);
    this.response.off('drain', this.onDrain);
    this.response.off('close', this.onResponseClose);
    this.response.off('finish', this.onResponseClose);
    this.queue.length = 0;
    this.queueBytes = 0;
    for (const resolve of this.waiters.splice(0)) resolve();
    this.onClose();
  }
}
