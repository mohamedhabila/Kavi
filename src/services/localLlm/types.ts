import type { LocalLlmAccelerator, LocalLlmRuntime } from '../../types/provider';
import type { ToolDefinition } from '../../types/tool';
import type { NativeLocalLlmAccelerationFeatures, NativeLocalLlmAvailability } from './nativeTypes';

export type LocalChatMessage = {
  role: string;
  content: string | any[];
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<Record<string, any>>;
};

export type LocalStructuredToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, any>;
};

export type LocalStructuredToolCall = {
  name: string;
  arguments: Record<string, any>;
};

export type LocalStructuredToolResponse = {
  name: string;
  response: any;
};

export type LocalStructuredMessage = {
  role: 'user' | 'assistant' | 'tool';
  content?: string;
  toolCalls?: LocalStructuredToolCall[];
  toolResponses?: LocalStructuredToolResponse[];
};

export type LocalStructuredMessageGroup = LocalStructuredMessage[];

export interface LocalLlmModelInstallProgress {
  modelId: string;
  bytesWritten: number;
  totalBytes: number | null;
  fraction: number | null;
}

export interface InstallLocalLlmModelOptions {
  onProgress?: (progress: LocalLlmModelInstallProgress) => void;
}

export interface LocalLlmPartialDownloadState {
  modelId: string;
  sourceUrl: string;
  expectedSizeBytes: number | null;
  updatedAt: number;
}

export interface LocalLlmExecutionPolicy {
  modelId: string;
  modelName: string;
  runtime: LocalLlmRuntime;
  maxTokens: number;
  recommendedMaxTokens: number;
  maxContextLength: number | null;
  safeMaxContextWindowTokens: number | null;
  topK: number | null;
  topP: number | null;
  temperature: number | null;
  minDeviceMemoryGb: number | null;
  defaultVisionAccelerator: LocalLlmAccelerator | null;
  defaultAudioAccelerator: LocalLlmAccelerator | null;
}

export interface LocalLlmAvailability extends NativeLocalLlmAvailability {
  modelId?: string;
  minDeviceMemoryGb?: number | null;
  recommendedMaxTokens?: number | null;
  warningReason?: string | null;
}

export type LocalLlmRuntimeActivity = 'warming' | 'running';

export interface LocalLlmRuntimeStatus {
  runtime: LocalLlmRuntime;
  requestedBackend: LocalLlmAccelerator;
  resolvedBackend: LocalLlmAccelerator;
  resolvedBackendReason: 'default' | 'configured';
  observedBackend: LocalLlmAccelerator | null;
  activeBackend: LocalLlmAccelerator;
  backendSource: 'observed' | 'resolved';
  fellBackFromRequestedBackend: boolean;
  activity?: LocalLlmRuntimeActivity;
  backendFallbackCount?: number;
  supportedAccelerators?: LocalLlmAccelerator[];
  accelerationFeatures?: NativeLocalLlmAccelerationFeatures;
}

export interface LocalLlmRequestOptions {
  conversationId?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface LocalLlmWarmupOptions {
  conversationId?: string;
  systemPrompt?: string | null;
  tools?: ToolDefinition[];
}

export type LocalLlmRuntimeStatusListener = () => void;
