import type { AgentRun } from '../../types/agentRun';
import type { ConversationUsageEntry } from '../../types/usage';
import type { Message } from '../../types/message';
import type { SubAgentSnapshot } from '../../types/subAgent';
import { listActiveSubAgents } from '../agents/subAgent';
import { getSubAgentsForConversation } from '../agents/lifecycle/stateMachine';

type ConversationWorkspaceFallbackSources = {
  conversationId: string | null | undefined;
  messages?: ReadonlyArray<Pick<Message, 'subAgentEvent'>>;
  usageEntries?: ReadonlyArray<Pick<ConversationUsageEntry, 'sessionId' | 'parentSessionId'>>;
  agentRuns?: ReadonlyArray<Pick<AgentRun, 'evidence'>>;
  liveSubAgents?: ReadonlyArray<Pick<SubAgentSnapshot, 'sessionId' | 'parentSessionId'>>;
};

function normalizeConversationId(conversationId: string | null | undefined): string {
  return typeof conversationId === 'string' ? conversationId.trim() : '';
}

function addFallbackConversationId(
  fallbackIds: string[],
  primaryConversationId: string,
  candidate: string | null | undefined,
): void {
  const normalized = normalizeConversationId(candidate);
  if (!normalized || normalized === primaryConversationId || fallbackIds.includes(normalized)) {
    return;
  }

  fallbackIds.push(normalized);
}

export function collectConversationWorkspaceFallbackConversationIds(
  sources: ConversationWorkspaceFallbackSources,
): string[] {
  const primaryConversationId = normalizeConversationId(sources.conversationId);
  const fallbackIds: string[] = [];

  for (const message of sources.messages ?? []) {
    const snapshot = message.subAgentEvent?.snapshot;
    addFallbackConversationId(fallbackIds, primaryConversationId, snapshot?.sessionId);
    addFallbackConversationId(fallbackIds, primaryConversationId, snapshot?.parentSessionId);
  }

  for (const entry of sources.usageEntries ?? []) {
    addFallbackConversationId(fallbackIds, primaryConversationId, entry.sessionId);
    addFallbackConversationId(fallbackIds, primaryConversationId, entry.parentSessionId);
  }

  for (const run of sources.agentRuns ?? []) {
    for (const entry of run.evidence ?? []) {
      addFallbackConversationId(fallbackIds, primaryConversationId, entry.workerSessionId);
    }
  }

  for (const agent of sources.liveSubAgents ?? []) {
    addFallbackConversationId(fallbackIds, primaryConversationId, agent.sessionId);
    addFallbackConversationId(fallbackIds, primaryConversationId, agent.parentSessionId);
  }

  return fallbackIds;
}

export function getConversationWorkspaceFallbackConversationIds(
  sources: Omit<ConversationWorkspaceFallbackSources, 'liveSubAgents'>,
): string[] {
  const primaryConversationId = normalizeConversationId(sources.conversationId);
  const liveSubAgents = primaryConversationId
    ? getSubAgentsForConversation(primaryConversationId, listActiveSubAgents())
    : [];

  return collectConversationWorkspaceFallbackConversationIds({
    ...sources,
    liveSubAgents,
  });
}
