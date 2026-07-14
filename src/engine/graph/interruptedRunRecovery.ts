import type { AgentRun, AgentRunPhaseKey } from '../../types/agentRun';
import type { Message } from '../../types/message';
import type { SubAgentSnapshot } from '../../types/subAgent';
import {
  buildAgentRunMessageScope,
  getLatestAssistantProjectionFinalResponsePreview,
  summarizeBackgroundWorkerRunOutcome,
} from '../../services/agents/lifecycle/agentRunStateMachine';
import {
  getAgentRunPendingAsyncOperations,
  isAgentRunAwaitingBackgroundWorkers,
} from '../../services/agents/agentRunAsyncState';
import { hasBlockedBlockingGoals, hasResumableBlockingGoals } from '../goals/types';
import { isAgentControlGraphAtPersistedFinalDeliveryBoundary } from './persistedFinalDelivery';
import { decodeSubAgentTerminationCause } from '../../utils/subAgentTermination';

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
  worker: Pick<SubAgentSnapshot, 'status' | 'terminationCause'>,
): boolean {
  if (worker.status !== 'error' && worker.status !== 'timeout' && worker.status !== 'cancelled') {
    return false;
  }

  return decodeSubAgentTerminationCause(worker.terminationCause) === 'app_restart';
}

export function buildRecoveredAgentRunStateAfterAppRestart(params: {
  messages: Message[];
  run: AgentRun;
  subAgents: SubAgentSnapshot[];
}): RecoveredAgentRunState {
  const persistedGraphStatus = params.run.controlGraph?.status;
  if (persistedGraphStatus === 'cancelled') {
    const latestSummary =
      params.run.controlGraph?.terminalReason ||
      'The control graph recorded cancellation before the run projection was persisted.';
    return {
      status: 'cancelled',
      latestSummary,
      checkpointTitle: 'Recovered cancelled run',
      checkpointDetail: latestSummary,
    };
  }

  if (persistedGraphStatus === 'failed' || persistedGraphStatus === 'blocked') {
    const latestSummary =
      params.run.controlGraph?.terminalReason ||
      'The control graph recorded a terminal failure before the run projection was persisted.';
    return {
      status: 'failed',
      latestSummary,
      checkpointTitle:
        persistedGraphStatus === 'blocked' ? 'Recovered blocked run' : 'Recovered failed run',
      checkpointDetail: latestSummary,
    };
  }

  if (params.subAgents.some((agent) => agent.status === 'running')) {
    return undefined;
  }

  const runMessageScope = buildAgentRunMessageScope(params.run);
  const preservedFinalResponse = getLatestAssistantProjectionFinalResponsePreview(
    params.messages,
    runMessageScope,
  );
  if (
    preservedFinalResponse &&
    params.run.controlGraph &&
    isAgentControlGraphAtPersistedFinalDeliveryBoundary(params.run.controlGraph)
  ) {
    const goals = params.run.controlGraph?.goals ?? [];
    if (hasBlockedBlockingGoals(goals)) {
      return {
        status: 'failed',
        latestSummary: 'A required goal remained blocked when the app restarted.',
        checkpointTitle: 'Blocked goal prevented completion',
        checkpointDetail:
          'The persisted response cannot mark the run complete while a required goal is blocked.',
      };
    }
    if (hasResumableBlockingGoals(goals)) {
      return {
        status: 'running',
        latestSummary: 'A final response was persisted, but required goals still need work.',
        checkpointTitle: 'Recovered open goals',
        checkpointDetail:
          'The run remains active because required goals were not completed before restart.',
        phase: 'review',
      };
    }
    return {
      status: 'completed',
      latestSummary: preservedFinalResponse,
      checkpointTitle: 'Recovered delivered response',
      checkpointDetail: 'The final response was durably persisted before the app restarted.',
    };
  }

  if (preservedFinalResponse && params.run.controlGraph?.status === 'recovering') {
    const latestSummary =
      'A final response was preserved, but the interrupted recovery boundary still requires review.';
    return {
      status: 'running',
      latestSummary,
      checkpointTitle: 'Recovered completion requires review',
      checkpointDetail: latestSummary,
      phase: 'review',
    };
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
      const latestSummary =
        'Background workers finished before the app restarted. Recovering the final response from verified results.';
      return {
        status: 'running',
        latestSummary,
        checkpointTitle: 'Recovered background completion',
        checkpointDetail: latestSummary,
        awaitingBackgroundWorkers: true,
        phase: 'review',
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
