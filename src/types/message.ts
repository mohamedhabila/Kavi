import type { SubAgentLifecycleEvent, SubAgentSnapshot } from './subAgent';
import type { Attachment } from './attachment';
import type { AgentRunTerminalReason } from './agentRun';
import type { ToolEffectReceipt } from './toolEffectReceipt';
import type { ModelTurnMemoryPolicyBinding } from '../engine/authority/modelTurnMemoryPolicyBinding';

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
  /** Code-owned, append-only execution receipts. Provider/model tool calls cannot populate this. */
  effectReceipts?: ReadonlyArray<ToolEffectReceipt>;
}

/**
 * Closed failure taxonomy for a tool call, set by the producer at the point the
 * failure is known — never inferred by matching `result`/`error` text. UI
 * presentation (see `toolCallOutcomePresentation.ts`) renders tone and copy from
 * this field alone; a tool call with no `failureKind` renders generic failure
 * copy rather than falling back to text sniffing. The runtime list is the single
 * source: the type derives from it, and persisted receipts are validated against it.
 */
export const TOOL_CALL_FAILURE_KINDS = [
  // Legacy/structural kinds — set before or independent of the executor's own
  // result, by the preflight and lifecycle layers. Left in place unchanged.
  'authority_revoked',
  'workflow_guard',
  'tool_filter',
  'unknown_tool',
  'tool_error',
  'runtime_error',
  /** Still in flight when the run finished; never started failing. */
  'not_awaited',
  /** Mobile-controller runtime outcomes — see `engine/mobileController/toolExecution.ts`. */
  'controller_action_review_unavailable',
  'user_takeover_required',
  // Structured failure taxonomy — set by the producer (approval gate, native
  // executors, the provider error classifier, the argument validator, or the
  // generic catch) at the point the failure is known.
  'approval_denied',
  'permission',
  'auth',
  'network',
  'timeout',
  'aborted',
  'invalid_arguments',
  'not_found',
  'unavailable',
  'rate_limited',
  'provider',
  'internal',
  /** The tool may have changed external state but the outcome could not be verified; do not retry automatically. */
  'reconciliation_required',
  'unknown',
] as const;

export type ToolCallFailureKind = (typeof TOOL_CALL_FAILURE_KINDS)[number];

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
  /** Exact provider- or code-owned terminal reason. Final validity fails closed without it. */
  finishReason: string;
  /** Exact code-owned retrieval event that supplied selected memory to this final response. */
  memoryRetrievalEventId?: string;
}

export interface SubAgentMessageEvent {
  type: 'sub-agent';
  event: SubAgentLifecycleEvent;
  snapshot: SubAgentSnapshot;
}

export type MessageMemoryPublicationDisposition =
  | null
  | 'enqueued'
  | 'opt_out'
  | 'ephemeral_thread'
  | 'withdrawn';

/** Content-free durable state for publishing this exact assistant message to memory. */
export interface MessageMemoryPublication {
  readonly version: 1;
  readonly disposition: MessageMemoryPublicationDisposition;
}

export type MessageCompactionProvenance =
  | Readonly<{
      version: 1;
      dependency: 'transcript_only';
    }>
  | Readonly<{
      version: 1;
      dependency: 'memory_dependent';
      /** Exact model-turn authorities whose memory-derived summaries remain represented. */
      originatingMemoryPolicyBindings: ReadonlyArray<ModelTurnMemoryPolicyBinding>;
    }>;

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
  /**
   * True when `reasoning` holds an app-generated stand-in rather than real
   * model reasoning (e.g. a "Using <tool>…" progress label written before any
   * genuine reasoning has streamed). Consumers such as `ThinkingBlock` must
   * suppress rendering from this flag, never by matching `reasoning` text.
   */
  isSyntheticReasoningPlaceholder?: boolean;
  providerReplay?: MessageProviderReplay;
  assistantMetadata?: AssistantMessageMetadata;
  memoryPublication?: MessageMemoryPublication;
  /** Code-owned provenance for synthetic context-compaction summaries. */
  compactionProvenance?: MessageCompactionProvenance;
  effectId?: 'confetti' | 'balloons' | 'spotlight';
  subAgentEvent?: SubAgentMessageEvent;
}
