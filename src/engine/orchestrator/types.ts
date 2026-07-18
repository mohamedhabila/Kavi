import type { TrackedAsyncOperation } from '../pendingAsyncOperations';
import type {
  AssistantMessageMetadata,
  Message,
  MessageProviderReplay,
  ToolCall,
} from '../../types/message';
import type { AgentRunAsyncOperation, AgentRunControlGraphState } from '../../types/agentRun';
import type { ToolDefinition } from '../../types/tool';
import type { LlmProviderConfig } from '../../types/provider';
import type { OrchestratorState } from '../../types/conversation';
import type { TokenUsage } from '../../types/usage';
import type { ThinkingLevel } from '../thinking';
import type { OrchestratorCompactionEvent } from '../orchestratorCompaction';
import type {
  MemoryContextStrategy,
  MemoryRetrievalStrategy,
} from '../../services/memory/memoryAccessPolicy';
import type { PendingVerifiedProcedureObservation } from '../../services/memory/verifiedProcedure/executionSession';
import type { WorkflowTaskAnchor } from '../graph/workflowTaskAnchor';
import type { ToolMessageOutcome } from '../toolExecution/toolMessageOutcome';
import type { MobileControllerRuntimePort } from '../mobileController/runtimeBinding';

export type OrchestratorTerminalDisposition =
  | 'final_candidate'
  | 'yielded'
  | 'blocked'
  | 'failed'
  | 'cancelled'
  | 'waiting'
  | 'command';

export type OrchestratorRunResult = Readonly<{
  terminalDisposition: OrchestratorTerminalDisposition;
  graphSnapshot?: AgentRunControlGraphState;
  pendingVerifiedProcedureObservation?: PendingVerifiedProcedureObservation;
}>;

export interface OrchestratorCallbacks {
  onStateChange: (state: OrchestratorState) => void;
  onToken: (token: string) => void;
  onReasoning?: (token: string) => void;
  onAssistantStreamReset?: () => void;
  onUserMessageEnriched?: (messageId: string, enrichedContent: string) => void;
  onToolCallQueued?: (toolCall: ToolCall) => void;
  onToolCallStart: (toolCall: ToolCall) => void;
  onToolCallComplete: (toolCall: ToolCall) => void;
  onPendingAsyncOperationsChange?: (operations: TrackedAsyncOperation[]) => void;
  onAgentControlGraphStateChange?: (state: AgentRunControlGraphState) => void;
  onAssistantMessage: (
    content: string,
    toolCalls?: ToolCall[],
    providerReplay?: MessageProviderReplay,
    assistantCompletion?: AssistantMessageMetadata,
  ) => void;
  onToolMessage: (outcome: ToolMessageOutcome) => void | Promise<void>;
  onError: (error: Error) => void;
  onUsage?: (usage: TokenUsage) => void;
  onDone: () => void;
  onCommandResult?: (result: { response?: string; action?: string }) => void;
  onCompaction?: (event: OrchestratorCompactionEvent) => void;
}

export interface OrchestratorOptions {
  provider: LlmProviderConfig;
  model: string;
  disableTooling?: boolean;
  conversationId: string;
  usageConversationId?: string;
  /** Durable memory boundary. Defaults to the current conversation, never the file workspace. */
  memoryConversationId?: string;
  workspaceConversationId?: string;
  workspaceReadFallbackConversationId?: string;
  systemPrompt: string;
  messages: Message[];
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortController;
  thinkingLevel?: ThinkingLevel;
  personaId: string;
  allProviders?: LlmProviderConfig[];
  enableCompaction?: boolean;
  enableFailover?: boolean;
  linkUnderstandingEnabled?: boolean;
  mediaUnderstandingEnabled?: boolean;
  maxLinks?: number;
  /** Deliberate request-scoped pins. Authorization filters never imply grounding. */
  explicitToolSurfaceToolNames?: ReadonlyArray<string>;
  toolFilter?: (toolName: string) => boolean;
  internalUserMessageCount?: number;
  initialPendingAsyncOperations?: AgentRunAsyncOperation[];
  initialAgentControlGraphState?: AgentRunControlGraphState;
  workflowScopeUserMessageId?: string;
  workflowTaskAnchor?: WorkflowTaskAnchor;
  taskId: string | null;
  /** Code-owned identity for this exact execution attempt. */
  executionRunId: string;
  agentRunId?: string;
  beforeEffectDispatch?: (toolName: string) => Promise<void>;
  /** Code-owned controller capability; omitted for ordinary chat sessions. */
  mobileController?: MobileControllerRuntimePort;
  memoryRetrievalStrategy?: MemoryRetrievalStrategy;
  memoryContextStrategy?: MemoryContextStrategy;
}
