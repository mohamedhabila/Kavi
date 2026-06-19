import { getAgentRunPendingAsyncOperations } from '../../../services/agents/agentRunAsyncState';
import { getOutstandingSpawnedSubAgentCount } from '../terminalBackgroundReviewEligibility';
import {
  getReviewableSubAgentsForRun,
  getRunningLiveSubAgentsForRun,
} from '../../../services/agents/subAgentRunTracking';
import type { AgentRunAsyncOperation } from '../../../types/agentRun';
import type { Conversation } from '../../../types/conversation';

export type ForegroundRunTrackingState = {
  backgroundWorkers: {
    runningLiveCount: number;
    orphanedRunningCount: number;
    outstandingSpawnedCount: number;
  };
  pendingAsyncOperations: AgentRunAsyncOperation[];
  isRunning: boolean;
};

export function buildForegroundRunTrackingState(params: {
  conversation: Conversation | undefined;
  fallbackPendingAsyncOperations: AgentRunAsyncOperation[];
  recordedSpawnedSubAgents: number;
  runId: string | undefined;
}): ForegroundRunTrackingState {
  if (!params.runId) {
    return {
      backgroundWorkers: {
        runningLiveCount: 0,
        orphanedRunningCount: 0,
        outstandingSpawnedCount: Math.max(0, params.recordedSpawnedSubAgents),
      },
      pendingAsyncOperations: params.fallbackPendingAsyncOperations,
      isRunning: false,
    };
  }

  if (!params.conversation) {
    return {
      backgroundWorkers: {
        runningLiveCount: 0,
        orphanedRunningCount: 0,
        outstandingSpawnedCount: Math.max(0, params.recordedSpawnedSubAgents),
      },
      pendingAsyncOperations: params.fallbackPendingAsyncOperations,
      isRunning: false,
    };
  }

  const targetRun = params.conversation.agentRuns?.find(
    (candidate) => candidate.id === params.runId,
  );
  const pendingAsyncOperations = targetRun
    ? getAgentRunPendingAsyncOperations(targetRun)
    : params.fallbackPendingAsyncOperations;

  if (!targetRun) {
    return {
      backgroundWorkers: {
        runningLiveCount: getRunningLiveSubAgentsForRun(params.conversation, params.runId).length,
        orphanedRunningCount: 0,
        outstandingSpawnedCount: Math.max(0, params.recordedSpawnedSubAgents),
      },
      pendingAsyncOperations,
      isRunning: false,
    };
  }

  const { liveSnapshots, mergedSnapshots, hasOrphanedRunningSnapshots } =
    getReviewableSubAgentsForRun(params.conversation, targetRun);
  const runningLiveCount = liveSnapshots.filter((snapshot) => snapshot.status === 'running').length;
  const orphanedRunningCount = hasOrphanedRunningSnapshots
    ? mergedSnapshots.filter((snapshot) => snapshot.status === 'running').length
    : 0;

  return {
    backgroundWorkers: {
      runningLiveCount,
      orphanedRunningCount,
      outstandingSpawnedCount: getOutstandingSpawnedSubAgentCount({
        recordedSpawnedSubAgents: params.recordedSpawnedSubAgents,
        liveSnapshots,
        mergedSnapshots,
      }),
    },
    pendingAsyncOperations:
      pendingAsyncOperations.length > 0
        ? pendingAsyncOperations
        : params.fallbackPendingAsyncOperations,
    isRunning: targetRun.status === 'running',
  };
}
