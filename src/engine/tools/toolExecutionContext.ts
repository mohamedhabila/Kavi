import type { AgentGoal } from '../../types/agentRun';
import type { LlmProviderConfig } from '../../types/provider';
import type { ToolEffectReceipt } from '../../types/toolEffectReceipt';
import type { ToolDefinition } from '../../types/tool';

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
  /** Code-owned catalog visibility after persona and explicit tool authorization. */
  catalogVisibleToolNames?: string[];
  controlGraphGoals?: ReadonlyArray<AgentGoal>;
  agentRunId?: string;
  /** Required code-owned identity for one orchestrated execution boundary. */
  executionRunId?: string;
  /** Code-owned identity for an agent lifecycle tool call. Enables durable effect dispatch. */
  toolCallId?: string;
  /** Current lifecycle cancellation signal, revalidated immediately before effect dispatch. */
  executionSignal?: AbortSignal;
  /** Exact code-selected runtime declaration for dynamic MCP/skill receipt evidence. */
  runtimeToolDeclaration?: ToolDefinition;
  /** Internal receipt handoff; never populated from provider-authored arguments. */
  captureEffectReceipt?: (receipt: ToolEffectReceipt) => void;
  /** Marks the authoritative receipt boundary complete even when dispatch failed closed. */
  finalizeEffectReceiptCapture?: () => void;
  /** Internal graph signal for an effect whose outcome requires reconciliation. */
  captureEffectReconciliationRequired?: () => void;
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
