import { Client, type Notification } from 'pg';

export const REALTIME_CHANNEL = 'tms_realtime_outbox';

export type RealtimeListenerHandlers = {
  onNotification: (notification: Notification) => void;
  onLoss: (error: Error) => void;
};

export async function connectRealtimeListener(connectionString: string, handlers: RealtimeListenerHandlers): Promise<Client> {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 2_000,
    query_timeout: 3_000,
    application_name: 'task-management-realtime-listener',
  });
  client.on('notification', handlers.onNotification);
  client.on('error', handlers.onLoss);
  client.on('end', () => handlers.onLoss(new Error('PostgreSQL LISTEN connection ended.')));
  try {
    await client.connect();
    await client.query(`LISTEN ${REALTIME_CHANNEL}`);
    return client;
  } catch (error) {
    client.removeAllListeners();
    await client.end().catch(() => undefined);
    throw error;
  }
}
