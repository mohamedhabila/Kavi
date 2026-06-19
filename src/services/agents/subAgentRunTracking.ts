import type { AgentRun } from '../../types/agentRun';
import type { Conversation } from '../../types/conversation';
import type { Message } from '../../types/message';
import type { SubAgentSnapshot } from '../../types/subAgent';
import { cancelSubAgent, listActiveSubAgents } from './subAgent';
import {
  cloneSubAgentSnapshot,
  collectSubAgentSnapshotsFromMessages,
  getSubAgentsForAgentRun,
  resolveDisplayedSubAgentSnapshot,
} from './lifecycle/stateMachine';
import {
  buildAgentRunMessageScope,
  getAgentRunMessageSlice,
} from './lifecycle/agentRunStateMachine';

export function getLiveSubAgentsForRun(
  conversation: Pick<Conversation, 'id' | 'activeAgentRunId' | 'agentRuns'>,
  agentRunId: string,
) {
  return getSubAgentsForAgentRun(conversation, agentRunId, listActiveSubAgents());
}

export function getRunningLiveSubAgentsForRun(
  conversation: Pick<Conversation, 'id' | 'activeAgentRunId' | 'agentRuns'>,
  agentRunId: string,
) {
  return getLiveSubAgentsForRun(conversation, agentRunId).filter(
    (agent) => agent.status === 'running',
  );
}

export function cancelRunningSubAgentsForRun(
  conversation: Pick<Conversation, 'id' | 'activeAgentRunId' | 'agentRuns'>,
  agentRunId: string,
  reason: string,
) {
  const runningWorkers = getRunningLiveSubAgentsForRun(conversation, agentRunId);

  for (const worker of runningWorkers) {
    cancelSubAgent(worker.sessionId, reason);
  }

  return runningWorkers;
}

export function getRunningConversationRunsForCancellation(
  conversation: Pick<Conversation, 'activeAgentRunId' | 'agentRuns'>,
): AgentRun[] {
  const runningRuns = (conversation.agentRuns ?? []).filter((run) => run.status === 'running');
  if (runningRuns.length <= 1) {
    return runningRuns;
  }

  const activeRun = conversation.activeAgentRunId
    ? runningRuns.find((run) => run.id === conversation.activeAgentRunId)
    : undefined;
  const remainingRuns = runningRuns
    .filter((run) => run.id !== activeRun?.id)
    .sort((left, right) => {
      if (right.updatedAt !== left.updatedAt) {
        return right.updatedAt - left.updatedAt;
      }

      return right.createdAt - left.createdAt;
    });

  return activeRun ? [activeRun, ...remainingRuns] : remainingRuns;
}

export function getReviewableSubAgentsForRun(
  conversation: Pick<Conversation, 'id' | 'activeAgentRunId' | 'agentRuns' | 'messages'>,
  run: AgentRun,
): {
  liveSnapshots: SubAgentSnapshot[];
  mergedSnapshots: SubAgentSnapshot[];
  hasOrphanedRunningSnapshots: boolean;
} {
  const liveSnapshots = getLiveSubAgentsForRun(conversation, run.id);
  const persistedSnapshots = getSubAgentsForAgentRun(
    conversation,
    run.id,
    collectSubAgentSnapshotsFromMessages(
      getAgentRunMessageSlice(conversation.messages as Message[], buildAgentRunMessageScope(run)),
    ),
  );
  const snapshotsBySessionId = new Map<string, SubAgentSnapshot>();

  for (const snapshot of persistedSnapshots) {
    snapshotsBySessionId.set(snapshot.sessionId, cloneSubAgentSnapshot(snapshot));
  }

  for (const snapshot of liveSnapshots) {
    const persistedSnapshot = snapshotsBySessionId.get(snapshot.sessionId);
    snapshotsBySessionId.set(
      snapshot.sessionId,
      persistedSnapshot
        ? resolveDisplayedSubAgentSnapshot(persistedSnapshot, snapshot)
        : cloneSubAgentSnapshot(snapshot),
    );
  }

  const mergedSnapshots = Array.from(snapshotsBySessionId.values());
  const hasLiveRunningSnapshots = liveSnapshots.some((snapshot) => snapshot.status === 'running');

  return {
    liveSnapshots,
    mergedSnapshots,
    hasOrphanedRunningSnapshots:
      !hasLiveRunningSnapshots && mergedSnapshots.some((snapshot) => snapshot.status === 'running'),
  };
}
