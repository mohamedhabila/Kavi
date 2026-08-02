import type { AgentGoal } from '../../types/agentRun';
import type { LlmProviderConfig } from '../../types/provider';
import type { ToolEffectReceipt } from '../../types/toolEffectReceipt';
import type { ToolDefinition } from '../../types/tool';
import type { ModelTurnMemoryPolicyBinding } from '../authority/modelTurnMemoryPolicyBinding';
import type { ToolObservedMemoryEvidenceCapability } from '../../services/memory/toolObservedMemoryEvidence';
import type { MobileControllerExecutionBinding } from '../mobileController/runtimeBinding';

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
  /** Code-owned authority bound to the exact model turn that proposed this call. */
  modelTurnMemoryPolicyBinding?: ModelTurnMemoryPolicyBinding;
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
  /** Opaque authorities minted from successful code-owned reads in this execution run. */
  toolObservedMemoryEvidence?: ReadonlyArray<ToolObservedMemoryEvidenceCapability>;
  /** Exact joined worker identities tracked by product code for this execution run. */
  pendingSessionIds?: ReadonlyArray<string>;
  /** Validated code-owned mobile capability and exact observation for this model turn. */
  mobileController?: MobileControllerExecutionBinding;
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
