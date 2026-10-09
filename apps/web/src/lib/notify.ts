import { toast } from 'sonner';

import { errorMessage, isAccessLost } from './api-errors';
import { invalidationBus, topics } from './realtime/invalidation-bus';

/**
 * Reports a failed write. When the API says the scope is gone (403/404), the workspace, team
 * and member lists are reloaded so nothing the user can no longer access stays on screen.
 */
export function notifyWriteError(error: unknown, fallback?: string): void {
  toast.error(errorMessage(error, fallback));
  if (isAccessLost(error)) {
    invalidationBus.publish(topics.structure);
    invalidationBus.publish(topics.members);
  }
}
