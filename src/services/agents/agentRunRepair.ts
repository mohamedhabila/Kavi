import { useChatStore } from '../../store/useChatStore';
import { flushChatStorePersistenceNow } from '../../store/chatStorePersistence';
import {
  buildAgentRunMessageScope,
  hasDeliveredFinalAssistantResponse,
} from './lifecycle/agentRunStateMachine';
import { buildAgentControlGraphAfterPersistedFinalDelivery } from '../../engine/graph/persistedFinalDelivery';

function reconcilePersistedCompletedRunGraph(params: {
  conversationId: string;
  runId: string;
}): boolean {
  const store = useChatStore.getState();
  const conversation = store.conversations.find(
    (candidate) => candidate.id === params.conversationId,
  );
  const run = conversation?.agentRuns?.find((candidate) => candidate.id === params.runId);
  if (!conversation || !run || run.status !== 'completed' || !run.controlGraph) {
    return false;
  }
  const reconciledGraph = buildAgentControlGraphAfterPersistedFinalDelivery({
    messages: conversation.messages,
    run,
    terminalReason: run.controlGraph.terminalReason,
  });
  if (!reconciledGraph || reconciledGraph === run.controlGraph) return false;

  store.updateAgentRunControlGraph(params.conversationId, reconciledGraph, params.runId);
  const updatedRun = useChatStore
    .getState()
    .conversations.find((candidate) => candidate.id === params.conversationId)
    ?.agentRuns?.find((candidate) => candidate.id === params.runId);
  return updatedRun?.status === 'completed' && updatedRun.controlGraph?.status === 'finalized';
}

/**
 * Settles the graph of every completed run whose final answer was persisted before the app
 * stopped, so a restart never leaves a delivered run looking unfinished. A run that ended
 * without an answer is left as it ended: nothing writes an answer for it.
 */
export async function reconcileCompletedAgentRunGraphs(): Promise<string[]> {
  const reconciledRunIds: string[] = [];

  for (const conversation of useChatStore.getState().conversations) {
    for (const run of conversation.agentRuns ?? []) {
      if (
        run.status !== 'completed' ||
        !hasDeliveredFinalAssistantResponse(conversation.messages, buildAgentRunMessageScope(run))
      ) {
        continue;
      }
      if (reconcilePersistedCompletedRunGraph({ conversationId: conversation.id, runId: run.id })) {
        reconciledRunIds.push(run.id);
      }
    }
  }

  if (reconciledRunIds.length > 0) {
    await flushChatStorePersistenceNow();
  }
  return reconciledRunIds;
}
