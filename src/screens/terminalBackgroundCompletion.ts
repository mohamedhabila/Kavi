import { useChatStore } from '../store/useChatStore';
import { isAgentRunAwaitingBackgroundWorkers } from '../services/agents/agentRunAsyncState';
import { AgentRun } from '../types/agentRun';
import { ConversationLogEntry } from '../types/conversation';
import { applyConversationRunCompletionEffect } from '../engine/graph/applyRunCompletionEffect';
import { reduceAgentControlGraph } from '../engine/graph/agentControlGraph';
import { isAgentControlGraphAtPersistedFinalDeliveryBoundary } from '../engine/graph/persistedFinalDelivery';
import {
  buildAgentRunMessageScope,
  getLatestAssistantProjectionFinalResponsePreview,
} from '../services/agents/lifecycle/agentRunStateMachine';

type ChatStore = ReturnType<typeof useChatStore.getState>;

export function completeTerminalBackgroundReviewRun(params: {
  appendConversationLog: (
    conversationId: string,
    entry: {
      title: string;
      detail?: string;
      level?: ConversationLogEntry['level'];
      kind?: ConversationLogEntry['kind'];
      timestamp?: number;
    },
  ) => void;
  completeAgentRun: ChatStore['completeAgentRun'];
  updateAgentRunControlGraph: ChatStore['updateAgentRunControlGraph'];
  completion: {
    checkpointDetail?: string;
    checkpointTitle: string;
    latestSummary: string;
    logDetail?: string;
    logLevel: ConversationLogEntry['level'];
    logTitle: string;
    status: Exclude<AgentRun['status'], 'running'>;
  };
  conversationId: string;
  reviewTimestamp: number;
  runId: string;
  targetRun: AgentRun;
}): boolean {
  const latestRunState = useChatStore
    .getState()
    .conversations.find((candidate) => candidate.id === params.conversationId)
    ?.agentRuns?.find((candidate) => candidate.id === params.runId);
  if (
    !latestRunState ||
    latestRunState.status !== 'running' ||
    !isAgentRunAwaitingBackgroundWorkers(latestRunState)
  ) {
    return false;
  }
  const latestConversation = useChatStore
    .getState()
    .conversations.find((candidate) => candidate.id === params.conversationId);
  if (
    !latestConversation ||
    !getLatestAssistantProjectionFinalResponsePreview(
      latestConversation.messages,
      buildAgentRunMessageScope(latestRunState),
    )
  ) {
    return false;
  }
  const completed = applyConversationRunCompletionEffect({
    actions: {
      completeAgentRun: params.completeAgentRun,
      updateAgentRunControlGraph: params.updateAgentRunControlGraph,
    },
    conversationId: params.conversationId,
    effect: {
      status: params.completion.status,
      latestSummary: params.completion.latestSummary,
      checkpointTitle: params.completion.checkpointTitle,
      checkpointDetail: params.completion.checkpointDetail,
      summary: {
        durationMs: Math.max(0, params.reviewTimestamp - params.targetRun.createdAt),
      },
      timestamp: params.reviewTimestamp,
    },
    getLatestConversation: () =>
      useChatStore
        .getState()
        .conversations.find((candidate) => candidate.id === params.conversationId),
    prepareControlGraph: (controlGraph) => {
      if (
        (controlGraph.status !== 'waiting_async' && controlGraph.status !== 'ready') ||
        controlGraph.expectedToolCalls.length !== 0 ||
        controlGraph.observedToolResults.length !== 0 ||
        controlGraph.pendingAsyncCount !== 0 ||
        controlGraph.asyncWork.pendingOperations.length !== 0
      ) {
        return undefined;
      }
      const reviewReadyGraph = reduceAgentControlGraph(controlGraph, [
        {
          type: 'ASYNC_WAITING',
          pendingAsyncCount: 0,
          pendingOperations: [],
          awaitingBackgroundWorkers: false,
          timestamp: params.reviewTimestamp,
        },
        {
          type: 'FINAL_CANDIDATE_READY',
          reason: 'background review settled',
          timestamp: params.reviewTimestamp,
        },
      ]);
      return isAgentControlGraphAtPersistedFinalDeliveryBoundary(reviewReadyGraph)
        ? reviewReadyGraph
        : undefined;
    },
    runId: params.runId,
  });
  if (!completed) return false;
  params.appendConversationLog(params.conversationId, {
    kind: 'state',
    level: params.completion.logLevel,
    title: params.completion.logTitle,
    detail: params.completion.logDetail,
    timestamp: params.reviewTimestamp,
  });

  return true;
}
