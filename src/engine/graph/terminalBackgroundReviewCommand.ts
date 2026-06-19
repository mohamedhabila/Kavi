import type { Conversation } from '../../types/conversation';
import {
  buildAgentControlGraphTerminalBackgroundReviewContext,
  type AgentControlGraphTerminalBackgroundReviewContext,
} from './terminalBackgroundReviewContext';
import type { ReviewableWorkerSnapshots } from './terminalBackgroundReviewEligibility';

export type AgentControlGraphTerminalBackgroundReviewCommand =
  | { type: 'none' }
  | {
      type: 'finalize';
      context: AgentControlGraphTerminalBackgroundReviewContext;
    };

export function resolveAgentControlGraphTerminalBackgroundReviewCommand(params: {
  conversation: Conversation;
  runId: string;
  workers: ReviewableWorkerSnapshots;
  timestamp: number;
  canResume?: boolean;
}): AgentControlGraphTerminalBackgroundReviewCommand {
  const context = buildAgentControlGraphTerminalBackgroundReviewContext({
    conversation: params.conversation,
    runId: params.runId,
    workers: params.workers,
  });
  if (!context) {
    return { type: 'none' };
  }

  return {
    type: 'finalize',
    context,
  };
}
