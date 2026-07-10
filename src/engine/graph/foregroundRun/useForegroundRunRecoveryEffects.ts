import { useEffect } from 'react';
import { selectTerminalBackgroundReviewCandidates } from '../terminalBackgroundReviewEligibility';
import {
  selectTerminalConversationsWithFinalResponseGaps,
  selectTerminalFinalResponseRecoveryCandidates,
  type TerminalFinalResponseRecoveryCandidate,
} from '../terminalFinalResponseRecovery';
import type { EnsureAgentRunFinalResponse, ResolvedFinalizationProviderContext } from './contracts';
import { getReviewableSubAgentsForRun } from '../../../services/agents/subAgentRunTracking';
import { resolveConversationWorkspaceTarget } from '../../../services/conversationWorkspace/ownership';
import type { Conversation } from '../../../types/conversation';
import type { RecordConversationTurnMemory } from '../../../screens/chatTurnMemory';

type ResolveConversationFinalizationContext = (
  conversation: Conversation,
) => Promise<ResolvedFinalizationProviderContext | undefined>;

type QueueTerminalBackgroundReview = (params: {
  conversationId: string;
  runId: string;
  timestamp?: number;
}) => Promise<void>;

export async function recoverTerminalFinalResponse(params: {
  candidate: TerminalFinalResponseRecoveryCandidate;
  conversations: ReadonlyArray<Conversation>;
  ensureAgentRunFinalResponse: EnsureAgentRunFinalResponse;
  providerContext: ResolvedFinalizationProviderContext | undefined;
  recordConversationTurnMemory: RecordConversationTurnMemory;
}): Promise<string | undefined> {
  const workspaceTarget = resolveConversationWorkspaceTarget({
    conversationId: params.candidate.conversationId,
    conversations: params.conversations,
  });
  const preview = await params.ensureAgentRunFinalResponse({
    conversationId: params.candidate.conversationId,
    runId: params.candidate.runId,
    status: params.candidate.status,
    providerContext: params.providerContext,
    timestamp: params.candidate.timestamp,
  });
  if (preview) {
    params.recordConversationTurnMemory(
      params.candidate.conversationId,
      params.providerContext
        ? { ...params.providerContext.provider, model: params.providerContext.model }
        : undefined,
      {
        memoryConversationId: workspaceTarget.workspaceConversationId,
        sourceRunId: params.candidate.runId,
      },
    );
  }
  return preview;
}

export function useForegroundRunRecoveryEffects(params: {
  conversations: Conversation[];
  ensureAgentRunFinalResponse: EnsureAgentRunFinalResponse;
  queueTerminalBackgroundReview: QueueTerminalBackgroundReview;
  recordConversationTurnMemory: RecordConversationTurnMemory;
  resolveConversationFinalizationContext: ResolveConversationFinalizationContext;
  subAgentActivityVersion: number;
}) {
  const {
    conversations,
    ensureAgentRunFinalResponse,
    queueTerminalBackgroundReview,
    recordConversationTurnMemory,
    resolveConversationFinalizationContext,
    subAgentActivityVersion,
  } = params;

  useEffect(() => {
    for (const candidate of selectTerminalBackgroundReviewCandidates({
      conversations,
      getReviewableWorkers: getReviewableSubAgentsForRun,
    })) {
      void queueTerminalBackgroundReview(candidate);
    }
  }, [conversations, queueTerminalBackgroundReview, subAgentActivityVersion]);

  useEffect(() => {
    const terminalConversations = selectTerminalConversationsWithFinalResponseGaps(conversations);
    if (!terminalConversations.length) {
      return;
    }

    let cancelled = false;
    void (async () => {
      for (const conversation of terminalConversations) {
        const providerContext = await resolveConversationFinalizationContext(conversation);
        if (cancelled) {
          return;
        }

        for (const candidate of selectTerminalFinalResponseRecoveryCandidates({
          conversation,
          hasProviderContext: !!providerContext,
        })) {
          await recoverTerminalFinalResponse({
            candidate,
            conversations,
            ensureAgentRunFinalResponse,
            providerContext,
            recordConversationTurnMemory,
          });

          if (cancelled) {
            return;
          }
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    conversations,
    ensureAgentRunFinalResponse,
    recordConversationTurnMemory,
    resolveConversationFinalizationContext,
  ]);
}
