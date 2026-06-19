import type {
  AgentRunAsyncOperation,
  AgentRunStatus,
  AgentRunTerminalReason,
} from '../../types/agentRun';
import { buildAgentControlGraphInterruptedOpenWorkRecovery } from './asyncOpenWork';

export const AGENT_CONTROL_GRAPH_INTERRUPTED_RESPONSE_CANDIDATE_SUMMARY =
  'The supervisor response stream was interrupted after tool work completed. Decide whether goals are satisfied or more work is required.';

export type AgentControlGraphInterruptedResponseOutcome = {
  status: Exclude<AgentRunStatus, 'running'>;
  checkpointTitle: string;
  checkpointDetail: string;
  resumePrompt?: string;
  resumeUserPrompt?: string;
  keepRunOpen?: 'async-operations';
  terminalReason?: AgentRunTerminalReason;
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

export function buildAgentControlGraphInterruptedNoEvidenceOutcome(params: {
  errorMessage: string;
  runningBackgroundWorkerCount: number;
  pendingOperations: ReadonlyArray<AgentRunAsyncOperation>;
}): AgentControlGraphInterruptedResponseOutcome {
  const openWorkRecovery = buildAgentControlGraphInterruptedOpenWorkRecovery({
    runningBackgroundWorkerCount: params.runningBackgroundWorkerCount,
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

export function buildAgentControlGraphInterruptedGoalsResumeOutcome(params: {
  checkpointTitle: string;
  checkpointDetail: string;
  resumePrompt: string;
  resumeUserPrompt?: string;
}): AgentControlGraphInterruptedResponseOutcome {
  return {
    status: 'failed',
    checkpointTitle: params.checkpointTitle,
    checkpointDetail: params.checkpointDetail,
    resumePrompt: params.resumePrompt,
    resumeUserPrompt: params.resumeUserPrompt,
  };
}

export function buildAgentControlGraphInterruptedGoalsCompleteOutcome(): AgentControlGraphInterruptedResponseOutcome {
  return {
    status: 'completed',
    checkpointTitle: 'Goals satisfied',
    checkpointDetail: 'Interrupted stream recovered after goals reached a completable state.',
  };
}
