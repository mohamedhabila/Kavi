import { appForegroundRequestRegistry } from '../engine/graph/foregroundRun/requestRegistry';
import { stopForegroundConversationRuns } from '../engine/graph/foregroundConversationCancellation';
import { useChatStore } from '../store/useChatStore';
import type { Conversation } from '../types/conversation';

function findConversation(conversationId: string): Conversation | undefined {
  return useChatStore.getState().conversations.find((candidate) => candidate.id === conversationId);
}

/**
 * Stops a conversation's foreground request and running agent runs from outside the chat
 * screen, through the same graph cancellation the Stop button uses, so a stopped run is
 * terminalized durably instead of staying "working" or being recovered on the next launch.
 */
export async function stopConversationWork(conversation: Conversation): Promise<void> {
  await stopForegroundConversationRuns({
    abortForegroundRequestForConversation: (targetConversationId, reason) =>
      appForegroundRequestRegistry.abortForConversation(targetConversationId, reason),
    actions: {
      appendConversationLog: (targetConversationId, entry) =>
        useChatStore.getState().addConversationLog(targetConversationId, entry),
      clearForegroundRequestForConversation: (targetConversationId) =>
        appForegroundRequestRegistry.clearForConversation(targetConversationId),
      clearPendingRunState: () => undefined,
      completeAgentRun: (targetConversationId, effect, runId) =>
        useChatStore.getState().completeAgentRun(targetConversationId, effect, runId),
      getLatestConversation: findConversation,
      updateAgentRunControlGraph: (targetConversationId, graph, runId) =>
        useChatStore.getState().updateAgentRunControlGraph(targetConversationId, graph, runId),
    },
    conversation,
    conversationId: conversation.id,
  });
}
