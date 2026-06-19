import type { Conversation } from '../../../types/conversation';
import type { Message } from '../../../types/message';
import type { SubAgentSnapshot, SubAgentStatus } from '../../../types/subAgent';

export function isTerminalSubAgentStatus(status: SubAgentStatus): boolean {
  return status !== 'running';
}

type AgentRunOwner = Pick<Conversation, 'id' | 'activeAgentRunId' | 'agentRuns'>;

type SubAgentConversationLink = Pick<SubAgentSnapshot, 'sessionId' | 'parentConversationId'>;

function createOwningConversationResolver(
  subAgents: ReadonlyArray<SubAgentConversationLink>,
): (candidateId: string | undefined) => string | undefined {
  const bySessionId = new Map(
    subAgents
      .map((agent) => {
        const sessionId = agent.sessionId.trim();
        return sessionId ? [sessionId, { ...agent, sessionId }] : null;
      })
      .filter((entry): entry is [string, SubAgentConversationLink] => entry !== null),
  );
  const resolvedIds = new Map<string, string>();

  return (candidateId: string | undefined): string | undefined => {
    const trimmedCandidateId = candidateId?.trim();
    if (!trimmedCandidateId) {
      return undefined;
    }

    const visitedInChain: string[] = [];
    const visitedIds = new Set<string>();
    let currentId = trimmedCandidateId;

    while (true) {
      const cachedId = resolvedIds.get(currentId);
      if (cachedId) {
        currentId = cachedId;
        break;
      }

      if (visitedIds.has(currentId)) {
        currentId = trimmedCandidateId;
        break;
      }

      visitedIds.add(currentId);
      visitedInChain.push(currentId);

      const currentAgent = bySessionId.get(currentId);
      const nextId = currentAgent?.parentConversationId?.trim();
      if (!currentAgent || !nextId) {
        break;
      }

      currentId = nextId;
    }

    for (const visitedId of visitedInChain) {
      resolvedIds.set(visitedId, currentId);
    }

    return currentId;
  };
}

export function cloneSubAgentSnapshot<T extends SubAgentSnapshot>(snapshot: T): T {
  return {
    ...snapshot,
    ...(snapshot.toolsUsed ? { toolsUsed: [...snapshot.toolsUsed] } : {}),
    ...(snapshot.artifacts
      ? { artifacts: snapshot.artifacts.map((attachment) => ({ ...attachment })) }
      : {}),
    ...(snapshot.activityLog
      ? { activityLog: snapshot.activityLog.map((entry) => ({ ...entry })) }
      : {}),
    ...(snapshot.taskLedger
      ? {
          taskLedger: snapshot.taskLedger.map((item) => ({
            ...item,
            ...(item.successCriteria ? { successCriteria: [...item.successCriteria] } : {}),
            ...(item.dependencies ? { dependencies: [...item.dependencies] } : {}),
            ...(item.requirements ? { requirements: [...item.requirements] } : {}),
            ...(item.requiredCapabilities
              ? { requiredCapabilities: [...item.requiredCapabilities] }
              : {}),
            ...(item.completedEvidence ? { completedEvidence: [...item.completedEvidence] } : {}),
          })),
        }
      : {}),
  } as T;
}

export function resolveOwningConversationId(
  candidateId: string | undefined,
  subAgents: ReadonlyArray<SubAgentConversationLink>,
): string | undefined {
  return createOwningConversationResolver(subAgents)(candidateId);
}

export function getSubAgentsForConversation(
  conversationId: string,
  subAgents: ReadonlyArray<SubAgentSnapshot>,
): SubAgentSnapshot[] {
  const trimmedConversationId = conversationId.trim();
  if (!trimmedConversationId) {
    return [];
  }

  const resolveOwningConversation = createOwningConversationResolver(subAgents);
  return subAgents.filter(
    (agent) => resolveOwningConversation(agent.sessionId) === trimmedConversationId,
  );
}

export function collectSubAgentSnapshotsFromMessages(
  messages: ReadonlyArray<Pick<Message, 'subAgentEvent'>>,
): SubAgentSnapshot[] {
  const snapshotsBySessionId = new Map<string, SubAgentSnapshot>();

  for (const message of messages) {
    const snapshot = message.subAgentEvent?.snapshot;
    const sessionId = snapshot?.sessionId?.trim();
    if (!snapshot || !sessionId) {
      continue;
    }

    const existingSnapshot = snapshotsBySessionId.get(sessionId);
    snapshotsBySessionId.set(
      sessionId,
      existingSnapshot
        ? resolveDisplayedSubAgentSnapshot(existingSnapshot, snapshot)
        : cloneSubAgentSnapshot(snapshot),
    );
  }

  return Array.from(snapshotsBySessionId.values());
}

function resolveFallbackAgentRunId(conversation: AgentRunOwner): string | undefined {
  const runningRuns = (conversation.agentRuns ?? []).filter((run) => run.status === 'running');

  if (
    conversation.activeAgentRunId &&
    runningRuns.some((run) => run.id === conversation.activeAgentRunId)
  ) {
    return conversation.activeAgentRunId;
  }

  return runningRuns.length === 1 ? runningRuns[0].id : undefined;
}

