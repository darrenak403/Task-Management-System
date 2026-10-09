import type { RealtimeEvent } from '../../generated/prisma/client.js';

export type RealtimeIdentity = {
  sessionId: string;
  sessionHash: string;
  expiresAt: Date;
  userId: string;
};

export type RealtimeScope = { workspaceId: string; teamId?: string };

export interface RealtimeStreamSink {
  offer(event: RealtimeEvent): Promise<void> | void;
  control(event: string, id?: string, data?: unknown): Promise<void> | void;
  end(): void;
}

type ActiveConnection = {
  identity: RealtimeIdentity;
  scope: RealtimeScope;
  sink: RealtimeStreamSink;
  authorize: (event: RealtimeEvent) => Promise<boolean>;
};

const MAX_CONNECTIONS = 100;
const MAX_PER_SESSION = 5;

export class RealtimeConnectionRegistry {
  private readonly connections = new Set<ActiveConnection>();
  private available = false;

  isAvailable(): boolean {
    return this.available;
  }

  setAvailable(available: boolean): void {
    this.available = available;
  }

  canRegister(identity: RealtimeIdentity): boolean {
    if (!this.available || this.connections.size >= MAX_CONNECTIONS) return false;
    let forSession = 0;
    for (const connection of this.connections) {
      if (connection.identity.sessionHash === identity.sessionHash) forSession += 1;
    }
    return forSession < MAX_PER_SESSION;
  }

  register(
    identity: RealtimeIdentity,
    scope: RealtimeScope,
    sink: RealtimeStreamSink,
    authorize: (event: RealtimeEvent) => Promise<boolean>,
  ): (() => void) | null {
    if (!this.canRegister(identity)) return null;

    const connection = { identity, scope, sink, authorize };
    this.connections.add(connection);
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      this.connections.delete(connection);
    };
  }

  async publish(event: RealtimeEvent): Promise<void> {
    const candidates = [...this.connections].filter((connection) => {
      if (event.targetSessionHash) return connection.identity.sessionHash === event.targetSessionHash;
      if (event.targetUserId) return connection.identity.userId === event.targetUserId;
      if (!event.workspaceId || event.workspaceId !== connection.scope.workspaceId) return false;
      if (!connection.scope.teamId) return true;
      return event.eventType === 'workspace.structure_changed' || event.teamId === connection.scope.teamId;
    });

    await Promise.all(candidates.map(async (connection) => {
      try {
        if (event.eventType !== 'auth.revoked' && !(await connection.authorize(event))) return;
        await connection.sink.offer(event);
        if (event.eventType === 'auth.revoked' || event.eventType === 'access.changed') {
          connection.sink.end();
        }
      } catch {
        connection.sink.end();
      }
    }));
  }

  async resyncAll(checkpointId: string, reason: string): Promise<void> {
    const connections = [...this.connections];
    await Promise.all(connections.map(async ({ sink }) => {
      try {
        await sink.control('resync_required', checkpointId, { reason });
      } finally {
        sink.end();
      }
    }));
  }

  async closeAll(event: 'server.unavailable' | 'server.draining', message: string): Promise<void> {
    this.available = false;
    const connections = [...this.connections];
    await Promise.all(connections.map(async ({ sink }) => {
      try {
        await sink.control(event, undefined, { message });
      } finally {
        sink.end();
      }
    }));
  }

  get size(): number {
    return this.connections.size;
  }
}
