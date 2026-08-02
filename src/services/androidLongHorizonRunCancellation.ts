import { appForegroundRequestRegistry } from '../engine/graph/foregroundRun/requestRegistry';
import { stopForegroundConversationRuns } from '../engine/graph/foregroundConversationCancellation';
import { requestChatStorePersistenceCheckpoint } from '../store/chatStorePersistence';
import { useChatStore } from '../store/useChatStore';

/**
 * Reconciles a notification Stop request with the same durable graph state used by the Chat UI.
 * The native bridge already aborts process-local work; this closes persisted ownership so a
 * cancelled run cannot remain "working" or be recovered on the next activity mount.
 */
export async function terminalizeAndroidLongHorizonConversation(
  conversationId: string,
): Promise<boolean> {
  const conversation = useChatStore
    .getState()
    .conversations.find((candidate) => candidate.id === conversationId);
  if (!conversation) return false;

  const runningRunIds = new Set(
    conversation.agentRuns?.filter((run) => run.status === 'running').map((run) => run.id) ?? [],
  );
  if (runningRunIds.size === 0) {
    appForegroundRequestRegistry.clearForConversation(conversationId);
    return false;
  }

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
      getLatestConversation: (targetConversationId) =>
        useChatStore
          .getState()
          .conversations.find((candidate) => candidate.id === targetConversationId),
      updateAgentRunControlGraph: (targetConversationId, graph, runId) =>
        useChatStore.getState().updateAgentRunControlGraph(targetConversationId, graph, runId),
    },
    conversation,
    conversationId,
  });
  requestChatStorePersistenceCheckpoint(0);

  const latestConversation = useChatStore
    .getState()
    .conversations.find((candidate) => candidate.id === conversationId);
  return [...runningRunIds].every(
    (runId) =>
      latestConversation?.agentRuns?.find((run) => run.id === runId)?.status === 'cancelled',
  );
}
