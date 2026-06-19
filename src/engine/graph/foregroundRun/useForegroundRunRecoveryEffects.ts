import { useEffect } from 'react';
import { selectTerminalBackgroundReviewCandidates } from '../terminalBackgroundReviewEligibility';
import {
  selectTerminalConversationsWithFinalResponseGaps,
  selectTerminalFinalResponseRecoveryCandidates,
} from '../terminalFinalResponseRecovery';
import type { EnsureAgentRunFinalResponse, ResolvedFinalizationProviderContext } from './contracts';
import { getReviewableSubAgentsForRun } from '../../../services/agents/subAgentRunTracking';
import type { Conversation } from '../../../types/conversation';

type ResolveConversationFinalizationContext = (
  conversation: Conversation,
) => Promise<ResolvedFinalizationProviderContext | undefined>;

type QueueTerminalBackgroundReview = (params: {
  conversationId: string;
  runId: string;
  timestamp?: number;
}) => Promise<void>;

export function useForegroundRunRecoveryEffects(params: {
  conversations: Conversation[];
  ensureAgentRunFinalResponse: EnsureAgentRunFinalResponse;
  queueTerminalBackgroundReview: QueueTerminalBackgroundReview;
  resolveConversationFinalizationContext: ResolveConversationFinalizationContext;
  subAgentActivityVersion: number;
}) {
  const {
    conversations,
    ensureAgentRunFinalResponse,
    queueTerminalBackgroundReview,
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
          await ensureAgentRunFinalResponse({
            conversationId: candidate.conversationId,
            runId: candidate.runId,
            status: candidate.status,
            providerContext,
            timestamp: candidate.timestamp,
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
  }, [conversations, ensureAgentRunFinalResponse, resolveConversationFinalizationContext]);
}
