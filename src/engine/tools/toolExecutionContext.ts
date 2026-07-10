import type { AgentGoal } from '../../types/agentRun';
import type { LlmProviderConfig } from '../../types/provider';

export interface CodeOwnedCurrentUserMessage {
  id: string;
  text: string;
}

export interface ToolExecutionContext {
  provider?: LlmProviderConfig;
  allProviders?: LlmProviderConfig[];
  model?: string;
  /** Exact memory boundary; independent from the file workspace. */
  memoryConversationId?: string;
  workspaceConversationId?: string;
  workspaceReadFallbackConversationId?: string;
  availableToolNames?: string[];
  controlGraphGoals?: ReadonlyArray<AgentGoal>;
  agentRunId?: string;
  /** Exact raw request message selected by product code; never provider supplied. */
  currentUserMessage?: CodeOwnedCurrentUserMessage;
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
