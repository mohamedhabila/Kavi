import { useEffect } from 'react';
import { selectTerminalBackgroundReviewCandidates } from '../terminalBackgroundReviewEligibility';
import { getReviewableSubAgentsForRun } from '../../../services/agents/subAgentRunTracking';
import type { Conversation } from '../../../types/conversation';

type QueueTerminalBackgroundReview = (params: {
  conversationId: string;
  runId: string;
  timestamp?: number;
}) => Promise<void>;

/**
 * Settles a run whose background workers have all finished. A run that ended without an
 * answer is not given one here: only the agent loop writes answers.
 */
export function useForegroundRunRecoveryEffects(params: {
  conversations: Conversation[];
  queueTerminalBackgroundReview: QueueTerminalBackgroundReview;
  subAgentActivityVersion: number;
}) {
  const { conversations, queueTerminalBackgroundReview, subAgentActivityVersion } = params;

  useEffect(() => {
    for (const candidate of selectTerminalBackgroundReviewCandidates({
      conversations,
      getReviewableWorkers: getReviewableSubAgentsForRun,
    })) {
      void queueTerminalBackgroundReview(candidate);
    }
  }, [conversations, queueTerminalBackgroundReview, subAgentActivityVersion]);
}
