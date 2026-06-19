import type { AgentRun } from '../../types/agentRun';
import type { Conversation } from '../../types/conversation';
import type { SubAgentSnapshot } from '../../types/subAgent';
import { isAgentRunAwaitingBackgroundWorkers } from '../../services/agents/agentRunAsyncState';

export interface ReviewableWorkerSnapshots {
  liveSnapshots: SubAgentSnapshot[];
  mergedSnapshots: SubAgentSnapshot[];
  hasOrphanedRunningSnapshots: boolean;
}

export interface TerminalBackgroundReviewCandidate {
  conversationId: string;
  runId: string;
  timestamp: number;
}

export function getOutstandingSpawnedSubAgentCount(params: {
  recordedSpawnedSubAgents: number;
  liveSnapshots: ReadonlyArray<SubAgentSnapshot>;
  mergedSnapshots: ReadonlyArray<SubAgentSnapshot>;
}): number {
  const recordedSpawnedSubAgents = Math.max(0, Math.floor(params.recordedSpawnedSubAgents));
  const terminalSnapshotCount = params.mergedSnapshots.filter(
    (snapshot) => snapshot.status !== 'running',
  ).length;
  const trackedSnapshotCount = Math.max(params.liveSnapshots.length, params.mergedSnapshots.length);
  const effectiveSpawnedCount =
    trackedSnapshotCount > 0
      ? Math.min(recordedSpawnedSubAgents, trackedSnapshotCount)
      : recordedSpawnedSubAgents;

  return Math.max(0, effectiveSpawnedCount - terminalSnapshotCount);
}

export function resolveTerminalBackgroundReviewCandidate(params: {
  conversation: Pick<Conversation, 'id'>;
  run: AgentRun;
  workers: ReviewableWorkerSnapshots;
}): TerminalBackgroundReviewCandidate | undefined {
  if (params.run.status !== 'running' || !isAgentRunAwaitingBackgroundWorkers(params.run)) {
    return undefined;
  }

  if (params.workers.liveSnapshots.some((agent) => agent.status === 'running')) {
    return undefined;
  }

  if (params.workers.hasOrphanedRunningSnapshots) {
    return undefined;
  }

  const outstandingSpawnedCount = getOutstandingSpawnedSubAgentCount({
    recordedSpawnedSubAgents: params.run.summary?.spawnedSubAgents ?? 0,
    liveSnapshots: params.workers.liveSnapshots,
    mergedSnapshots: params.workers.mergedSnapshots,
  });
  if (outstandingSpawnedCount > 0) {
    return undefined;
  }

  const timestamp = params.workers.mergedSnapshots.reduce(
    (latestTimestamp, agent) => Math.max(latestTimestamp, agent.updatedAt),
    params.run.updatedAt,
  );

  return {
    conversationId: params.conversation.id,
    runId: params.run.id,
    timestamp,
  };
}

export function selectTerminalBackgroundReviewCandidates(params: {
  conversations: ReadonlyArray<Conversation>;
  getReviewableWorkers: (conversation: Conversation, run: AgentRun) => ReviewableWorkerSnapshots;
}): TerminalBackgroundReviewCandidate[] {
  const candidates: TerminalBackgroundReviewCandidate[] = [];

  for (const conversation of params.conversations) {
    for (const run of conversation.agentRuns ?? []) {
      const candidate = resolveTerminalBackgroundReviewCandidate({
        conversation,
        run,
        workers: params.getReviewableWorkers(conversation, run),
      });
      if (candidate) {
        candidates.push(candidate);
      }
    }
  }

  return candidates;
}
