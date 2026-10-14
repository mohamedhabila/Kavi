import { useCallback, type MutableRefObject } from 'react';
import { resolveAgentControlGraphTerminalBackgroundReviewCommand } from '../engine/graph/terminalBackgroundReviewCommand';
import {
  createAgentRunOperationController,
  isAbortErrorLike,
  throwIfAbortSignalTriggered,
} from '../services/agents/agentRunCancellation';
import { createAgentRunIdentityKey } from '../services/agents/agentRunIdentity';
import { useChatStore } from '../store/useChatStore';
import type { ResumeAgentRun } from '../engine/graph/foregroundRun/contracts';
import { getReviewableSubAgentsForRun } from '../services/agents/subAgentRunTracking';
import type { QueueTerminalBackgroundReview } from './subAgentRunBridgeTypes';
import { handleTerminalBackgroundReview } from './terminalBackgroundReviewHandler';
import type { RecordConversationTurnMemory } from '../services/memory/core/memoryCapture';
import { flushChatStorePersistenceNow } from '../store/chatStorePersistence';

type ChatStore = ReturnType<typeof useChatStore.getState>;

export function useTerminalBackgroundReviewQueue(params: {
  appendConversationLog: ChatStore['addConversationLog'];
  completeAgentRun: ChatStore['completeAgentRun'];
  pendingAgentRunTerminalReviewsRef: MutableRefObject<Map<string, Promise<void>>>;
  recordConversationTurnMemory: RecordConversationTurnMemory;
  resumeAgentRunRef: MutableRefObject<ResumeAgentRun | null>;
  updateAgentRunControlGraph: ChatStore['updateAgentRunControlGraph'];
}): QueueTerminalBackgroundReview {
  const {
    appendConversationLog,
    completeAgentRun,
    pendingAgentRunTerminalReviewsRef,
    recordConversationTurnMemory,
    resumeAgentRunRef,
    updateAgentRunControlGraph,
  } = params;

  return useCallback(
    (candidate): Promise<void> => {
      const runIdentityKey = createAgentRunIdentityKey(candidate);
      const inFlight = pendingAgentRunTerminalReviewsRef.current.get(runIdentityKey);
      if (inFlight) {
        return inFlight;
      }

      const reviewPromise = Promise.resolve().then(() =>
        runTerminalBackgroundReview({
          appendConversationLog,
          candidate,
          completeAgentRun,
          recordConversationTurnMemory,
          resumeAgentRunRef,
          updateAgentRunControlGraph,
        }),
      );
      pendingAgentRunTerminalReviewsRef.current.set(runIdentityKey, reviewPromise);
      const releaseReview = () => {
        if (pendingAgentRunTerminalReviewsRef.current.get(runIdentityKey) === reviewPromise) {
          pendingAgentRunTerminalReviewsRef.current.delete(runIdentityKey);
        }
      };
      void reviewPromise.then(releaseReview, releaseReview);
      return reviewPromise;
    },
    [
      appendConversationLog,
      completeAgentRun,
      pendingAgentRunTerminalReviewsRef,
      recordConversationTurnMemory,
      resumeAgentRunRef,
      updateAgentRunControlGraph,
    ],
  );
}

async function runTerminalBackgroundReview(params: {
  appendConversationLog: ChatStore['addConversationLog'];
  candidate: Parameters<QueueTerminalBackgroundReview>[0];
  completeAgentRun: ChatStore['completeAgentRun'];
  recordConversationTurnMemory: RecordConversationTurnMemory;
  resumeAgentRunRef: MutableRefObject<ResumeAgentRun | null>;
  updateAgentRunControlGraph: ChatStore['updateAgentRunControlGraph'];
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
      flushChatState: flushChatStorePersistenceNow,
      recordConversationTurnMemory: params.recordConversationTurnMemory,
      resumeAgentRun,
      reviewTimestamp,
      runId: candidate.runId,
      updateAgentRunControlGraph: params.updateAgentRunControlGraph,
    });
  } catch (error) {
    if (!isAbortErrorLike(error, operation.signal)) {
      throw error;
    }
  } finally {
    operation.dispose();
  }
}
