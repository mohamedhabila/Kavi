import type { AgentRunAsyncOperation } from '../../../types/agentRun';
import { getAgentRunPendingAsyncOperations } from '../../../services/agents/agentRunAsyncState';
import type { ForegroundConversationRunRuntimeParams } from './executionTypes';
import type { PendingSurfacedWorkerOutput, SurfacedWorkerOutputLock } from './surfacedWorkerOutput';

export type ForegroundRunMutableState = {
  assistantTurnCount: number;
  startedToolCount: number;
  completedToolCount: number;
  failedToolCount: number;
  spawnedSubAgentCount: number;
  latestPendingAsyncOperations: AgentRunAsyncOperation[];
  pendingSurfacedSubAgentOutputs: Map<string, PendingSurfacedWorkerOutput>;
  surfacedSubAgentOutputLock: SurfacedWorkerOutputLock | null;
};

export function createForegroundRunMutableState(
  params: Pick<ForegroundConversationRunRuntimeParams, 'bootstrapResult' | 'options'>,
): ForegroundRunMutableState {
  return {
    assistantTurnCount: params.bootstrapResult.initialCounters.assistantTurns,
    startedToolCount: params.bootstrapResult.initialCounters.startedTools,
    completedToolCount: params.bootstrapResult.initialCounters.completedTools,
    failedToolCount: params.bootstrapResult.initialCounters.failedTools,
    spawnedSubAgentCount: params.bootstrapResult.initialCounters.spawnedSubAgents,
    latestPendingAsyncOperations:
      params.options?.initialPendingAsyncOperations ??
      (params.bootstrapResult.bootstrap.existingRun
        ? getAgentRunPendingAsyncOperations(params.bootstrapResult.bootstrap.existingRun)
        : []),
    pendingSurfacedSubAgentOutputs: new Map<string, PendingSurfacedWorkerOutput>(),
    surfacedSubAgentOutputLock: null,
  };
}
