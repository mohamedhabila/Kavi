import type { AgentGoal } from '../../types/agentRun';
import type { LlmProviderConfig } from '../../types/provider';

export interface ToolExecutionContext {
  provider?: LlmProviderConfig;
  allProviders?: LlmProviderConfig[];
  model?: string;
  workspaceConversationId?: string;
  workspaceReadFallbackConversationId?: string;
  availableToolNames?: string[];
  controlGraphGoals?: ReadonlyArray<AgentGoal>;
  agentRunId?: string;
}

export type ResolvedToolWorkspaceContext = {
  workspaceConversationId: string;
  workspaceReadFallbackConversationId?: string;
};

export function resolveToolWorkspaceContext(
  conversationId: string,
  context?: ToolExecutionContext,
): ResolvedToolWorkspaceContext {
  return {
    workspaceConversationId: context?.workspaceConversationId || conversationId,
    workspaceReadFallbackConversationId: context?.workspaceReadFallbackConversationId,
  };
}
