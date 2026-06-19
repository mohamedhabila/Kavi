import type { AgentRun, AgentRunPhaseKey } from '../../types/agentRun';
import type { Message } from '../../types/message';
import type { SubAgentSnapshot } from '../../types/subAgent';
import {
  buildAgentRunMessageScope,
  getLatestFinalAssistantResponsePreview,
  hasDeliveredFinalAssistantResponse,
  summarizeBackgroundWorkerRunOutcome,
} from '../../services/agents/lifecycle/agentRunStateMachine';
import {
  getAgentRunPendingAsyncOperations,
  isAgentRunAwaitingBackgroundWorkers,
} from '../../services/agents/agentRunAsyncState';

const APP_RESTART_INTERRUPTION_MARKER = 'app restarted before completion';

export type RecoveredAgentRunState =
  | {
      status: AgentRun['status'];
      latestSummary: string;
      checkpointTitle: string;
      checkpointDetail: string;
      awaitingBackgroundWorkers?: boolean;
      phase?: AgentRunPhaseKey;
    }
  | undefined;

function isAppRestartInterruptedWorker(
  worker: Pick<SubAgentSnapshot, 'status' | 'output' | 'currentActivity'>,
): boolean {
  if (worker.status !== 'error' && worker.status !== 'timeout' && worker.status !== 'cancelled') {
    return false;
  }

  const detail = `${worker.output ?? ''}\n${worker.currentActivity ?? ''}`.toLowerCase();
  return detail.includes(APP_RESTART_INTERRUPTION_MARKER);
}

export function buildRecoveredAgentRunStateAfterAppRestart(params: {
  messages: Message[];
  run: AgentRun;
  subAgents: SubAgentSnapshot[];
}): RecoveredAgentRunState {
  if (params.subAgents.some((agent) => agent.status === 'running')) {
    return undefined;
  }

  if (isAgentRunAwaitingBackgroundWorkers(params.run)) {
    if (params.subAgents.length === 0) {
      const latestSummary =
        'Background work was interrupted because the app restarted before the workers finished.';
      return {
        status: 'failed',
        latestSummary,
        checkpointTitle: 'Run interrupted on app restart',
        checkpointDetail: latestSummary,
      };
    }

    if (params.subAgents.every((agent) => isAppRestartInterruptedWorker(agent))) {
      const latestSummary =
        'Background workers were interrupted because the app restarted before completion.';
      return {
        status: 'failed',
        latestSummary,
        checkpointTitle: 'Background workers interrupted on app restart',
        checkpointDetail: latestSummary,
      };
    }

    const backgroundOutcome = summarizeBackgroundWorkerRunOutcome(params.subAgents);
    if (backgroundOutcome.status === 'completed') {
      const runMessageScope = buildAgentRunMessageScope(params.run);
      const preservedFinalResponse = hasDeliveredFinalAssistantResponse(
        params.messages,
        runMessageScope,
      )
        ? getLatestFinalAssistantResponsePreview(params.messages, runMessageScope)
        : undefined;

      if (preservedFinalResponse) {
        return {
          status: 'completed',
          latestSummary: preservedFinalResponse,
          checkpointTitle: 'Recovered background completion',
          checkpointDetail:
            'Background workers finished before the app restarted and the final response was preserved.',
        };
      }

      const latestSummary =
        'Background workers finished before the app restarted. Recovering the final response from verified results.';
      return {
        status: 'completed',
        latestSummary,
        checkpointTitle: 'Recovered background completion',
        checkpointDetail: latestSummary,
      };
    }

    const latestSummary =
      backgroundOutcome.status === 'cancelled'
        ? 'Background workers were cancelled before the app restarted. Reopen the conversation to resume goal execution from the recovered state.'
        : 'Background workers failed before the app restarted. Reopen the conversation to continue with a different approach if needed.';

    return {
      status: 'running',
      latestSummary,
      checkpointTitle:
        backgroundOutcome.status === 'cancelled'
          ? 'Recovered background cancellation'
          : 'Recovered background failure',
      checkpointDetail: latestSummary,
      awaitingBackgroundWorkers: true,
      phase: 'review',
    };
  }

  const pendingAsyncOperations = getAgentRunPendingAsyncOperations(params.run);
  if (pendingAsyncOperations.length > 0) {
    const pendingOperationCount = pendingAsyncOperations.length;
    const latestSummary =
      pendingOperationCount === 1
        ? 'Recovered 1 pending asynchronous operation after app restart. Resuming monitoring.'
        : `Recovered ${pendingOperationCount} pending asynchronous operations after app restart. Resuming monitoring.`;
    return {
      status: 'running',
      latestSummary,
      checkpointTitle: 'Recovered async workflow monitoring',
      checkpointDetail: latestSummary,
      phase: 'review',
    };
  }

  const latestSummary = 'The run was interrupted because the app restarted before completion.';
  return {
    status: 'failed',
    latestSummary,
    checkpointTitle: 'Run interrupted on app restart',
    checkpointDetail: latestSummary,
  };
}
