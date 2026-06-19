import type { LocalLlmAccelerator, LocalLlmRuntime } from '../../types/provider';
import type { LocalLlmContextCompactionState } from './contextPressure';

export const LOCAL_LLM_STREAM_EVENT = 'KaviLocalLlmStream';

export interface NativeLocalLlmAccelerationFeatures {
  constrainedDecodingEnabled?: boolean;
  speculativeDecodingEnabled?: boolean;
  speculativeDecodingSupported?: boolean | null;
  constrainedDecodingEnabledCount?: number;
  speculativeDecodingEnabledCount?: number;
  capabilityCheckFailureCount?: number;
}

export interface NativeLocalLlmRuntimeMetrics {
  engineCreateCount?: number;
  engineReuseCount?: number;
  engineCloseCount?: number;
  conversationCreateCount?: number;
  conversationReuseCount?: number;
  conversationCloseCount?: number;
  backendFallbackCount?: number;
  activeRequestStartCount?: number;
  activeRequestEndCount?: number;
  activeRequestCancelCount?: number;
  constrainedDecodingEnabledCount?: number;
  speculativeDecodingEnabledCount?: number;
  capabilityCheckFailureCount?: number;
  lastConstrainedDecodingEnabled?: boolean;
  lastSpeculativeDecodingEnabled?: boolean;
  lastSpeculativeDecodingSupported?: boolean | null;
}

export interface NativeLocalLlmAvailability {
  available: boolean;
  linked: boolean;
  platform?: string | null;
  runtime?: string | null;
  reason?: string | null;
  supportsStreaming?: boolean;
  supportedAccelerators?: LocalLlmAccelerator[];
  deviceMemoryGb?: number | null;
  lowMemoryDevice?: boolean;
  accelerationFeatures?: NativeLocalLlmAccelerationFeatures;
  runtimeMetrics?: NativeLocalLlmRuntimeMetrics;
}

export interface NativeLocalLlmWarmupResult {
  backend?: LocalLlmAccelerator;
  visionBackend?: LocalLlmAccelerator;
  audioBackend?: LocalLlmAccelerator;
}

export interface NativeLocalLlmConversationToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

export interface NativeLocalLlmConversationToolCall {
  name: string;
  arguments: Record<string, any>;
}

export interface NativeLocalLlmConversationToolResponse {
  name: string;
  response: unknown;
}

export interface NativeLocalLlmConversationMessage {
  role: 'user' | 'assistant' | 'tool';
  content?: string;
  toolCalls?: NativeLocalLlmConversationToolCall[];
  toolResponses?: NativeLocalLlmConversationToolResponse[];
}

export interface NativeLocalLlmToolCallResult {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface NativeLocalLlmGenerateResult {
  text: string;
  toolCalls?: NativeLocalLlmToolCallResult[];
  backend?: LocalLlmAccelerator;
  visionBackend?: LocalLlmAccelerator;
  audioBackend?: LocalLlmAccelerator;
}

export interface NativeLocalLlmRequest {
  requestId: string;
  conversationKey?: string;
  modelPath: string;
  runtime?: LocalLlmRuntime;
  prompt?: string;
  systemPrompt?: string | null;
  history?: NativeLocalLlmConversationMessage[];
  currentMessage?: NativeLocalLlmConversationMessage;
  tools?: NativeLocalLlmConversationToolDefinition[];
  backend?: LocalLlmAccelerator;
  visionBackend?: LocalLlmAccelerator;
  audioBackend?: LocalLlmAccelerator;
  maxTokens?: number;
  contextWindowTokens?: number;
  estimatedInputTokens?: number;
  inputBudgetTokens?: number | null;
  contextPressureRatio?: number | null;
  contextCompactionState?: LocalLlmContextCompactionState;
  topK?: number;
  topP?: number;
  temperature?: number;
  enableConstrainedDecoding?: boolean;
  minDeviceMemoryGb?: number;
}

export interface NativeLocalLlmWarmupRequest {
  modelPath: string;
  conversationKey?: string;
  runtime?: LocalLlmRuntime;
  systemPrompt?: string | null;
  tools?: NativeLocalLlmConversationToolDefinition[];
  backend?: LocalLlmAccelerator;
  visionBackend?: LocalLlmAccelerator;
  audioBackend?: LocalLlmAccelerator;
  maxTokens?: number;
  contextWindowTokens?: number;
  estimatedInputTokens?: number;
  inputBudgetTokens?: number | null;
  contextPressureRatio?: number | null;
  contextCompactionState?: LocalLlmContextCompactionState;
  topK?: number;
  topP?: number;
  temperature?: number;
  enableConstrainedDecoding?: boolean;
  minDeviceMemoryGb?: number;
}

export interface NativeLocalLlmStreamEvent {
  requestId: string;
  type: 'token' | 'tool_call' | 'done' | 'error';
  content?: string;
  toolCall?: NativeLocalLlmToolCallResult;
  error?: string;
  backend?: LocalLlmAccelerator;
}
