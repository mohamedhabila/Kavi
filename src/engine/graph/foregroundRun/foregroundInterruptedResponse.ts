import {
  type AgentControlGraphInterruptedResponseOutcome,
  buildAgentControlGraphInterruptedOutcome,
  buildAgentControlGraphInterruptedTurnFailedOutcome,
  buildAgentControlGraphProviderRejectedInterruptedOutcome,
} from '../interruptedResponseRecovery';
import { getAgentRunPendingAsyncOperations } from '../../../services/agents/agentRunAsyncState';
import { isNonRetryableProviderRequestError } from '../../../services/llm/support/requestErrors';
import { useChatStore } from '../../../store/useChatStore';

/**
 * How a foreground run ends when its model stream failed after the engine's own retries.
 * It fails. A run with finished tool work used to be read as completed and resumed with tools
 * disabled and "deliver the final answer now", so a model cut off mid-task answered without
 * the tools it still needed; the work it finished stays visible as done instead.
 */
export function resolveForegroundInterruptedResponseOutcome(params: {
  conversationId: string;
  error: Error;
  runId?: string;
}): AgentControlGraphInterruptedResponseOutcome {
  if (isNonRetryableProviderRequestError(params.error)) {
    return buildAgentControlGraphProviderRejectedInterruptedOutcome(params.error.message);
  }

  const targetRun = params.runId
    ? useChatStore
        .getState()
        .conversations.find((candidate) => candidate.id === params.conversationId)
        ?.agentRuns?.find((candidate) => candidate.id === params.runId)
    : undefined;
  if (!targetRun) {
    return buildAgentControlGraphInterruptedTurnFailedOutcome(params.error.message);
  }

  return buildAgentControlGraphInterruptedOutcome({
    errorMessage: params.error.message,
    pendingOperations: getAgentRunPendingAsyncOperations(targetRun),
  });
}
