import type { Conversation } from '../../types/conversation';
import type { SubAgentSnapshot } from '../../types/subAgent';
import { requireExactDurableScopeId } from '../../utils/durableScopeIdentity';

type ConversationOwnershipLink = Pick<Conversation, 'id' | 'parentConversationId' | 'isSideThread'>;
type SubAgentOwnershipLink = Pick<SubAgentSnapshot, 'sessionId' | 'parentConversationId'>;

function optionalExactId(value: string | undefined | null, code: string): string | undefined {
  if (value === null || value === undefined) return undefined;
  return requireExactDurableScopeId(value, code);
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
  const initialConversationId = requireExactDurableScopeId(
    params.conversationId,
    'conversation_workspace_id_invalid',
  );

  const conversationsById = new Map(
    (params.conversations ?? []).map((conversation): [string, ConversationOwnershipLink] => [
      requireExactDurableScopeId(conversation.id, 'conversation_workspace_link_id_invalid'),
      conversation,
    ]),
  );
  const subAgentsBySessionId = new Map(
    (params.subAgents ?? []).map((subAgent): [string, SubAgentOwnershipLink] => [
      requireExactDurableScopeId(subAgent.sessionId, 'conversation_workspace_session_id_invalid'),
      subAgent,
    ]),
  );

  const visitedIds = new Set<string>();
  let workspaceConversationId = initialConversationId;

  while (!visitedIds.has(workspaceConversationId)) {
    visitedIds.add(workspaceConversationId);

    const subAgentParentConversationId = optionalExactId(
      subAgentsBySessionId.get(workspaceConversationId)?.parentConversationId,
      'conversation_workspace_parent_id_invalid',
    );
    if (subAgentParentConversationId) {
      workspaceConversationId = subAgentParentConversationId;
      continue;
    }

    const conversation = conversationsById.get(workspaceConversationId);
    const sideThreadParentConversationId = conversation?.isSideThread
      ? optionalExactId(
          conversation.parentConversationId,
          'conversation_workspace_parent_id_invalid',
        )
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
