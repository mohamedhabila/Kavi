import { useCallback, useSyncExternalStore } from 'react';
import {
  appSteeringQueue,
  type QueuedSteeringMessage,
} from '../../engine/graph/foregroundRun/steeringQueue';

const NO_QUEUED_MESSAGES: ReadonlyArray<QueuedSteeringMessage> = Object.freeze([]);

/**
 * The messages waiting for the active conversation's run, and a way to take one back
 * into the composer to edit it before it is read.
 */
export function useQueuedSteering(params: {
  conversationId: string | null;
  returnTextToComposer: (conversationId: string, text: string) => void;
}): {
  queuedMessages: ReadonlyArray<QueuedSteeringMessage>;
  editQueuedMessage: (messageId: string) => void;
} {
  const { conversationId, returnTextToComposer } = params;
  const getSnapshot = useCallback(
    () => (conversationId ? appSteeringQueue.get(conversationId) : NO_QUEUED_MESSAGES),
    [conversationId],
  );
  const queuedMessages = useSyncExternalStore(appSteeringQueue.subscribe, getSnapshot, getSnapshot);
  const editQueuedMessage = useCallback(
    (messageId: string) => {
      if (!conversationId) return;
      const removed = appSteeringQueue.remove(conversationId, messageId);
      if (removed) returnTextToComposer(conversationId, removed.text);
    },
    [conversationId, returnTextToComposer],
  );
  return { queuedMessages, editQueuedMessage };
}
