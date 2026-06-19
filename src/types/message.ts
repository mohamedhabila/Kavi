import type { SubAgentLifecycleEvent, SubAgentSnapshot } from './subAgent';
import type { Attachment } from './attachment';
import type { AgentRunTerminalReason } from './agentRun';

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
  /** Provider-specific raw tool call payload for exact multi-turn replay. */
  raw?: Record<string, any>;
  status: 'pending' | 'running' | 'completed' | 'failed';
  failureKind?: ToolCallFailureKind;
  startedAt?: number;
  updatedAt?: number;
  completedAt?: number;
  progressText?: string;
  result?: string;
  error?: string;
}

export type ToolCallFailureKind =
  | 'workflow_guard'
  | 'tool_filter'
  | 'unknown_tool'
  | 'tool_error'
  | 'runtime_error';

export interface MessageProviderReplay {
  /** OpenAI Responses response ID retained for traceability and diagnostics. */
  openaiResponseId?: string;
  /** OpenAI Responses input-context items that immediately preceded this assistant output. */
  openaiResponseInputContext?: Record<string, any>[];
  /** Exact OpenAI Responses output items for replay on subsequent turns. */
  openaiResponseOutput?: Record<string, any>[];
  /** Exact Gemini candidate parts, including thought signatures and function-call IDs. */
  geminiParts?: Record<string, any>[];
  /** Exact Anthropic assistant content blocks for native multi-turn replay. */
  anthropicBlocks?: Record<string, any>[];
}

export type AssistantCompletionStatus = 'complete' | 'incomplete';

export interface AssistantCompletionMetadata {
  completionStatus: AssistantCompletionStatus;
  finishReason?: string;
  terminalReason?: AgentRunTerminalReason | string;
}

export type AssistantMessageKind = 'intermediate' | 'final';

export interface AssistantMessageMetadata extends AssistantCompletionMetadata {
  kind: AssistantMessageKind;
}

export interface SubAgentMessageEvent {
  type: 'sub-agent';
  event: SubAgentLifecycleEvent;
  snapshot: SubAgentSnapshot;
}

export interface Message {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  enrichedContent?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  timestamp: number;
  attachments?: Attachment[];
  isError?: boolean;
  reasoning?: string;
  providerReplay?: MessageProviderReplay;
  assistantMetadata?: AssistantMessageMetadata;
  effectId?: 'confetti' | 'balloons' | 'spotlight';
  subAgentEvent?: SubAgentMessageEvent;
}
