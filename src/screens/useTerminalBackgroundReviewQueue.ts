import { useCallback, type MutableRefObject } from 'react';
import { resolveAgentControlGraphTerminalBackgroundReviewCommand } from '../engine/graph/terminalBackgroundReviewCommand';
import {
  createAgentRunOperationController,
  isAbortErrorLike,
  throwIfAbortSignalTriggered,
} from '../services/agents/agentRunCancellation';
import { useChatStore } from '../store/useChatStore';
import type { Conversation } from '../types/conversation';
import type {
  EnsureAgentRunFinalResponse,
  ResolvedFinalizationProviderContext,
  ResumeAgentRun,
} from '../engine/graph/foregroundRun/contracts';
import { getReviewableSubAgentsForRun } from '../services/agents/subAgentRunTracking';
import type { QueueTerminalBackgroundReview } from './subAgentRunBridgeTypes';
import { handleTerminalBackgroundReview } from './terminalBackgroundReviewHandler';

type ChatStore = ReturnType<typeof useChatStore.getState>;

export function useTerminalBackgroundReviewQueue(params: {
  appendConversationLog: ChatStore['addConversationLog'];
  completeAgentRun: ChatStore['completeAgentRun'];
  ensureAgentRunFinalResponseRef: MutableRefObject<EnsureAgentRunFinalResponse | null>;
  pendingAgentRunTerminalReviewsRef: MutableRefObject<Map<string, Promise<void>>>;
  resolveConversationFinalizationContextRef: MutableRefObject<
    | ((conversation: Conversation) => Promise<ResolvedFinalizationProviderContext | undefined>)
    | null
  >;
  resumeAgentRunRef: MutableRefObject<ResumeAgentRun | null>;
  setAgentRunPhase: ChatStore['setAgentRunPhase'];
  updateAgentRunAsyncWork: ChatStore['updateAgentRunAsyncWork'];
  updateAgentRunControlGraph: ChatStore['updateAgentRunControlGraph'];
  updateAgentRunSummary: ChatStore['updateAgentRunSummary'];
  updateMessageAssistantMetadata: ChatStore['updateMessageAssistantMetadata'];
}): QueueTerminalBackgroundReview {
  const {
    appendConversationLog,
    completeAgentRun,
    ensureAgentRunFinalResponseRef,
    pendingAgentRunTerminalReviewsRef,
    resolveConversationFinalizationContextRef,
    resumeAgentRunRef,
    setAgentRunPhase,
    updateAgentRunAsyncWork,
    updateAgentRunControlGraph,
    updateAgentRunSummary,
    updateMessageAssistantMetadata,
  } = params;

  return useCallback(
    (candidate): Promise<void> => {
      const inFlight = pendingAgentRunTerminalReviewsRef.current.get(candidate.runId);
      if (inFlight) {
        return inFlight;
      }

      const reviewPromise = runTerminalBackgroundReview({
        appendConversationLog,
        candidate,
        completeAgentRun,
        ensureAgentRunFinalResponseRef,
        pendingAgentRunTerminalReviewsRef,
        resolveConversationFinalizationContextRef,
        resumeAgentRunRef,
        setAgentRunPhase,
        updateAgentRunAsyncWork,
        updateAgentRunControlGraph,
        updateAgentRunSummary,
        updateMessageAssistantMetadata,
      });
      pendingAgentRunTerminalReviewsRef.current.set(candidate.runId, reviewPromise);
      return reviewPromise;
    },
    [
      appendConversationLog,
      completeAgentRun,
      ensureAgentRunFinalResponseRef,
      pendingAgentRunTerminalReviewsRef,
      resolveConversationFinalizationContextRef,
      resumeAgentRunRef,
      setAgentRunPhase,
      updateAgentRunAsyncWork,
      updateAgentRunControlGraph,
      updateAgentRunSummary,
      updateMessageAssistantMetadata,
    ],
  );
}

async function runTerminalBackgroundReview(params: {
  appendConversationLog: ChatStore['addConversationLog'];
  candidate: Parameters<QueueTerminalBackgroundReview>[0];
  completeAgentRun: ChatStore['completeAgentRun'];
  ensureAgentRunFinalResponseRef: MutableRefObject<EnsureAgentRunFinalResponse | null>;
  pendingAgentRunTerminalReviewsRef: MutableRefObject<Map<string, Promise<void>>>;
  resolveConversationFinalizationContextRef: MutableRefObject<
    | ((conversation: Conversation) => Promise<ResolvedFinalizationProviderContext | undefined>)
    | null
  >;
  resumeAgentRunRef: MutableRefObject<ResumeAgentRun | null>;
  setAgentRunPhase: ChatStore['setAgentRunPhase'];
  updateAgentRunAsyncWork: ChatStore['updateAgentRunAsyncWork'];
  updateAgentRunControlGraph: ChatStore['updateAgentRunControlGraph'];
  updateAgentRunSummary: ChatStore['updateAgentRunSummary'];
  updateMessageAssistantMetadata: ChatStore['updateMessageAssistantMetadata'];
}): Promise<void> {
  const { candidate } = params;
  const operation = createAgentRunOperationController({
    conversationId: candidate.conversationId,
    runId: candidate.runId,
    operationId: 'background-review',
  });

  try {
    throwIfAbortSignalTriggered(operation.signal);

    const reviewTimestamp = candidate.timestamp ?? Date.now();
    const currentConversation = useChatStore
      .getState()
      .conversations.find((conversation) => conversation.id === candidate.conversationId);
    const targetRun = currentConversation?.agentRuns?.find((run) => run.id === candidate.runId);
    if (!currentConversation || !targetRun) {
      return;
    }

    const resumeAgentRun = params.resumeAgentRunRef.current;
    const reviewCommand = resolveAgentControlGraphTerminalBackgroundReviewCommand({
      conversation: currentConversation,
      runId: candidate.runId,
      workers: getReviewableSubAgentsForRun(currentConversation, targetRun),
      timestamp: reviewTimestamp,
      canResume: !!resumeAgentRun,
    });
    if (reviewCommand.type === 'none') {
      return;
    }

    throwIfAbortSignalTriggered(operation.signal);

    await handleTerminalBackgroundReview({
      appendConversationLog: params.appendConversationLog,
      assertNotAborted: () => throwIfAbortSignalTriggered(operation.signal),
      completeAgentRun: params.completeAgentRun,
      context: reviewCommand.context,
      conversationId: candidate.conversationId,
      ensureAgentRunFinalResponse: params.ensureAgentRunFinalResponseRef.current,
      resumeAgentRun,
      reviewTimestamp,
      runId: candidate.runId,
      setAgentRunPhase: params.setAgentRunPhase,
      signal: operation.signal,
      updateAgentRunAsyncWork: params.updateAgentRunAsyncWork,
      updateAgentRunSummary: params.updateAgentRunSummary,
      updateMessageAssistantMetadata: params.updateMessageAssistantMetadata,
    });
  } catch (error) {
    if (!isAbortErrorLike(error, operation.signal)) {
      throw error;
    }
  } finally {
    operation.dispose();
    params.pendingAgentRunTerminalReviewsRef.current.delete(candidate.runId);
  }
}