function resolveHistoricalFallbackAgentRunId(
  conversation: AgentRunOwner,
  agent: Pick<SubAgentSnapshot, 'startedAt'>,
): string | undefined {
  if (typeof agent.startedAt !== 'number') {
    return undefined;
  }

  const candidateRuns = (conversation.agentRuns ?? []).filter((run) => {
    if (typeof run.createdAt !== 'number' || agent.startedAt < run.createdAt) {
      return false;
    }

    const runEndedAt =
      typeof run.completedAt === 'number'
        ? run.completedAt
        : run.status === 'running'
          ? Number.POSITIVE_INFINITY
          : typeof run.updatedAt === 'number'
            ? run.updatedAt
            : run.createdAt;

    return agent.startedAt <= runEndedAt;
  });

  if (!candidateRuns.length) {
    return undefined;
  }

  candidateRuns.sort((left, right) => {
    const leftCreatedAt = typeof left.createdAt === 'number' ? left.createdAt : 0;
    const rightCreatedAt = typeof right.createdAt === 'number' ? right.createdAt : 0;
    return rightCreatedAt - leftCreatedAt;
  });

  return candidateRuns[0].id;
}

export function resolveAgentRunIdForSubAgent(
  conversation: AgentRunOwner,
  agent: Pick<SubAgentSnapshot, 'agentRunId' | 'startedAt'>,
): string | undefined {
  return (
    agent.agentRunId ??
    resolveHistoricalFallbackAgentRunId(conversation, agent) ??
    resolveFallbackAgentRunId(conversation)
  );
}

export function getSubAgentsForAgentRun(
  conversation: AgentRunOwner,
  runId: string,
  subAgents: ReadonlyArray<SubAgentSnapshot>,
): SubAgentSnapshot[] {
  return getSubAgentsForConversation(conversation.id, subAgents).filter(
    (agent) => resolveAgentRunIdForSubAgent(conversation, agent) === runId,
  );
}

function mergeTerminalSnapshot(
  terminalSnapshot: SubAgentSnapshot,
  fallbackSnapshot: SubAgentSnapshot,
): SubAgentSnapshot {
  return cloneSubAgentSnapshot({
    ...terminalSnapshot,
    parentSessionId: terminalSnapshot.parentSessionId ?? fallbackSnapshot.parentSessionId,
    agentRunId: terminalSnapshot.agentRunId ?? fallbackSnapshot.agentRunId,
    name: terminalSnapshot.name ?? fallbackSnapshot.name,
    output: terminalSnapshot.output ?? fallbackSnapshot.output,
    completionState: terminalSnapshot.completionState ?? fallbackSnapshot.completionState,
    toolsUsed: terminalSnapshot.toolsUsed ?? fallbackSnapshot.toolsUsed,
    artifacts: terminalSnapshot.artifacts ?? fallbackSnapshot.artifacts,
    iterations: terminalSnapshot.iterations ?? fallbackSnapshot.iterations,
    lastToolResultPreview:
      terminalSnapshot.lastToolResultPreview ?? fallbackSnapshot.lastToolResultPreview,
    activityLog: terminalSnapshot.activityLog ?? fallbackSnapshot.activityLog,
    currentActivity: terminalSnapshot.currentActivity,
    activeToolName: terminalSnapshot.activeToolName,
    activeToolStartedAt: terminalSnapshot.activeToolStartedAt,
  });
}

export function resolveDisplayedSubAgentSnapshot(
  persistedSnapshot: SubAgentSnapshot,
  liveSnapshot?: SubAgentSnapshot | null,
): SubAgentSnapshot {
  if (!liveSnapshot || liveSnapshot.sessionId !== persistedSnapshot.sessionId) {
    return cloneSubAgentSnapshot(persistedSnapshot);
  }

  const persistedIsTerminal = isTerminalSubAgentStatus(persistedSnapshot.status);
  const liveIsTerminal = isTerminalSubAgentStatus(liveSnapshot.status);

  if (persistedIsTerminal && !liveIsTerminal) {
    return mergeTerminalSnapshot(persistedSnapshot, liveSnapshot);
  }

  if (!persistedIsTerminal && liveIsTerminal) {
    return mergeTerminalSnapshot(liveSnapshot, persistedSnapshot);
  }

  const preferredSnapshot =
    liveSnapshot.updatedAt >= persistedSnapshot.updatedAt ? liveSnapshot : persistedSnapshot;
  const fallbackSnapshot = preferredSnapshot === liveSnapshot ? persistedSnapshot : liveSnapshot;

  return cloneSubAgentSnapshot({
    ...fallbackSnapshot,
    ...preferredSnapshot,
    parentSessionId: preferredSnapshot.parentSessionId ?? fallbackSnapshot.parentSessionId,
    agentRunId: preferredSnapshot.agentRunId ?? fallbackSnapshot.agentRunId,
    name: preferredSnapshot.name ?? fallbackSnapshot.name,
    output: preferredSnapshot.output ?? fallbackSnapshot.output,
    completionState: preferredSnapshot.completionState ?? fallbackSnapshot.completionState,
    toolsUsed: preferredSnapshot.toolsUsed ?? fallbackSnapshot.toolsUsed,
    artifacts: preferredSnapshot.artifacts ?? fallbackSnapshot.artifacts,
    iterations: preferredSnapshot.iterations ?? fallbackSnapshot.iterations,
    currentActivity: preferredSnapshot.currentActivity ?? fallbackSnapshot.currentActivity,
    activeToolName: preferredSnapshot.activeToolName ?? fallbackSnapshot.activeToolName,
    activeToolStartedAt:
      preferredSnapshot.activeToolStartedAt ?? fallbackSnapshot.activeToolStartedAt,
    lastToolResultPreview:
      preferredSnapshot.lastToolResultPreview ?? fallbackSnapshot.lastToolResultPreview,
    activityLog: preferredSnapshot.activityLog ?? fallbackSnapshot.activityLog,
  });
}
