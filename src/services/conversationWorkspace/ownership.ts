import type { Conversation } from '../../types/conversation';
import type { SubAgentSnapshot } from '../../types/subAgent';
import {
  requireExactDurableScopeId,
  resolveOptionalExactDurableScopeId,
} from '../../utils/durableScopeIdentity';

type ConversationOwnershipLink = Pick<Conversation, 'id' | 'parentConversationId' | 'isSideThread'>;
type SubAgentOwnershipLink = Pick<SubAgentSnapshot, 'sessionId' | 'parentConversationId'>;

export type ConversationWorkspaceTarget = {
  workspaceConversationId: string;
  workspaceReadFallbackConversationId?: string;
};

export function resolveConfiguredConversationWorkspaceTarget(params: {
  workspaceConversationId?: string | null;
  workspaceReadFallbackConversationId?: string | null;
  derivedTarget?: ConversationWorkspaceTarget;
}): ConversationWorkspaceTarget | undefined {
  const workspaceConversationId =
    resolveOptionalExactDurableScopeId(
      params.workspaceConversationId,
      'conversation_workspace_configured_id_invalid',
    ) ??
    resolveOptionalExactDurableScopeId(
      params.derivedTarget?.workspaceConversationId,
      'conversation_workspace_derived_id_invalid',
    );
  const workspaceReadFallbackConversationId =
    resolveOptionalExactDurableScopeId(
      params.workspaceReadFallbackConversationId,
      'conversation_workspace_fallback_id_invalid',
    ) ??
    resolveOptionalExactDurableScopeId(
      params.derivedTarget?.workspaceReadFallbackConversationId,
      'conversation_workspace_derived_fallback_id_invalid',
    );

  if (!workspaceConversationId) {
    if (workspaceReadFallbackConversationId) {
      throw new Error('conversation_workspace_target_missing');
    }
    return undefined;
  }
  return {
    workspaceConversationId,
    ...(workspaceReadFallbackConversationId ? { workspaceReadFallbackConversationId } : {}),
  };
}

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

    const subAgentParentConversationId = resolveOptionalExactDurableScopeId(
      subAgentsBySessionId.get(workspaceConversationId)?.parentConversationId,
      'conversation_workspace_parent_id_invalid',
    );
    if (subAgentParentConversationId) {
      workspaceConversationId = subAgentParentConversationId;
      continue;
    }

    const conversation = conversationsById.get(workspaceConversationId);
    const sideThreadParentConversationId = conversation?.isSideThread
      ? resolveOptionalExactDurableScopeId(
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
