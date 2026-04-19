import type {
  Conversation,
  AgentRunStatus,
  Message,
  SubAgentSnapshot,
  SubAgentStatus,
} from '../../types';
import {
  hasCompleteFinalAssistantMetadata,
  isAssistantFinalResponsePlaceholder,
} from '../../utils/assistantMessageMetadata';

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

export function getAgentRunMessageSlice(messages: Message[], userMessageId: string): Message[] {
  const userIndex = messages.findIndex((message) => message.id === userMessageId);
  if (userIndex < 0) {
    return messages;
  }

  let endIndex = messages.length;
  for (let index = userIndex + 1; index < messages.length; index += 1) {
    if (messages[index].role === 'user') {
      endIndex = index;
      break;
    }
  }

  return messages.slice(userIndex, endIndex);
}

function isAgentRunExecutionArtifact(message: Message): boolean {
  if (message.role === 'tool') {
    return true;
  }

  if (message.role !== 'assistant') {
    return false;
  }

  return !!message.subAgentEvent || (message.toolCalls?.length ?? 0) > 0;
}

export function hasDeliveredFinalAssistantResponse(
  messages: Message[],
  userMessageId: string,
): boolean {
  const runMessages = getAgentRunMessageSlice(messages, userMessageId);
  let lastExecutionArtifactIndex = -1;

  for (let index = 0; index < runMessages.length; index += 1) {
    if (isAgentRunExecutionArtifact(runMessages[index])) {
      lastExecutionArtifactIndex = index;
    }
  }

  for (let index = runMessages.length - 1; index > lastExecutionArtifactIndex; index -= 1) {
    if (
      hasCompleteFinalAssistantMetadata(runMessages[index]) &&
      !isAssistantFinalResponsePlaceholder(runMessages[index])
    ) {
      return true;
    }
  }

  return false;
}

export function getLatestFinalAssistantResponsePreview(
  messages: Message[],
  userMessageId: string,
): string | undefined {
  if (!hasDeliveredFinalAssistantResponse(messages, userMessageId)) {
    return undefined;
  }

  const runMessages = getAgentRunMessageSlice(messages, userMessageId);
  for (let index = runMessages.length - 1; index >= 0; index -= 1) {
    if (
      hasCompleteFinalAssistantMetadata(runMessages[index]) &&
      !isAssistantFinalResponsePlaceholder(runMessages[index])
    ) {
      return runMessages[index].content.trim();
    }
  }

  return undefined;
}

export function summarizeBackgroundWorkerRunOutcome(
  workers: Array<Pick<SubAgentSnapshot, 'status'>>,
): { status: Exclude<AgentRunStatus, 'running'>; summary: string } {
  if (workers.some((worker) => worker.status === 'error' || worker.status === 'timeout')) {
    return {
      status: 'failed',
      summary: 'Background work finished with at least one failed worker.',
    };
  }

  if (workers.some((worker) => worker.status === 'cancelled')) {
    return {
      status: 'cancelled',
      summary: 'Background work stopped after a worker was cancelled.',
    };
  }

  return {
    status: 'completed',
    summary: 'All background workers finished.',
  };
}
