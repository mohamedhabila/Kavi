import type { AgentRunAsyncOperation } from '../../types/agentRun';
import { buildPendingAsyncOperationSummary } from '../pendingAsyncOperations';

export type AgentControlGraphBackgroundWorkerCounts = {
  runningLiveCount?: number;
  orphanedRunningCount?: number;
  outstandingSpawnedCount?: number;
};

export type AgentControlGraphOpenWorkCloseoutDecision =
  | { type: 'none' }
  | {
      type: 'async-operations';
      pendingOperations: AgentRunAsyncOperation[];
      latestSummary: string;
      checkpointTitle: 'Async monitoring active';
      checkpointDetail: string;
      logLevel: 'warning';
      logTitle: 'Async monitoring still active';
    };

export type AgentControlGraphInterruptedOpenWorkRecovery = {
  keepRunOpen: 'async-operations';
  checkpointTitle: 'Async monitoring active';
  checkpointDetail: string;
};

export type AgentControlGraphOpenWorkPhasePresentation = {
  detail: string;
  checkpointTitle: 'Async monitoring active';
  checkpointDetail: string;
  latestSummary: string;
  allowRegression: true;
};

function normalizeCount(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export function getAgentControlGraphWaitingBackgroundWorkerCount(
  counts: AgentControlGraphBackgroundWorkerCounts,
): number {
  return Math.max(
    normalizeCount(counts.runningLiveCount),
    normalizeCount(counts.orphanedRunningCount),
    normalizeCount(counts.outstandingSpawnedCount),
  );
}

export function buildAgentControlGraphBackgroundWorkerWaitSummary(workerCount: number): string {
  const normalizedCount = normalizeCount(workerCount);
  return normalizedCount === 1
    ? 'Waiting for 1 background worker to finish.'
    : `Waiting for ${normalizedCount} background workers to finish.`;
}

export function buildAgentControlGraphInterruptedBackgroundWorkerWaitSummary(
  workerCount: number,
): string {
  return `${buildAgentControlGraphBackgroundWorkerWaitSummary(workerCount)} The supervisor response was interrupted before the run could be finalized.`;
}

export function buildAgentControlGraphInterruptedAsyncMonitoringSummary(
  operations: ReadonlyArray<AgentRunAsyncOperation>,
): string {
  const baseSummary =
    buildPendingAsyncOperationSummary(operations) || 'Resuming asynchronous workflow monitoring.';
  return `${baseSummary} The supervisor response was interrupted before monitoring could continue.`;
}

export function buildAgentControlGraphOpenWorkCloseoutDecision(params: {
  backgroundWorkers: AgentControlGraphBackgroundWorkerCounts;
  pendingOperations: ReadonlyArray<AgentRunAsyncOperation>;
}): AgentControlGraphOpenWorkCloseoutDecision {
  if (params.pendingOperations.length > 0) {
    const latestSummary =
      buildPendingAsyncOperationSummary(params.pendingOperations) ||
      'Resuming asynchronous workflow monitoring.';
    return {
      type: 'async-operations',
      pendingOperations: [...params.pendingOperations],
      latestSummary,
      checkpointTitle: 'Async monitoring active',
      checkpointDetail: latestSummary,
      logLevel: 'warning',
      logTitle: 'Async monitoring still active',
    };
  }

  return { type: 'none' };
}

export function buildAgentControlGraphOpenWorkPhasePresentation(
  decision: AgentControlGraphOpenWorkCloseoutDecision,
): AgentControlGraphOpenWorkPhasePresentation | undefined {
  if (decision.type === 'none') {
    return undefined;
  }

  return {
    detail: decision.latestSummary,
    checkpointTitle: decision.checkpointTitle,
    checkpointDetail: decision.checkpointDetail,
    latestSummary: decision.latestSummary,
    allowRegression: true,
  };
}

export function buildAgentControlGraphInterruptedOpenWorkRecovery(params: {
  runningBackgroundWorkerCount: number;
  pendingOperations: ReadonlyArray<AgentRunAsyncOperation>;
}): AgentControlGraphInterruptedOpenWorkRecovery | undefined {
  if (params.pendingOperations.length > 0) {
    return {
      keepRunOpen: 'async-operations',
      checkpointTitle: 'Async monitoring active',
      checkpointDetail: buildAgentControlGraphInterruptedAsyncMonitoringSummary(
        params.pendingOperations,
      ),
    };
  }

  return undefined;
}
