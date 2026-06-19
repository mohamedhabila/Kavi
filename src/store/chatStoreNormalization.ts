import type { AgentRun } from '../types/agentRun';
import type { Conversation, ConversationMode } from '../types/conversation';
import type { Message } from '../types/message';
import { normalizeLegacyAssistantMessages } from '../utils/assistantMessageMetadata';
import { normalizePersistedAgentRun } from './agentRuns/shared';
import { sanitizeConversationForPersistence } from './chatPersistence';
import { capMessages } from './chatStoreHelpers';
import type { ChatState } from './chatStoreTypes';

function normalizePersistedMessages(messages: Message[] | undefined): Message[] {
  return normalizeLegacyAssistantMessages(messages ?? []);
}

function normalizePersistedConversation(conversation: Conversation): Conversation {
  const normalizedRuns = (conversation.agentRuns ?? []).map((run) =>
    normalizePersistedAgentRun(run as AgentRun),
  );
  const activeAgentRunId = normalizedRuns.some(
    (run) => run.id === conversation.activeAgentRunId && run.status === 'running',
  )
    ? conversation.activeAgentRunId
    : undefined;

  const rawMode = (conversation as { mode?: string }).mode;
  const normalizedMode = rawMode === 'direct' ? 'chitchat' : conversation.mode;

  return sanitizeConversationForPersistence({
    ...conversation,
    messages: capMessages(normalizePersistedMessages(conversation.messages)),
    logs: conversation.logs ?? [],
    agentRuns: normalizedRuns,
    activeAgentRunId,
    ...(normalizedMode !== undefined ? { mode: normalizedMode as ConversationMode } : {}),
  });
}

export function collapseConversationsToCanonical(conversations: Conversation[]): Conversation[] {
  if (!Array.isArray(conversations) || conversations.length === 0) {
    return conversations ?? [];
  }
  const groups = new Map<string, Conversation[]>();
  for (const conv of conversations) {
    const isArchivedOnly = conv.archivedFromMigration && !conv.isCanonical;
    if (conv.isSideThread || isArchivedOnly) {
      continue;
    }
    const key = conv.personaId && conv.personaId.length > 0 ? conv.personaId : '__default__';
    const list = groups.get(key);
    if (list) list.push(conv);
    else groups.set(key, [conv]);
  }
  const canonicalIds = new Set<string>();
  const archivedIds = new Set<string>();
  for (const list of groups.values()) {
    if (list.length === 0) continue;
    const canonicalCandidates = list.filter((c) => c.isCanonical);
    const winnerPool = canonicalCandidates.length > 0 ? canonicalCandidates : list;
    const winner = winnerPool.reduce(
      (best, c) => (c.updatedAt > best.updatedAt ? c : best),
      winnerPool[0],
    );
    canonicalIds.add(winner.id);
    for (const c of list) {
      if (c.id !== winner.id) {
        archivedIds.add(c.id);
      }
    }
  }
  return conversations.map((conv) => {
    if (conv.isSideThread) return conv;
    if (canonicalIds.has(conv.id)) {
      if (conv.isCanonical && !conv.archivedFromMigration) {
        return conv;
      }
      return { ...conv, isCanonical: true, archivedFromMigration: false };
    }
    if (archivedIds.has(conv.id)) {
      if (conv.archivedFromMigration && !conv.isCanonical) {
        return conv;
      }
      return { ...conv, archivedFromMigration: true, isCanonical: false };
    }
    return conv;
  });
}

export function normalizePersistedChatState(
  state: Partial<ChatState> | undefined,
): Pick<ChatState, 'conversations' | 'activeConversationId'> {
  const conversations = collapseConversationsToCanonical(
    (state?.conversations ?? []).map((conversation) =>
      normalizePersistedConversation(conversation as Conversation),
    ),
  );
  let activeConversationId =
    typeof state?.activeConversationId === 'string' &&
    conversations.some((conversation) => conversation.id === state.activeConversationId)
      ? state.activeConversationId
      : null;

  const activeConversation = activeConversationId
    ? conversations.find((conversation) => conversation.id === activeConversationId)
    : undefined;
  if (activeConversation?.archivedFromMigration) {
    const groupKey =
      activeConversation.personaId && activeConversation.personaId.length > 0
        ? activeConversation.personaId
        : '__default__';
    const canonicalConversation = conversations.find((conversation) => {
      if (
        conversation.isSideThread ||
        conversation.archivedFromMigration ||
        !conversation.isCanonical
      ) {
        return false;
      }
      const conversationGroupKey =
        conversation.personaId && conversation.personaId.length > 0
          ? conversation.personaId
          : '__default__';
      return conversationGroupKey === groupKey;
    });
    activeConversationId = canonicalConversation?.id ?? activeConversationId;
  }

  return {
    conversations,
    activeConversationId,
  };
}
