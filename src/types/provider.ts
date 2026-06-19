import type { ModelCapabilities } from './tool';

export type LlmProviderKind = 'remote' | 'on-device';

export type LocalLlmRuntime = 'litert-lm';

export type LocalLlmAccelerator = 'cpu' | 'gpu' | 'npu' | 'tpu';

export type LocalLlmPlatform = 'android' | 'ios';

export type LocalLlmModelFamily = 'gemma' | 'qwen' | 'deepseek';

export type LlmProviderProtocol =
  | 'auto'
  | 'openai-responses'
  | 'openai-chat'
  | 'anthropic-messages'
  | 'gemini-native'
  | 'local';

export type LlmProviderFamily =
  | 'openai'
  | 'openrouter'
  | 'deepseek'
  | 'qwen'
  | 'kimi'
  | 'mistral'
  | 'voyage'
  | 'anthropic'
  | 'gemini'
  | 'ollama'
  | 'custom';

export interface LlmProviderCapabilityHints {
  preferredProtocol?: Exclude<LlmProviderProtocol, 'auto'>;
  supportsResponsesApi?: boolean;
  supportsModelDiscovery?: boolean;
  supportsImageGeneration?: boolean;
  supportsImageEditing?: boolean;
  supportsStructuredOutput?: boolean;
  supportsTools?: boolean;
  supportsAnthropicMessages?: boolean;
  supportsGeminiNative?: boolean;
  supportsPromptCaching?: boolean;
}

export interface LocalLlmModelCatalogEntry {
  id: string;
  name: string;
  family: LocalLlmModelFamily;
  runtime: LocalLlmRuntime;
  fileName: string;
  repositoryId: string;
  downloadRevision: string;
  downloadUrl: string;
  sizeBytes: number;
  sizeLabel: string;
  maxContextLength?: number;
  defaultMaxTokens?: number;
  defaultTopK?: number;
  defaultTopP?: number;
  defaultTemperature?: number;
  minDeviceMemoryGb?: number;
  supportedBackends: LocalLlmAccelerator[];
  defaultVisionAccelerator?: LocalLlmAccelerator;
  defaultAudioAccelerator?: LocalLlmAccelerator;
  supportedPlatforms: LocalLlmPlatform[];
  capabilities: ModelCapabilities;
  supportsAudioInput?: boolean;
  supportsThinking?: boolean;
  supportsSpeculativeDecoding?: boolean;
  taskTypes?: string[];
  bestForTaskTypes?: string[];
  availableUpdates?: Array<{
    fileName: string;
    downloadRevision: string;
  }>;
  updateInfo?: string;
  summary?: string;
}

export interface InstalledLocalLlmModel {
  modelId: string;
  fileName: string;
  localPath: string;
  installedAt: number;
  sizeBytes?: number;
  sourceUrl: string;
  repositoryId?: string;
  downloadRevision?: string;
}

export interface LocalLlmProviderMetadata {
  runtime: LocalLlmRuntime;
  backend?: LocalLlmAccelerator;
  catalogModelIds?: string[];
  installedModels?: InstalledLocalLlmModel[];
}

export interface LastUsedModelSelection {
  providerId: string;
  model: string;
}

export type ThinkingLevelPreference = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface LlmProviderConfig {
  id: string;
  name: string;
  kind?: LlmProviderKind;
  protocol?: LlmProviderProtocol;
  providerFamily?: LlmProviderFamily;
  capabilityHints?: LlmProviderCapabilityHints;
  baseUrl: string;
  apiKey: string;
  apiKeyRef?: string;
  model: string;
  availableModels?: string[];
  modelCapabilities?: Record<string, ModelCapabilities>;
  hiddenModels?: string[];
  local?: LocalLlmProviderMetadata;
  enabled: boolean;
}
