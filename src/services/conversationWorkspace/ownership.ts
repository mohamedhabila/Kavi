import type { SubAgentSnapshot } from '../../types/subAgent';
import {
  requireExactDurableScopeId,
  resolveOptionalExactDurableScopeId,
} from '../../utils/durableScopeIdentity';

type SubAgentOwnershipLink = Pick<SubAgentSnapshot, 'sessionId' | 'parentConversationId'>;

export type ConversationWorkspaceTarget = {
  workspaceConversationId: string;
  workspaceReadFallbackConversationId?: string;
};

export type ConversationWorkspaceReadTarget = {
  workspaceConversationId: string;
  workspaceReadFallbackConversationIds: string[];
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

export function resolveConversationWorkspaceReadTarget(params: {
  conversationId: string;
  subAgents?: ReadonlyArray<SubAgentOwnershipLink>;
}): ConversationWorkspaceReadTarget {
  const initialConversationId = requireExactDurableScopeId(
    params.conversationId,
    'conversation_workspace_id_invalid',
  );

  const subAgentsBySessionId = new Map(
    (params.subAgents ?? []).map((subAgent): [string, SubAgentOwnershipLink] => [
      requireExactDurableScopeId(subAgent.sessionId, 'conversation_workspace_session_id_invalid'),
      subAgent,
    ]),
  );

  const visitedIds = new Set<string>();
  const ownershipPath: string[] = [];
  let workspaceConversationId = initialConversationId;

  while (!visitedIds.has(workspaceConversationId)) {
    visitedIds.add(workspaceConversationId);
    ownershipPath.push(workspaceConversationId);

    const subAgentParentConversationId = resolveOptionalExactDurableScopeId(
      subAgentsBySessionId.get(workspaceConversationId)?.parentConversationId,
      'conversation_workspace_parent_id_invalid',
    );
    if (subAgentParentConversationId) {
      workspaceConversationId = subAgentParentConversationId;
      continue;
    }

    break;
  }

  return {
    workspaceConversationId,
    workspaceReadFallbackConversationIds: ownershipPath.filter(
      (conversationId) => conversationId !== workspaceConversationId,
    ),
  };
}

export function resolveConversationWorkspaceTarget(params: {
  conversationId: string;
  subAgents?: ReadonlyArray<SubAgentOwnershipLink>;
}): ConversationWorkspaceTarget {
  const target = resolveConversationWorkspaceReadTarget(params);
  const workspaceReadFallbackConversationId = target.workspaceReadFallbackConversationIds[0];

  return {
    workspaceConversationId: target.workspaceConversationId,
    ...(workspaceReadFallbackConversationId ? { workspaceReadFallbackConversationId } : {}),
  };
}
