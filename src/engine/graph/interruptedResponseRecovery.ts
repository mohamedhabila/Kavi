import type { AgentRunAsyncOperation } from '../../types/agentRun';
import { buildAgentControlGraphInterruptedOpenWorkRecovery } from './asyncOpenWork';

/**
 * How a run whose model stream failed after the engine's own retries ends. It always fails:
 * work it finished is shown as done, and the person carries the task on from there. A run
 * still waiting on async operations stays open so their results can land.
 */
export type AgentControlGraphInterruptedResponseOutcome = {
  status: 'failed';
  checkpointTitle: string;
  checkpointDetail: string;
  keepRunOpen?: 'async-operations';
};

export function buildAgentControlGraphProviderRejectedInterruptedOutcome(
  errorMessage: string,
): AgentControlGraphInterruptedResponseOutcome {
  return {
    status: 'failed',
    checkpointTitle: 'Provider request rejected',
    checkpointDetail: errorMessage,
  };
}

export function buildAgentControlGraphInterruptedTurnFailedOutcome(
  errorMessage: string,
): AgentControlGraphInterruptedResponseOutcome {
  return {
    status: 'failed',
    checkpointTitle: 'Turn failed',
    checkpointDetail: errorMessage,
  };
}

export function buildAgentControlGraphInterruptedOutcome(params: {
  errorMessage: string;
  pendingOperations: ReadonlyArray<AgentRunAsyncOperation>;
}): AgentControlGraphInterruptedResponseOutcome {
  const openWorkRecovery = buildAgentControlGraphInterruptedOpenWorkRecovery({
    pendingOperations: params.pendingOperations,
  });

  if (openWorkRecovery) {
    return {
      status: 'failed',
      ...openWorkRecovery,
    };
  }

  return buildAgentControlGraphInterruptedTurnFailedOutcome(params.errorMessage);
}
