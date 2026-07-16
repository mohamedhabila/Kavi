import type { AssistantCompletionMetadata, MessageProviderReplay } from '../../../types/message';
import type { ModelCapabilities, ToolDefinition } from '../../../types/tool';
import type { UsagePromptCacheTelemetry, UsageTokenBuckets } from '../../../types/usage';

export type SystemPromptSection = {
  text: string;
  cacheable?: boolean;
};

export interface ModelsWithCapabilities {
  models: string[];
  capabilities: Record<string, ModelCapabilities>;
}

export interface StreamCallbacks {
  onToken: (token: string) => void;
  onReasoning?: (token: string) => void;
  onToolCall?: (toolCall: { id: string; name: string; arguments: string }) => void;
  onDone: (fullResponse: string) => void;
  onError: (error: Error) => void;
}

export interface PromptCachingOptions {
  enablePromptCaching?: boolean;
  promptCacheKey?: string;
  promptCacheRetention?: 'in_memory' | 'in-memory' | '24h';
}

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export type AnthropicEffort = 'low' | 'medium' | 'high' | 'max';

export type AnthropicOutputConfig = {
  effort?: AnthropicEffort;
  format?: Record<string, any>;
  [key: string]: unknown;
};

export type StructuredOutputOptions = {
  schema: Record<string, any>;
  mimeType?: string;
  name?: string;
  strict?: boolean;
};

export interface MessageRequestOptions extends PromptCachingOptions {
  conversationId?: string;
  model?: string;
  tools?: ToolDefinition[];
  /**
   * Cache-boundary metadata for the single system message. Ignored unless the
   * section texts join byte-for-byte to that approved message.
   */
  systemPromptSections?: SystemPromptSection[];
  toolChoice?: ToolChoiceMode;
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
  signal?: AbortSignal;
  reasoning_effort?: ReasoningEffort;
  thinking?: Record<string, unknown>;
  output_config?: AnthropicOutputConfig;
  structuredOutput?: StructuredOutputOptions;
  usageTelemetry?: {
    tokenBuckets?: UsageTokenBuckets;
    promptCache?: UsagePromptCacheTelemetry;
  };
  /** Code-owned idempotent synchronous guard invoked at provider dispatch boundaries. */
  requestDispatchGuard?: () => void;
}

export type ChatCompletionMessage = {
  role: string;
  content: string | any[];
  tool_call_id?: string;
  name?: string;
  [key: string]: any;
};

export type ToolChoiceMode =
  | 'auto'
  | 'required'
  | {
      type: 'required';
      disableParallelToolUse?: boolean;
    }
  | {
      type: 'tool';
      name: string;
      disableParallelToolUse?: boolean;
    };

export type StreamUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
};

export type StreamedToolCall = {
  id: string;
  name: string;
  arguments: string;
  raw?: Record<string, any>;
};

export type StreamEvent =
  | {
      type: 'token';
      content: string;
    }
  | {
      type: 'reasoning';
      content: string;
    }
  | {
      type: 'tool_call';
      toolCall: StreamedToolCall;
    }
  | {
      type: 'usage';
      usage: StreamUsage;
    }
  | {
      type: 'done';
      completion: AssistantCompletionMetadata;
      content?: string;
      providerReplay?: MessageProviderReplay;
    };
