import type { AgentGoal } from '../../types/agentRun';
import type { LlmProviderConfig } from '../../types/provider';
import type { ToolEffectReceipt } from '../../types/toolEffectReceipt';

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
  /** Code-owned identity for an agent lifecycle tool call. Enables durable effect dispatch. */
  toolCallId?: string;
  /** Current lifecycle cancellation signal, revalidated immediately before effect dispatch. */
  executionSignal?: AbortSignal;
  /** Internal receipt handoff; never populated from provider-authored arguments. */
  captureEffectReceipt?: (receipt: ToolEffectReceipt) => void;
  /** Marks the authoritative receipt boundary complete even when dispatch failed closed. */
  finalizeEffectReceiptCapture?: () => void;
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
