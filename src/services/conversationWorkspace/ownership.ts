import type { Conversation } from '../../types/conversation';
import type { SubAgentSnapshot } from '../../types/subAgent';

type ConversationOwnershipLink = Pick<Conversation, 'id' | 'parentConversationId' | 'isSideThread'>;
type SubAgentOwnershipLink = Pick<SubAgentSnapshot, 'sessionId' | 'parentConversationId'>;

function normalizeId(value: string | undefined | null): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || undefined;
}

export type ConversationWorkspaceTarget = {
  workspaceConversationId: string;
  workspaceReadFallbackConversationId?: string;
};

export function resolveConversationWorkspaceTarget(params: {
  conversationId: string;
  conversations?: ReadonlyArray<ConversationOwnershipLink>;
  subAgents?: ReadonlyArray<SubAgentOwnershipLink>;
}): ConversationWorkspaceTarget {
  const initialConversationId = normalizeId(params.conversationId);
  if (!initialConversationId) {
    throw new Error('conversationId is required');
  }

  const conversationsById = new Map(
    (params.conversations ?? [])
      .map((conversation) => {
        const id = normalizeId(conversation.id);
        return id ? [id, conversation] : null;
      })
      .filter((entry): entry is [string, ConversationOwnershipLink] => entry !== null),
  );
  const subAgentsBySessionId = new Map(
    (params.subAgents ?? [])
      .map((subAgent) => {
        const sessionId = normalizeId(subAgent.sessionId);
        return sessionId ? [sessionId, subAgent] : null;
      })
      .filter((entry): entry is [string, SubAgentOwnershipLink] => entry !== null),
  );

  const visitedIds = new Set<string>();
  let workspaceConversationId = initialConversationId;

  while (!visitedIds.has(workspaceConversationId)) {
    visitedIds.add(workspaceConversationId);

    const subAgentParentConversationId = normalizeId(
      subAgentsBySessionId.get(workspaceConversationId)?.parentConversationId,
    );
    if (subAgentParentConversationId) {
      workspaceConversationId = subAgentParentConversationId;
      continue;
    }

    const conversation = conversationsById.get(workspaceConversationId);
    const sideThreadParentConversationId = conversation?.isSideThread
      ? normalizeId(conversation.parentConversationId)
      : undefined;
    if (sideThreadParentConversationId) {
      workspaceConversationId = sideThreadParentConversationId;
      continue;
    }

    break;
  }

  return {
    workspaceConversationId,
    ...(workspaceConversationId !== initialConversationId
      ? { workspaceReadFallbackConversationId: initialConversationId }
      : {}),
  };
}
