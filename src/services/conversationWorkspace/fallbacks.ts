import type { AgentRun } from '../../types/agentRun';
import type { Conversation } from '../../types/conversation';
import type { ConversationUsageEntry } from '../../types/usage';
import type { Message } from '../../types/message';
import type { SubAgentSnapshot } from '../../types/subAgent';
import { listActiveSubAgents } from '../agents/subAgent';
import {
  getSubAgentsForConversation,
  resolveOwningConversationId,
} from '../agents/lifecycle/stateMachine';
import { resolveConversationWorkspaceReadTarget } from './ownership';

type ConversationWorkspaceFallbackSources = {
  conversationId: string | null | undefined;
  conversations?: ReadonlyArray<Pick<Conversation, 'id' | 'parentConversationId' | 'isSideThread'>>;
  additionalConversationIds?: ReadonlyArray<string | null | undefined>;
  messages?: ReadonlyArray<Pick<Message, 'subAgentEvent'>>;
  usageEntries?: ReadonlyArray<Pick<ConversationUsageEntry, 'sessionId' | 'parentSessionId'>>;
  agentRuns?: ReadonlyArray<Pick<AgentRun, 'evidence'>>;
  liveSubAgents?: ReadonlyArray<
    Pick<SubAgentSnapshot, 'sessionId' | 'parentConversationId' | 'parentSessionId'>
  >;
};

export type ConversationWorkspaceReadScope = {
  workspaceConversationId: string | null;
  fallbackConversationIds: string[];
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

  for (const conversationId of sources.additionalConversationIds ?? []) {
    addFallbackConversationId(fallbackIds, primaryConversationId, conversationId);
  }

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

export function resolveConversationWorkspaceReadScope(
  sources: ConversationWorkspaceFallbackSources,
): ConversationWorkspaceReadScope {
  const requestedConversationId =
    typeof sources.conversationId === 'string' ? sources.conversationId : '';
  if (!requestedConversationId) {
    return { workspaceConversationId: null, fallbackConversationIds: [] };
  }

  const allLiveSubAgents = sources.liveSubAgents ?? listActiveSubAgents();
  const target = resolveConversationWorkspaceReadTarget({
    conversationId: requestedConversationId,
    conversations: sources.conversations,
    subAgents: allLiveSubAgents,
  });
  const relatedConversationIds = new Set<string>([target.workspaceConversationId]);
  for (const conversation of sources.conversations ?? []) {
    try {
      const conversationTarget = resolveConversationWorkspaceReadTarget({
        conversationId: conversation.id,
        conversations: sources.conversations,
        subAgents: allLiveSubAgents,
      });
      if (conversationTarget.workspaceConversationId === target.workspaceConversationId) {
        relatedConversationIds.add(conversation.id);
      }
    } catch {
      // Invalid ownership links cannot become workspace read fallbacks.
    }
  }
  const liveSubAgents = allLiveSubAgents.filter((agent) => {
    const ownerConversationId = resolveOwningConversationId(agent.sessionId, allLiveSubAgents);
    return !!ownerConversationId && relatedConversationIds.has(ownerConversationId);
  });
  const fallbackConversationIds = collectConversationWorkspaceFallbackConversationIds({
    ...sources,
    conversationId: target.workspaceConversationId,
    additionalConversationIds: [
      ...target.workspaceReadFallbackConversationIds,
      ...(sources.additionalConversationIds ?? []),
    ],
    liveSubAgents,
  });

  return {
    workspaceConversationId: target.workspaceConversationId,
    fallbackConversationIds,
  };
}
