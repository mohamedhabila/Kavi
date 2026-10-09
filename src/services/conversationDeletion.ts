import { waitForModelProjectionAvailability } from '../store/modelProjectionOwnership';
import { useChatStore } from '../store/useChatStore';
import { createLogger } from '../utils/logger';
import { hasConversationWork, stopConversationWork } from './conversationWorkStop';

const logger = createLogger('ConversationDeletion');

/**
 * How long a stopped reply may take to release the conversation before it is deleted
 * anyway. A stopped generation normally closes within a second; one that does not is
 * fenced off by projection ownership, which a deleted conversation no longer grants.
 */
const STOPPED_WORK_RELEASE_TIMEOUT_MS = 5_000;

/**
 * Deletes a conversation the user chose to remove, stopping anything still working in it
 * first. Deleting under a live reply would leave that generation writing into a
 * conversation that no longer exists, and its run recoverable on the next launch.
 */
export async function deleteConversationStoppingWork(conversationId: string): Promise<void> {
  const conversation = useChatStore
    .getState()
    .conversations.find((candidate) => candidate.id === conversationId);
  if (!conversation) return;

  if (hasConversationWork(conversation)) {
    await stopConversationWork(conversation);
    try {
      await waitForModelProjectionAvailability({
        conversationId,
        signal: new AbortController().signal,
        timeoutMs: STOPPED_WORK_RELEASE_TIMEOUT_MS,
      });
    } catch (error: unknown) {
      logger.warn('Stopped work did not release the conversation before deletion', {
        conversationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  useChatStore.getState().deleteConversation(conversationId);
}
