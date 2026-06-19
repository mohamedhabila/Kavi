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
  onToolMessage: (toolCallId: string, result: string) => void | Promise<void>;
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
  workspaceConversationId?: string;
  workspaceReadFallbackConversationId?: string;
  systemPrompt: string;
  messages: Message[];
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortController;
  thinkingLevel?: ThinkingLevel;
  personaId?: string;
  allProviders?: LlmProviderConfig[];
  enableCompaction?: boolean;
  enableFailover?: boolean;
  linkUnderstandingEnabled?: boolean;
  mediaUnderstandingEnabled?: boolean;
  maxLinks?: number;
  toolFilter?: (toolName: string) => boolean;
  internalUserMessageCount?: number;
  initialPendingAsyncOperations?: AgentRunAsyncOperation[];
  initialAgentControlGraphState?: AgentRunControlGraphState;
  workflowScopeUserMessageId?: string;
  taskId?: string;
}
