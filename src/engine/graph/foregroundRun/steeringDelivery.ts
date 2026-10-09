import type { Message } from '../../../types/message';
import type { SteeringQueue } from './steeringQueue';

/**
 * Hands a foreground run the messages queued for it. A message is delivered only once
 * the run's previous step has finished with tool calls: its next assistant message does
 * not exist yet, so the steer lands after the tool results and before the step that reads
 * it. Earlier — while the first step streams into its reserved message — it waits.
 */
export function createForegroundSteeringDelivery(params: {
  conversationId: string;
  runId: string;
  queue: Pick<SteeringQueue, 'take'>;
  /** The run is still current and its next assistant message has not started. */
  canDeliver: () => boolean;
  addMessage: (conversationId: string, message: Message) => void;
  now?: () => number;
}): { takeSteeringMessages: () => Message[] } {
  const now = params.now ?? Date.now;
  return {
    takeSteeringMessages: () => {
      if (!params.canDeliver()) return [];
      return params.queue.take(params.conversationId, params.runId).map((queued) => {
        const message: Message = {
          id: queued.id,
          role: 'user',
          content: queued.text,
          timestamp: now(),
          steerOfRunId: params.runId,
        };
        params.addMessage(params.conversationId, message);
        return message;
      });
    },
  };
}
