import { Directory, File, Paths } from 'expo-file-system';
import { createDownloadResumable } from 'expo-file-system/legacy';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import {
  DEFAULT_LOCAL_LLM_BACKEND,
  DEFAULT_LOCAL_LLM_MODEL_ID,
  DEFAULT_LITERT_LM_TEMPERATURE,
  DEFAULT_LITERT_LM_TOP_K,
  DEFAULT_LITERT_LM_TOP_P,
  GEMMA_LOCAL_PROVIDER_NAME,
  getCurrentLocalLlmPlatform,
  getDefaultLocalLlmBackend,
  getLocalLlmCatalogEntriesForProvider,
  getLocalLlmCatalogEntry,
  getLocalLlmModelCapabilities,
  getSupportedLocalLlmCatalogEntries,
} from './catalog';
import {
  cancelNativeLocalLlmRequest,
  generateWithNativeLocalLlm,
  getNativeLocalLlmAvailability,
  streamWithNativeLocalLlm,
  warmupNativeLocalLlmEngine,
} from './native';
import type {
  InstalledLocalLlmModel,
  LlmProviderConfig,
  LocalLlmBackend,
  LocalLlmModelCatalogEntry,
  LocalLlmPlatform,
  LocalLlmRuntime,
  ToolDefinition,
} from '../../types';
import type { NativeLocalLlmAvailability } from './native';
import { generateId } from '../../utils/id';
import { unrefTimerIfSupported } from '../../utils/timers';
import { normalizeToolInputSchema } from '../../utils/toolSchema';

type LocalChatMessage = {
  role: string;
  content: string | any[];
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<Record<string, any>>;
};

type LocalStructuredToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, any>;
};

type LocalStructuredToolCall = {
  name: string;
  arguments: Record<string, any>;
};

type LocalStructuredToolResponse = {
  name: string;
  response: any;
};

type LocalStructuredMessage = {
  role: 'user' | 'assistant' | 'tool';
  content?: string;
  toolCalls?: LocalStructuredToolCall[];
  toolResponses?: LocalStructuredToolResponse[];
};

type LocalStructuredMessageGroup = LocalStructuredMessage[];

export interface LocalLlmModelInstallProgress {
  modelId: string;
  bytesWritten: number;
  totalBytes: number | null;
  fraction: number | null;
}

export interface InstallLocalLlmModelOptions {
  onProgress?: (progress: LocalLlmModelInstallProgress) => void;
}

interface LocalLlmPartialDownloadState {
  modelId: string;
  sourceUrl: string;
  expectedSizeBytes: number | null;
  updatedAt: number;
}

interface LocalLlmExecutionPolicy {
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
}

export interface LocalLlmAvailability extends NativeLocalLlmAvailability {
  modelId?: string;
  minDeviceMemoryGb?: number | null;
  recommendedMaxTokens?: number | null;
  warningReason?: string | null;
}

export interface LocalLlmRuntimeStatus {
  runtime: LocalLlmRuntime;
  requestedBackend: LocalLlmBackend;
  resolvedBackend: LocalLlmBackend;
  resolvedBackendReason: 'default' | 'configured' | 'emulator';
  observedBackend: LocalLlmBackend | null;
  activeBackend: LocalLlmBackend;
  backendSource: 'observed' | 'resolved';
  fellBackFromRequestedBackend: boolean;
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

type LocalLlmRuntimeStatusListener = () => void;

const LOCAL_LLM_PARTIAL_DOWNLOAD_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const LOCAL_LLM_DOWNLOAD_MAX_TOTAL_RETRYABLE_FAILURES = 10;
const LOCAL_LLM_DOWNLOAD_MAX_CONSECUTIVE_RETRYABLE_FAILURES = 4;
const LOCAL_LLM_DOWNLOAD_MAX_CONSECUTIVE_RESUME_NO_PROGRESS_FAILURES = 2;
const LOCAL_LLM_DOWNLOAD_RETRY_BASE_MS = 1_000;
const LOCAL_LLM_DOWNLOAD_RETRY_MAX_MS = 8_000;
const LOCAL_LLM_DOWNLOAD_RETRY_JITTER_RATIO = 0.25;
const LOCAL_LLM_DOWNLOAD_RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const LOCAL_LLM_DOWNLOAD_RETRYABLE_ERROR_PATTERN =
  /timed?\s*out|timeout|network|connection|socket|reset|temporar|unreachable|offline|internet|econn|enet|host\s+lookup|resolve\s+host|dns/i;
const LOCAL_LLM_DOWNLOAD_CANCELLED_ERROR_PATTERN = /cancelled|canceled/i;
const DEFAULT_LOCAL_LLM_MAX_TOKENS = 1_024;
const LOCAL_LLM_CONSTRAINED_DEVICE_MAX_TOKENS = 2_048;
const LOCAL_LLM_ANDROID_PRECISE_MEMORY_API_LEVEL = 34;
const LOCAL_LLM_NEAR_MINIMUM_MEMORY_HEADROOM_GB = 0.5;
const LOCAL_LLM_APPROX_CHARS_PER_TOKEN = 4;
const LOCAL_LLM_MESSAGE_OVERHEAD_TOKENS = 12;
const LOCAL_LLM_SYSTEM_OVERHEAD_TOKENS = 8;
const LOCAL_LLM_ENGINE_INIT_INPUT_RESERVE_TOKENS = 1_024;
const LOCAL_LLM_CONTEXT_WINDOW_BUCKET_TOKENS = 1_024;
const LOCAL_LLM_ANDROID_LITERT_LOW_TOTAL_CONTEXT_TOKENS = 4_096;
const LOCAL_LLM_ANDROID_LITERT_MID_TOTAL_CONTEXT_TOKENS = 6_144;
const LOCAL_LLM_ANDROID_LITERT_HIGH_TOTAL_CONTEXT_TOKENS = 8_192;
const LOCAL_LLM_ANDROID_LITERT_MID_TOTAL_CONTEXT_MEMORY_GB = 10;
const LOCAL_LLM_ANDROID_LITERT_HIGH_TOTAL_CONTEXT_MEMORY_GB = 14;
const LOCAL_LLM_ANDROID_LITERT_MIN_INPUT_BUDGET_TOKENS = 1_024;
const LOCAL_LLM_MEMORY_HARD_BLOCK_RATIO = 0.9;
const LOCAL_LLM_MEMORY_EPSILON_GB = 0.01;
const LOCAL_LLM_TEXT_ONLY_BUDGET_FALLBACK_NOTE =
  "Current on-device fallback: tool definitions were omitted to stay within this device's safe input budget. Do not emit tool calls or tool fences. Answer directly from the remaining conversation context.";
const LOCAL_GEMMA_TOOL_CALL_START_MARKER = '<|tool_call>';
const LOCAL_GEMMA_TOOL_CALL_END_MARKER = '<tool_call|>';
const LOCAL_GEMMA_TOOL_RESPONSE_START_MARKER = '<|tool_response>';
const LOCAL_GEMMA_TOOL_RESPONSE_END_MARKER = '<tool_response|>';
const LOCAL_GEMMA_ESCAPED_STRING_TOKENS = ['<|"|>', '<escape>', '<ctrl46>'] as const;
const LOCAL_GEMMA_CONTROL_MARKERS = [
  LOCAL_GEMMA_TOOL_CALL_START_MARKER,
  LOCAL_GEMMA_TOOL_RESPONSE_START_MARKER,
  LOCAL_GEMMA_TOOL_RESPONSE_END_MARKER,
];
const OBSERVED_LOCAL_LLM_BACKENDS = new Map<string, LocalLlmBackend>();
const LOCAL_LLM_RUNTIME_STATUS_LISTENERS = new Set<LocalLlmRuntimeStatusListener>();
const LOCAL_LLM_WARMUP_TASKS = new Map<string, Promise<void>>();

function notifyLocalLlmRuntimeStatusListeners(): void {
  LOCAL_LLM_RUNTIME_STATUS_LISTENERS.forEach((listener) => {
    try {
      listener();
    } catch {
      // Ignore listener failures to keep runtime observation side-effect free.
    }
  });
}

export function subscribeToLocalLlmRuntimeStatusChanges(
  listener: LocalLlmRuntimeStatusListener,
): () => void {
  LOCAL_LLM_RUNTIME_STATUS_LISTENERS.add(listener);
  return () => {
    LOCAL_LLM_RUNTIME_STATUS_LISTENERS.delete(listener);
  };
}

function buildLocalLlmWarmupTaskKey(params: {
  modelPath: string;
  runtime: LocalLlmRuntime;
  backend: LocalLlmBackend;
  conversationId?: string;
  systemPrompt?: string | null;
  tools?: LocalStructuredToolDefinition[];
  topK?: number;
  topP?: number;
  temperature?: number;
  enableConstrainedDecoding?: boolean;
}): string {
  const conversationScopedWarmup = Boolean(params.conversationId);
  return JSON.stringify({
    modelPath: getNativeLocalLlmModelPath(params.modelPath),
    runtime: params.runtime,
    backend: params.backend,
    conversationId: params.conversationId || null,
    systemPrompt: conversationScopedWarmup ? params.systemPrompt || null : null,
    tools: conversationScopedWarmup ? params.tools || [] : [],
    topK: conversationScopedWarmup ? (params.topK ?? null) : null,
    topP: conversationScopedWarmup ? (params.topP ?? null) : null,
    temperature: conversationScopedWarmup ? (params.temperature ?? null) : null,
    enableConstrainedDecoding: conversationScopedWarmup
      ? Boolean(params.enableConstrainedDecoding)
      : false,
  });
}

function normalizeObservedLocalLlmBackendKey(modelPath: string): string {
  return getNativeLocalLlmModelPath(modelPath).trim();
}

function rememberObservedLocalLlmBackend(
  modelPath: string,
  backend?: LocalLlmBackend | null,
): void {
  if (!backend) {
    return;
  }
  const normalizedKey = normalizeObservedLocalLlmBackendKey(modelPath);
  const previousBackend = OBSERVED_LOCAL_LLM_BACKENDS.get(normalizedKey);
  if (previousBackend === backend) {
    return;
  }

  OBSERVED_LOCAL_LLM_BACKENDS.set(normalizedKey, backend);
  notifyLocalLlmRuntimeStatusListeners();
}

function getObservedLocalLlmBackend(
  provider: Pick<LlmProviderConfig, 'model' | 'local'>,
  modelId = provider.model,
): LocalLlmBackend | null {
  const modelPath = resolveInstalledLocalLlmModelPath(provider as LlmProviderConfig, modelId);
  if (!modelPath) {
    return null;
  }

  return OBSERVED_LOCAL_LLM_BACKENDS.get(normalizeObservedLocalLlmBackendKey(modelPath)) ?? null;
}

function getAndroidApiLevel(): number | null {
  if (Platform.OS !== 'android') {
    return null;
  }

  const version = Platform.Version;
  if (typeof version === 'number' && Number.isFinite(version)) {
    return version;
  }

  const parsed = Number(version);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveLocalLlmBackend(
  provider: Pick<LlmProviderConfig, 'model' | 'local'>,
  modelId = provider.model,
  deviceMemoryGb?: number | null,
): LocalLlmBackend {
  return resolveLocalLlmBackendAnalysis(provider, modelId, deviceMemoryGb).backend;
}

function resolveLocalLlmBackendAnalysis(
  provider: Pick<LlmProviderConfig, 'model' | 'local'>,
  modelId = provider.model,
  deviceMemoryGb?: number | null,
): {
  backend: LocalLlmBackend;
  reason: LocalLlmRuntimeStatus['resolvedBackendReason'];
} {
  const preferredBackend = getDefaultLocalLlmBackend(modelId);
  const catalogEntry = getLocalLlmCatalogEntry(modelId);
  const configuredBackend = provider.local?.backend;
  const androidLiteRtRuntime =
    getCurrentLocalLlmPlatform() === 'android' && catalogEntry?.runtime === 'litert-lm';
  const minDeviceMemoryGb = catalogEntry?.minDeviceMemoryGb ?? null;
  const androidEmulator = androidLiteRtRuntime && Device.isDevice === false;

  if (androidEmulator) {
    return { backend: 'cpu', reason: 'emulator' };
  }

  if (!configuredBackend) {
    return { backend: preferredBackend, reason: 'default' };
  }

  if (
    configuredBackend === DEFAULT_LOCAL_LLM_BACKEND &&
    preferredBackend !== DEFAULT_LOCAL_LLM_BACKEND &&
    getCurrentLocalLlmPlatform() === 'android' &&
    getLocalLlmRuntime(provider, modelId) === 'litert-lm'
  ) {
    return { backend: preferredBackend, reason: 'default' };
  }

  return { backend: configuredBackend, reason: 'configured' };
}

function roundUpLocalLlmContextWindowTokens(tokens: number): number {
  return (
    Math.ceil(tokens / LOCAL_LLM_CONTEXT_WINDOW_BUCKET_TOKENS) *
    LOCAL_LLM_CONTEXT_WINDOW_BUCKET_TOKENS
  );
}

function getAndroidLiteRtSafeTotalContextWindowTokens(params: {
  maxTokens: number;
  deviceMemoryGb: number | null;
  maxContextLength: number | null;
}): number {
  let tierCap = LOCAL_LLM_ANDROID_LITERT_MID_TOTAL_CONTEXT_TOKENS;

  if (params.deviceMemoryGb != null) {
    if (
      params.deviceMemoryGb + LOCAL_LLM_MEMORY_EPSILON_GB >=
      LOCAL_LLM_ANDROID_LITERT_HIGH_TOTAL_CONTEXT_MEMORY_GB
    ) {
      tierCap = LOCAL_LLM_ANDROID_LITERT_HIGH_TOTAL_CONTEXT_TOKENS;
    } else if (
      params.deviceMemoryGb + LOCAL_LLM_MEMORY_EPSILON_GB <
      LOCAL_LLM_ANDROID_LITERT_MID_TOTAL_CONTEXT_MEMORY_GB
    ) {
      tierCap = LOCAL_LLM_ANDROID_LITERT_LOW_TOTAL_CONTEXT_TOKENS;
    }
  }

  const minimumSafeCap = roundUpLocalLlmContextWindowTokens(
    params.maxTokens + LOCAL_LLM_ANDROID_LITERT_MIN_INPUT_BUDGET_TOKENS,
  );
  const safeCap = Math.max(params.maxTokens, tierCap, minimumSafeCap);

  if (params.maxContextLength == null) {
    return safeCap;
  }

  return Math.max(params.maxTokens, Math.min(params.maxContextLength, safeCap));
}

function getLocalLlmExecutionPolicy(
  modelId: string,
  options?: {
    backend?: LocalLlmBackend;
    deviceMemoryGb?: number | null;
    platform?: LocalLlmPlatform;
  },
): LocalLlmExecutionPolicy {
  const catalogEntry = getLocalLlmCatalogEntry(modelId);
  const recommendedMaxTokens = catalogEntry?.defaultMaxTokens || DEFAULT_LOCAL_LLM_MAX_TOKENS;
  const runtime = catalogEntry?.runtime || 'litert-lm';
  const topK =
    runtime === 'litert-lm' ? (catalogEntry?.defaultTopK ?? DEFAULT_LITERT_LM_TOP_K) : null;
  const topP =
    runtime === 'litert-lm' ? (catalogEntry?.defaultTopP ?? DEFAULT_LITERT_LM_TOP_P) : null;
  const temperature =
    runtime === 'litert-lm'
      ? (catalogEntry?.defaultTemperature ?? DEFAULT_LITERT_LM_TEMPERATURE)
      : null;
  const minDeviceMemoryGb = catalogEntry?.minDeviceMemoryGb ?? null;
  const platform = options?.platform || getCurrentLocalLlmPlatform();
  const backend = options?.backend;
  const deviceMemoryGb =
    typeof options?.deviceMemoryGb === 'number' && Number.isFinite(options.deviceMemoryGb)
      ? options.deviceMemoryGb
      : null;

  let maxTokens = recommendedMaxTokens;
  if (
    platform === 'android' &&
    runtime === 'litert-lm' &&
    minDeviceMemoryGb != null &&
    deviceMemoryGb != null
  ) {
    const memoryRequirementStatus = getLocalLlmMemoryRequirementStatus(
      minDeviceMemoryGb,
      deviceMemoryGb,
    );
    const nearMinimumDevice =
      deviceMemoryGb <=
      minDeviceMemoryGb + LOCAL_LLM_NEAR_MINIMUM_MEMORY_HEADROOM_GB + LOCAL_LLM_MEMORY_EPSILON_GB;
    const prePreciseMemoryApi =
      (getAndroidApiLevel() || 0) < LOCAL_LLM_ANDROID_PRECISE_MEMORY_API_LEVEL;
    const borderlineCpuPath = backend === 'cpu' && nearMinimumDevice;

    if (
      memoryRequirementStatus === 'warn' ||
      borderlineCpuPath ||
      (prePreciseMemoryApi && nearMinimumDevice)
    ) {
      maxTokens = Math.min(maxTokens, LOCAL_LLM_CONSTRAINED_DEVICE_MAX_TOKENS);
    }
  }

  const safeMaxContextWindowTokens =
    platform === 'android' && runtime === 'litert-lm'
      ? getAndroidLiteRtSafeTotalContextWindowTokens({
          maxTokens,
          deviceMemoryGb,
          maxContextLength: catalogEntry?.maxContextLength ?? null,
        })
      : (catalogEntry?.maxContextLength ?? null);

  return {
    modelId,
    modelName: catalogEntry?.name || modelId,
    runtime,
    maxTokens,
    recommendedMaxTokens,
    maxContextLength: catalogEntry?.maxContextLength ?? null,
    safeMaxContextWindowTokens,
    topK,
    topP,
    temperature,
    minDeviceMemoryGb,
  };
}

function normalizeLocalLlmRequestMaxTokens(maxTokens?: number): number | null {
  if (typeof maxTokens !== 'number' || !Number.isFinite(maxTokens) || maxTokens <= 0) {
    return null;
  }

  return Math.max(1, Math.floor(maxTokens));
}

function normalizeLocalLlmRequestTemperature(temperature?: number): number | null {
  if (typeof temperature !== 'number' || !Number.isFinite(temperature) || temperature < 0) {
    return null;
  }

  return temperature;
}

function applyLocalLlmRequestOverrides(
  executionPolicy: LocalLlmExecutionPolicy,
  options?: LocalLlmRequestOptions,
): LocalLlmExecutionPolicy {
  const requestedMaxTokens = normalizeLocalLlmRequestMaxTokens(options?.maxTokens);
  const requestedTemperature = normalizeLocalLlmRequestTemperature(options?.temperature);

  const maxTokens =
    requestedMaxTokens != null
      ? Math.min(executionPolicy.maxTokens, requestedMaxTokens)
      : executionPolicy.maxTokens;
  const temperature =
    executionPolicy.runtime === 'litert-lm' && requestedTemperature != null
      ? requestedTemperature
      : executionPolicy.temperature;

  if (maxTokens === executionPolicy.maxTokens && temperature === executionPolicy.temperature) {
    return executionPolicy;
  }

  return {
    ...executionPolicy,
    maxTokens,
    temperature,
  };
}

export async function getLocalLlmRuntimeStatus(
  provider: Pick<LlmProviderConfig, 'model' | 'local'>,
  modelId = provider.model,
): Promise<LocalLlmRuntimeStatus | null> {
  if (!isOnDeviceLlmProvider(provider)) {
    return null;
  }

  const nativeAvailability = await getNativeLocalLlmAvailability();
  const runtime = getLocalLlmRuntime(provider, modelId);
  const requestedBackend = provider.local?.backend || getDefaultLocalLlmBackend(modelId);
  const resolvedBackendAnalysis = resolveLocalLlmBackendAnalysis(
    provider,
    modelId,
    nativeAvailability.deviceMemoryGb ?? null,
  );
  const resolvedBackend = resolvedBackendAnalysis.backend;
  const observedBackend = getObservedLocalLlmBackend(provider, modelId);
  const activeBackend = observedBackend || resolvedBackend;

  return {
    runtime,
    requestedBackend,
    resolvedBackend,
    resolvedBackendReason: resolvedBackendAnalysis.reason,
    observedBackend,
    activeBackend,
    backendSource: observedBackend ? 'observed' : 'resolved',
    fellBackFromRequestedBackend: observedBackend != null && observedBackend !== requestedBackend,
  };
}

export function formatLocalLlmRuntimeStatusLabel(status: LocalLlmRuntimeStatus): string {
  const backendLabel = status.activeBackend.toUpperCase();

  if (status.backendSource === 'observed') {
    return status.fellBackFromRequestedBackend
      ? `Running on ${backendLabel} (GPU fallback)`
      : `Running on ${backendLabel}`;
  }

  if (status.activeBackend === 'cpu') {
    if (status.resolvedBackendReason === 'emulator') {
      return 'Likely CPU (emulator)';
    }
    if (status.resolvedBackendReason === 'configured') {
      return 'Likely CPU (configured)';
    }
  }

  return `Likely ${backendLabel}`;
}

function getNativeLocalLlmMaximumContextWindowTokens(
  executionPolicy: LocalLlmExecutionPolicy,
): number | null {
  if (executionPolicy.safeMaxContextWindowTokens != null) {
    return Math.max(executionPolicy.maxTokens, executionPolicy.safeMaxContextWindowTokens);
  }

  if (executionPolicy.maxContextLength != null) {
    return Math.max(executionPolicy.maxTokens, executionPolicy.maxContextLength);
  }

  return null;
}

function getNativeLocalLlmMinimumInputReserveTokens(
  executionPolicy: LocalLlmExecutionPolicy,
): number {
  if (executionPolicy.runtime !== 'litert-lm') {
    return 0;
  }

  const maxContextWindowTokens = getNativeLocalLlmMaximumContextWindowTokens(executionPolicy);
  if (maxContextWindowTokens == null) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(
      LOCAL_LLM_ENGINE_INIT_INPUT_RESERVE_TOKENS,
      maxContextWindowTokens - executionPolicy.maxTokens,
    ),
  );
}

function normalizeNativeLocalLlmContextWindowTokens(
  requestedTokens: number,
  executionPolicy: LocalLlmExecutionPolicy,
): number {
  const minimumContextWindowTokens = executionPolicy.maxTokens;
  const maximumContextWindowTokens = getNativeLocalLlmMaximumContextWindowTokens(executionPolicy);
  const roundedTokens =
    Math.ceil(
      Math.max(minimumContextWindowTokens, requestedTokens) /
        LOCAL_LLM_CONTEXT_WINDOW_BUCKET_TOKENS,
    ) * LOCAL_LLM_CONTEXT_WINDOW_BUCKET_TOKENS;

  if (maximumContextWindowTokens == null) {
    return roundedTokens;
  }

  return Math.max(minimumContextWindowTokens, Math.min(maximumContextWindowTokens, roundedTokens));
}

function getNativeLocalLlmRequestContextWindowTokens(
  executionPolicy: LocalLlmExecutionPolicy,
  estimatedInputTokens = 0,
): number {
  return normalizeNativeLocalLlmContextWindowTokens(
    executionPolicy.maxTokens +
      Math.max(estimatedInputTokens, getNativeLocalLlmMinimumInputReserveTokens(executionPolicy)),
    executionPolicy,
  );
}

function getNativeLocalLlmRequestSamplingConfig(executionPolicy: LocalLlmExecutionPolicy): {
  topK?: number;
  topP?: number;
  temperature?: number;
} {
  if (
    executionPolicy.runtime !== 'litert-lm' ||
    executionPolicy.topK == null ||
    executionPolicy.topP == null ||
    executionPolicy.temperature == null
  ) {
    return {};
  }

  return {
    topK: executionPolicy.topK,
    topP: executionPolicy.topP,
    temperature: executionPolicy.temperature,
  };
}

function shouldEnableNativeLocalLlmConstrainedDecoding(
  executionPolicy: LocalLlmExecutionPolicy,
  tools?: LocalStructuredToolDefinition[],
): boolean {
  return executionPolicy.runtime === 'litert-lm' && Boolean(tools?.length);
}

function formatLocalLlmPlatform(platform: LocalLlmPlatform): string {
  return platform === 'ios' ? 'iOS' : 'Android';
}

function formatLocalLlmMemoryGb(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0';
  }

  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function buildUnsupportedLocalLlmPlatformReason(modelId: string): string {
  const catalogEntry = getLocalLlmCatalogEntry(modelId);
  if (!catalogEntry) {
    return `Unknown local model: ${modelId}.`;
  }

  const platformList = catalogEntry.supportedPlatforms.map(formatLocalLlmPlatform).join(' or ');
  return `${catalogEntry.name} is only supported on ${platformList}.`;
}

function getLocalLlmMemoryRequirementStatus(
  minDeviceMemoryGb: number,
  deviceMemoryGb: number,
): 'ok' | 'warn' | 'block' {
  const hardBlockFloorGb = minDeviceMemoryGb * LOCAL_LLM_MEMORY_HARD_BLOCK_RATIO;
  if (deviceMemoryGb + LOCAL_LLM_MEMORY_EPSILON_GB < hardBlockFloorGb) {
    return 'block';
  }
  if (deviceMemoryGb + LOCAL_LLM_MEMORY_EPSILON_GB < minDeviceMemoryGb) {
    return 'warn';
  }
  return 'ok';
}

function getFallbackLocalLlmRecommendation(
  modelId: string,
  deviceMemoryGb: number | null,
): LocalLlmModelCatalogEntry | null {
  const catalogEntry = getLocalLlmCatalogEntry(modelId);
  if (!catalogEntry) {
    return null;
  }

  const currentMinDeviceMemoryGb = catalogEntry.minDeviceMemoryGb;
  if (currentMinDeviceMemoryGb == null) {
    return null;
  }

  const candidates = getSupportedLocalLlmCatalogEntries()
    .filter((entry) => {
      if (entry.id === modelId || entry.runtime !== catalogEntry.runtime) {
        return false;
      }

      const candidateMinDeviceMemoryGb = entry.minDeviceMemoryGb;
      if (
        candidateMinDeviceMemoryGb == null ||
        candidateMinDeviceMemoryGb >= currentMinDeviceMemoryGb
      ) {
        return false;
      }

      if (deviceMemoryGb == null) {
        return true;
      }

      return (
        getLocalLlmMemoryRequirementStatus(candidateMinDeviceMemoryGb, deviceMemoryGb) !== 'block'
      );
    })
    .sort((left, right) => (right.minDeviceMemoryGb || 0) - (left.minDeviceMemoryGb || 0));

  return candidates[0] || null;
}

function buildFallbackLocalLlmSuggestion(
  policy: LocalLlmExecutionPolicy,
  deviceMemoryGb: number | null,
): string {
  const fallbackEntry = getFallbackLocalLlmRecommendation(policy.modelId, deviceMemoryGb);
  if (!fallbackEntry) {
    return '';
  }

  return ` Try ${fallbackEntry.name} instead on this device.`;
}

function buildLowMemoryLocalLlmReason(
  policy: LocalLlmExecutionPolicy,
  deviceMemoryGb: number,
): string {
  return `${policy.modelName} is officially recommended for devices with at least ${policy.minDeviceMemoryGb} GB of memory. This device reports about ${formatLocalLlmMemoryGb(deviceMemoryGb)} GB, which is materially below that recommendation. To avoid startup failures, this model is blocked on this device.${buildFallbackLocalLlmSuggestion(policy, deviceMemoryGb)}`;
}

function buildBorderlineLocalLlmMemoryWarning(
  policy: LocalLlmExecutionPolicy,
  deviceMemoryGb: number,
): string {
  const capNote =
    policy.maxTokens < policy.recommendedMaxTokens
      ? ` To reduce startup failures on this device, output is capped to about ${policy.maxTokens} tokens.`
      : '';
  return `${policy.modelName} is officially recommended for devices with at least ${policy.minDeviceMemoryGb} GB of memory. This device reports about ${formatLocalLlmMemoryGb(deviceMemoryGb)} GB, so performance or stability may be limited, but you can still try it.${capNote}${buildFallbackLocalLlmSuggestion(policy, deviceMemoryGb)}`;
}

function buildConstrainedLocalLlmExecutionWarning(policy: LocalLlmExecutionPolicy): string | null {
  if (policy.maxTokens >= policy.recommendedMaxTokens) {
    return null;
  }

  return `${policy.modelName} will use a conservative ${policy.maxTokens}-token output cap on this device to reduce startup failures near the minimum memory requirement.`;
}

function buildLowRamLocalLlmReason(policy: LocalLlmExecutionPolicy): string {
  return `${policy.modelName} is not supported on Android low-RAM devices.`;
}

function shouldWarmupLocalLlmEngine(
  executionPolicy: LocalLlmExecutionPolicy,
  deviceMemoryGb: number | null,
  conversationScoped: boolean,
): boolean {
  if (conversationScoped) {
    return true;
  }

  if (getCurrentLocalLlmPlatform() !== 'android' || executionPolicy.runtime !== 'litert-lm') {
    return true;
  }

  if (executionPolicy.minDeviceMemoryGb == null || deviceMemoryGb == null) {
    return true;
  }

  const memoryRequirementStatus = getLocalLlmMemoryRequirementStatus(
    executionPolicy.minDeviceMemoryGb,
    deviceMemoryGb,
  );

  if (memoryRequirementStatus !== 'ok') {
    return false;
  }

  return (
    deviceMemoryGb >
    executionPolicy.minDeviceMemoryGb +
      LOCAL_LLM_NEAR_MINIMUM_MEMORY_HEADROOM_GB +
      LOCAL_LLM_MEMORY_EPSILON_GB
  );
}

async function ensureLocalLlmModelCanRun(modelId: string): Promise<LocalLlmAvailability> {
  const availability = await getLocalLlmAvailability(modelId);
  if (!availability.available) {
    throw new Error(
      availability.reason || `On-device model ${modelId} is unavailable on this device.`,
    );
  }
  return availability;
}

function normalizeInstalledModels(provider: LlmProviderConfig): InstalledLocalLlmModel[] {
  const seen = new Set<string>();
  const models: InstalledLocalLlmModel[] = [];

  for (const entry of provider.local?.installedModels || []) {
    if (!entry || typeof entry.modelId !== 'string' || seen.has(entry.modelId)) {
      continue;
    }
    seen.add(entry.modelId);
    models.push(entry);
  }

  return models;
}

function ensureLocalLlmModelsDirectory(): Directory {
  const dir = new Directory(Paths.document, 'local-llm', 'models');
  if (!dir.exists) {
    dir.create({ idempotent: true, intermediates: true });
  }
  return dir;
}

function getLocalLlmModelFile(modelId: string): File {
  const catalogEntry = getLocalLlmCatalogEntry(modelId);
  if (!catalogEntry) {
    throw new Error(`Unknown local model: ${modelId}`);
  }

  return new File(ensureLocalLlmModelsDirectory(), catalogEntry.fileName);
}

function getLocalLlmModelTempFile(modelId: string): File {
  const catalogEntry = getLocalLlmCatalogEntry(modelId);
  if (!catalogEntry) {
    throw new Error(`Unknown local model: ${modelId}`);
  }

  return new File(ensureLocalLlmModelsDirectory(), `${catalogEntry.fileName}.download`);
}

function getLocalLlmModelPartialDownloadStateFile(modelId: string): File {
  const catalogEntry = getLocalLlmCatalogEntry(modelId);
  if (!catalogEntry) {
    throw new Error(`Unknown local model: ${modelId}`);
  }

  return new File(ensureLocalLlmModelsDirectory(), `${catalogEntry.fileName}.download.json`);
}

function getLocalLlmModelRecordedSize(sizeBytes: number | null | undefined): number | null {
  return typeof sizeBytes === 'number' && Number.isFinite(sizeBytes) && sizeBytes > 0
    ? Math.max(0, sizeBytes)
    : null;
}

function getLocalLlmModelObservedSize(file: File): number {
  return getLocalLlmModelRecordedSize(file.size) || 0;
}

function getMinimumExpectedLocalLlmModelSize(
  modelId: string,
  installedSizeBytes?: number | null,
): number | null {
  const catalogSizeBytes = getLocalLlmModelRecordedSize(
    getLocalLlmCatalogEntry(modelId)?.sizeBytes,
  );
  const recordedInstalledSizeBytes = getLocalLlmModelRecordedSize(installedSizeBytes);

  if (catalogSizeBytes == null && recordedInstalledSizeBytes == null) {
    return null;
  }

  return Math.max(catalogSizeBytes || 0, recordedInstalledSizeBytes || 0);
}

function isValidLocalLlmModelFile(
  modelId: string,
  file: File,
  installedSizeBytes?: number | null,
): boolean {
  if (!file.exists) {
    return false;
  }

  const minimumExpectedSize = getMinimumExpectedLocalLlmModelSize(modelId, installedSizeBytes);
  if (minimumExpectedSize == null) {
    return true;
  }

  return getLocalLlmModelObservedSize(file) >= minimumExpectedSize;
}

function getNativeLocalLlmModelPath(modelPath: string): string {
  const trimmedPath = modelPath.trim();
  if (!/^file:/i.test(trimmedPath)) {
    return trimmedPath;
  }

  const withoutScheme = trimmedPath.replace(/^file:\/\//i, '');
  const normalizedPath = withoutScheme.startsWith('/') ? withoutScheme : `/${withoutScheme}`;
  try {
    return decodeURIComponent(normalizedPath);
  } catch {
    return normalizedPath;
  }
}

function emitLocalLlmInstallProgress(
  modelId: string,
  bytesWritten: number,
  totalBytes: number | null,
  onProgress?: InstallLocalLlmModelOptions['onProgress'],
): void {
  if (!onProgress) {
    return;
  }

  const normalizedTotal =
    typeof totalBytes === 'number' && Number.isFinite(totalBytes) && totalBytes > 0
      ? totalBytes
      : null;
  const fraction = normalizedTotal
    ? Math.max(0, Math.min(1, bytesWritten / normalizedTotal))
    : null;
  onProgress({
    modelId,
    bytesWritten,
    totalBytes: normalizedTotal,
    fraction,
  });
}

async function readLocalLlmPartialDownloadState(
  modelId: string,
): Promise<LocalLlmPartialDownloadState | null> {
  const stateFile = getLocalLlmModelPartialDownloadStateFile(modelId);
  if (!stateFile.exists) {
    return null;
  }

  try {
    const raw = await stateFile.text();
    const parsed = JSON.parse(raw) as Partial<LocalLlmPartialDownloadState> | null;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.sourceUrl !== 'string') {
      stateFile.delete();
      return null;
    }

    return {
      modelId: typeof parsed.modelId === 'string' ? parsed.modelId : modelId,
      sourceUrl: parsed.sourceUrl,
      expectedSizeBytes: getLocalLlmModelRecordedSize(parsed.expectedSizeBytes),
      updatedAt:
        typeof parsed.updatedAt === 'number' && Number.isFinite(parsed.updatedAt)
          ? parsed.updatedAt
          : 0,
    };
  } catch {
    stateFile.delete();
    return null;
  }
}

function writeLocalLlmPartialDownloadState(
  modelId: string,
  state: LocalLlmPartialDownloadState,
): void {
  getLocalLlmModelPartialDownloadStateFile(modelId).write(JSON.stringify(state));
}

function clearLocalLlmPartialDownloadState(modelId: string): void {
  const stateFile = getLocalLlmModelPartialDownloadStateFile(modelId);
  if (stateFile.exists) {
    stateFile.delete();
  }
}

function clearLocalLlmPartialDownloadArtifacts(modelId: string): void {
  const tempFile = getLocalLlmModelTempFile(modelId);
  if (tempFile.exists) {
    tempFile.delete();
  }
  clearLocalLlmPartialDownloadState(modelId);
}

function getLocalLlmDownloadErrorMessage(error: unknown): string {
  if (
    error instanceof Error &&
    typeof error.message === 'string' &&
    error.message.trim().length > 0
  ) {
    return error.message.trim();
  }
  return String(error ?? 'Unknown error');
}

function isRetryableLocalLlmDownloadStatus(status: number): boolean {
  return LOCAL_LLM_DOWNLOAD_RETRYABLE_STATUS_CODES.has(status);
}

function isCancelledLocalLlmDownloadError(error: unknown): boolean {
  return LOCAL_LLM_DOWNLOAD_CANCELLED_ERROR_PATTERN.test(getLocalLlmDownloadErrorMessage(error));
}

function isRetryableLocalLlmDownloadError(error: unknown): boolean {
  if (isCancelledLocalLlmDownloadError(error)) {
    return false;
  }

  const message = getLocalLlmDownloadErrorMessage(error);
  const statusMatch = message.match(/status\s+(\d{3})/i);
  if (statusMatch) {
    const parsedStatus = Number(statusMatch[1]);
    if (Number.isFinite(parsedStatus)) {
      return isRetryableLocalLlmDownloadStatus(parsedStatus);
    }
  }

  return LOCAL_LLM_DOWNLOAD_RETRYABLE_ERROR_PATTERN.test(message);
}

function createLocalLlmDownloadRetryLimitError(modelId: string, error: unknown): Error {
  const lastError = getLocalLlmDownloadErrorMessage(error);
  const retryLimitError = new Error(
    `Download for ${modelId} failed after repeated transient network interruptions. Partial progress was preserved when safe; retry again when the connection is stable. Last error: ${lastError}`,
  );

  if (typeof retryLimitError.stack === 'string') {
    retryLimitError.stack = retryLimitError.stack.split('\n', 1)[0];
  }

  return retryLimitError;
}

function getLocalLlmDownloadRetryDelayMs(consecutiveFailures: number): number {
  const exponentialDelay = Math.min(
    LOCAL_LLM_DOWNLOAD_RETRY_MAX_MS,
    LOCAL_LLM_DOWNLOAD_RETRY_BASE_MS * 2 ** Math.max(0, consecutiveFailures - 1),
  );
  const jitterWindow = Math.max(
    0,
    Math.floor(exponentialDelay * LOCAL_LLM_DOWNLOAD_RETRY_JITTER_RATIO),
  );
  const jitter = jitterWindow > 0 ? Math.floor(Math.random() * (jitterWindow + 1)) : 0;
  return exponentialDelay + jitter;
}

function waitForLocalLlmDownloadRetry(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    unrefTimerIfSupported(timer);
  });
}

function isLocalLlmPartialDownloadStale(params: {
  modelId: string;
  tempFile: File;
  sourceUrl: string;
  partialState: LocalLlmPartialDownloadState | null;
  expectedSizeBytes?: number | null;
}): boolean {
  const observedSize = getLocalLlmModelObservedSize(params.tempFile);
  if (observedSize <= 0) {
    return true;
  }

  if (!params.partialState) {
    return true;
  }

  if (params.partialState.modelId !== params.modelId) {
    return true;
  }

  if (
    params.partialState.updatedAt <= 0 ||
    Date.now() - params.partialState.updatedAt > LOCAL_LLM_PARTIAL_DOWNLOAD_MAX_AGE_MS
  ) {
    return true;
  }

  if (params.partialState?.sourceUrl && params.partialState.sourceUrl !== params.sourceUrl) {
    return true;
  }

  const recordedExpectedSize = getLocalLlmModelRecordedSize(params.partialState?.expectedSizeBytes);
  const minimumExpectedSize = getMinimumExpectedLocalLlmModelSize(
    params.modelId,
    recordedExpectedSize ?? params.expectedSizeBytes,
  );

  if (
    recordedExpectedSize != null &&
    minimumExpectedSize != null &&
    recordedExpectedSize !== minimumExpectedSize
  ) {
    return true;
  }

  return minimumExpectedSize != null && observedSize > minimumExpectedSize;
}

function getLocalLlmResumeOffsetBytes(params: {
  modelId: string;
  tempFile: File;
  expectedSizeBytes?: number | null;
  partialState: LocalLlmPartialDownloadState | null;
}): number | null {
  if (getCurrentLocalLlmPlatform() !== 'android' || !params.tempFile.exists) {
    return null;
  }

  const observedSize = getLocalLlmModelObservedSize(params.tempFile);
  if (observedSize <= 0) {
    return null;
  }

  const minimumExpectedSize = getMinimumExpectedLocalLlmModelSize(
    params.modelId,
    params.partialState?.expectedSizeBytes ?? params.expectedSizeBytes,
  );

  if (minimumExpectedSize != null && observedSize >= minimumExpectedSize) {
    return null;
  }

  return observedSize;
}

async function ensureLocalLlmModelArtifactReady(params: {
  modelId: string;
  sourceUrl: string;
  destination: File;
  tempDestination: File;
  expectedSizeBytes?: number | null;
  onProgress?: InstallLocalLlmModelOptions['onProgress'];
}): Promise<void> {
  const { modelId, sourceUrl, destination, tempDestination, expectedSizeBytes, onProgress } =
    params;

  if (destination.exists && !isValidLocalLlmModelFile(modelId, destination, expectedSizeBytes)) {
    destination.delete();
  }

  let partialState = await readLocalLlmPartialDownloadState(modelId);
  if (
    tempDestination.exists &&
    isLocalLlmPartialDownloadStale({
      modelId,
      tempFile: tempDestination,
      sourceUrl,
      partialState,
      expectedSizeBytes,
    })
  ) {
    clearLocalLlmPartialDownloadArtifacts(modelId);
    partialState = null;
  }

  if (
    !destination.exists &&
    isValidLocalLlmModelFile(modelId, tempDestination, expectedSizeBytes)
  ) {
    tempDestination.move(destination);
    clearLocalLlmPartialDownloadState(modelId);
  }

  if (isValidLocalLlmModelFile(modelId, destination, expectedSizeBytes)) {
    if (tempDestination.exists) {
      clearLocalLlmPartialDownloadArtifacts(modelId);
    } else {
      clearLocalLlmPartialDownloadState(modelId);
    }
    return;
  }

  let usedFreshFallback = false;
  let totalRetryableFailures = 0;
  let consecutiveRetryableFailures = 0;
  let consecutiveResumeNoProgressFailures = 0;

  while (!isValidLocalLlmModelFile(modelId, destination, expectedSizeBytes)) {
    partialState = await readLocalLlmPartialDownloadState(modelId);
    if (
      tempDestination.exists &&
      isLocalLlmPartialDownloadStale({
        modelId,
        tempFile: tempDestination,
        sourceUrl,
        partialState,
        expectedSizeBytes,
      })
    ) {
      clearLocalLlmPartialDownloadArtifacts(modelId);
      partialState = null;
    }

    const resumeOffsetBytes = getLocalLlmResumeOffsetBytes({
      modelId,
      tempFile: tempDestination,
      expectedSizeBytes,
      partialState,
    });
    const resumeData = resumeOffsetBytes != null ? String(resumeOffsetBytes) : undefined;
    const initialBytesWritten = resumeOffsetBytes || 0;
    const attemptStartBytes = getLocalLlmModelObservedSize(tempDestination);
    const totalBytes = getMinimumExpectedLocalLlmModelSize(
      modelId,
      partialState?.expectedSizeBytes ?? expectedSizeBytes,
    );

    emitLocalLlmInstallProgress(modelId, initialBytesWritten, totalBytes, onProgress);

    writeLocalLlmPartialDownloadState(modelId, {
      modelId,
      sourceUrl,
      expectedSizeBytes: totalBytes,
      updatedAt: Date.now(),
    });

    const downloadTask = createDownloadResumable(
      sourceUrl,
      tempDestination.uri,
      {},
      (downloadProgress) => {
        const reportedTotalBytes =
          typeof downloadProgress.totalBytesExpectedToWrite === 'number' &&
          Number.isFinite(downloadProgress.totalBytesExpectedToWrite) &&
          downloadProgress.totalBytesExpectedToWrite > 0
            ? downloadProgress.totalBytesExpectedToWrite
            : totalBytes;
        emitLocalLlmInstallProgress(
          modelId,
          downloadProgress.totalBytesWritten,
          reportedTotalBytes,
          onProgress,
        );
      },
      resumeData,
    );

    let downloadResult;
    try {
      downloadResult = resumeData
        ? await downloadTask.resumeAsync()
        : await downloadTask.downloadAsync();
    } catch (error) {
      const observedBytesAfterFailure = getLocalLlmModelObservedSize(tempDestination);
      const madeProgress = observedBytesAfterFailure > attemptStartBytes;

      if (!isRetryableLocalLlmDownloadError(error)) {
        throw error;
      }

      totalRetryableFailures += 1;
      consecutiveRetryableFailures = madeProgress ? 1 : consecutiveRetryableFailures + 1;
      consecutiveResumeNoProgressFailures =
        resumeData && !madeProgress ? consecutiveResumeNoProgressFailures + 1 : 0;

      if (
        resumeData &&
        !madeProgress &&
        consecutiveResumeNoProgressFailures >=
          LOCAL_LLM_DOWNLOAD_MAX_CONSECUTIVE_RESUME_NO_PROGRESS_FAILURES &&
        !usedFreshFallback
      ) {
        clearLocalLlmPartialDownloadArtifacts(modelId);
        usedFreshFallback = true;
        consecutiveRetryableFailures = 0;
        consecutiveResumeNoProgressFailures = 0;
        continue;
      }

      if (
        totalRetryableFailures >= LOCAL_LLM_DOWNLOAD_MAX_TOTAL_RETRYABLE_FAILURES ||
        consecutiveRetryableFailures >= LOCAL_LLM_DOWNLOAD_MAX_CONSECUTIVE_RETRYABLE_FAILURES
      ) {
        throw createLocalLlmDownloadRetryLimitError(modelId, error);
      }

      await waitForLocalLlmDownloadRetry(
        getLocalLlmDownloadRetryDelayMs(consecutiveRetryableFailures),
      );
      continue;
    }

    if (!downloadResult) {
      throw new Error(`Download cancelled for ${modelId}`);
    }

    const downloadStatus = typeof downloadResult.status === 'number' ? downloadResult.status : 200;
    if (resumeData && (downloadStatus === 200 || downloadStatus === 416) && !usedFreshFallback) {
      clearLocalLlmPartialDownloadArtifacts(modelId);
      usedFreshFallback = true;
      consecutiveRetryableFailures = 0;
      consecutiveResumeNoProgressFailures = 0;
      continue;
    }

    if (downloadStatus < 200 || downloadStatus >= 300) {
      const retryableStatus = isRetryableLocalLlmDownloadStatus(downloadStatus);

      // Android's resumable downloader may append the error response body to the
      // destination file before surfacing a non-2xx status, so the partial is no
      // longer trustworthy once the server responds with an error.
      clearLocalLlmPartialDownloadArtifacts(modelId);

      if (retryableStatus) {
        totalRetryableFailures += 1;
        consecutiveRetryableFailures += 1;
        consecutiveResumeNoProgressFailures = 0;

        if (
          totalRetryableFailures >= LOCAL_LLM_DOWNLOAD_MAX_TOTAL_RETRYABLE_FAILURES ||
          consecutiveRetryableFailures >= LOCAL_LLM_DOWNLOAD_MAX_CONSECUTIVE_RETRYABLE_FAILURES
        ) {
          throw createLocalLlmDownloadRetryLimitError(
            modelId,
            new Error(`Download failed for ${modelId} with status ${downloadStatus}`),
          );
        }

        await waitForLocalLlmDownloadRetry(
          getLocalLlmDownloadRetryDelayMs(consecutiveRetryableFailures),
        );
        continue;
      }

      throw new Error(`Download failed for ${modelId} with status ${downloadStatus}`);
    }

    consecutiveRetryableFailures = 0;
    consecutiveResumeNoProgressFailures = 0;

    if (!isValidLocalLlmModelFile(modelId, tempDestination, expectedSizeBytes)) {
      clearLocalLlmPartialDownloadArtifacts(modelId);
      if (resumeData && !usedFreshFallback) {
        usedFreshFallback = true;
        consecutiveRetryableFailures = 0;
        consecutiveResumeNoProgressFailures = 0;
        continue;
      }
      throw new Error(`Downloaded file for ${modelId} is incomplete or invalid.`);
    }

    if (destination.exists) {
      destination.delete();
    }
    tempDestination.move(destination);
    clearLocalLlmPartialDownloadState(modelId);
    return;
  }
}

function flattenMessageContent(content: string | any[]): string {
  if (typeof content === 'string') {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return String(content ?? '').trim();
  }

  return content
    .map((entry) => {
      if (typeof entry === 'string') {
        return entry;
      }
      if (entry && typeof entry === 'object') {
        if (typeof entry.text === 'string') {
          return entry.text;
        }
        if (entry.type === 'image_url') {
          return '[Image omitted for local text model]';
        }
        if (entry.type === 'input_image') {
          return '[Image omitted for local text model]';
        }
        if (entry.type === 'input_file' || entry.type === 'file') {
          return '[File omitted for local text model]';
        }
      }
      try {
        return JSON.stringify(entry);
      } catch {
        return String(entry ?? '');
      }
    })
    .map((value) => value.trim())
    .filter(Boolean)
    .join('\n');
}

function estimateLocalLlmTextTokens(content: string): number {
  const normalized = content.trim();
  if (!normalized) {
    return 0;
  }

  return Math.max(1, Math.ceil(normalized.length / LOCAL_LLM_APPROX_CHARS_PER_TOKEN));
}

function estimateLocalLlmPromptTokens(params: {
  systemPrompt?: string;
  prompt: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
}): number {
  const systemTokens = params.systemPrompt
    ? estimateLocalLlmTextTokens(params.systemPrompt) + LOCAL_LLM_SYSTEM_OVERHEAD_TOKENS
    : 0;
  const promptTokens =
    estimateLocalLlmTextTokens(params.prompt) + LOCAL_LLM_MESSAGE_OVERHEAD_TOKENS;
  const historyTokens = params.history.reduce(
    (total, entry) =>
      total + estimateLocalLlmTextTokens(entry.content) + LOCAL_LLM_MESSAGE_OVERHEAD_TOKENS,
    0,
  );

  return systemTokens + promptTokens + historyTokens;
}

function parseJsonLikeLocalValue(value: string): any {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  if (!/^(?:\{|\[|"|true\b|false\b|null\b|-?\d)/.test(trimmed)) {
    return value;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

type LocalGemmaToolFenceStreamState = {
  pendingText: string;
  pendingToolCall: string;
  insideToolCall: boolean;
  parsedToolCalls: LocalStructuredToolCall[];
};

function createLocalGemmaToolFenceStreamState(): LocalGemmaToolFenceStreamState {
  return {
    pendingText: '',
    pendingToolCall: '',
    insideToolCall: false,
    parsedToolCalls: [],
  };
}

function skipLocalGemmaWhitespace(text: string, index: number): number {
  let nextIndex = index;
  while (nextIndex < text.length && /\s/.test(text.charAt(nextIndex))) {
    nextIndex += 1;
  }
  return nextIndex;
}

function parseLocalGemmaIdentifier(
  text: string,
  index: number,
): { value: string; index: number } | null {
  const firstChar = text.charAt(index);
  if (!/[A-Za-z_]/.test(firstChar)) {
    return null;
  }

  let nextIndex = index + 1;
  while (nextIndex < text.length && /[A-Za-z0-9_.-]/.test(text.charAt(nextIndex))) {
    nextIndex += 1;
  }

  return {
    value: text.slice(index, nextIndex),
    index: nextIndex,
  };
}

function parseLocalGemmaEscapedString(
  text: string,
  index: number,
): { value: string; index: number } | null {
  for (const token of LOCAL_GEMMA_ESCAPED_STRING_TOKENS) {
    if (!text.startsWith(token, index)) {
      continue;
    }

    const endIndex = text.indexOf(token, index + token.length);
    if (endIndex < 0) {
      return null;
    }

    return {
      value: text.slice(index + token.length, endIndex),
      index: endIndex + token.length,
    };
  }

  return null;
}

function parseLocalGemmaNumber(
  text: string,
  index: number,
): { value: number; index: number } | null {
  const match = text.slice(index).match(/^-?(?:(?:0|[1-9]\d*)(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/);
  if (!match) {
    return null;
  }

  const parsedValue = Number(match[0]);
  if (!Number.isFinite(parsedValue)) {
    return null;
  }

  return {
    value: parsedValue,
    index: index + match[0].length,
  };
}

function parseLocalGemmaArray(
  text: string,
  index: number,
): { value: unknown[]; index: number } | null {
  if (text.charAt(index) !== '[') {
    return null;
  }

  let nextIndex = skipLocalGemmaWhitespace(text, index + 1);
  const values: unknown[] = [];

  if (text.charAt(nextIndex) === ']') {
    return {
      value: values,
      index: nextIndex + 1,
    };
  }

  while (nextIndex < text.length) {
    const value = parseLocalGemmaValue(text, nextIndex);
    if (!value) {
      return null;
    }

    values.push(value.value);
    nextIndex = skipLocalGemmaWhitespace(text, value.index);
    const currentChar = text.charAt(nextIndex);

    if (currentChar === ']') {
      return {
        value: values,
        index: nextIndex + 1,
      };
    }

    if (currentChar !== ',') {
      return null;
    }

    nextIndex = skipLocalGemmaWhitespace(text, nextIndex + 1);
  }

  return null;
}

function parseLocalGemmaObject(
  text: string,
  index: number,
): { value: Record<string, any>; index: number } | null {
  if (text.charAt(index) !== '{') {
    return null;
  }

  let nextIndex = skipLocalGemmaWhitespace(text, index + 1);
  const value: Record<string, any> = {};

  if (text.charAt(nextIndex) === '}') {
    return {
      value,
      index: nextIndex + 1,
    };
  }

  while (nextIndex < text.length) {
    const key = parseLocalGemmaIdentifier(text, nextIndex);
    if (!key) {
      return null;
    }

    nextIndex = skipLocalGemmaWhitespace(text, key.index);
    if (text.charAt(nextIndex) !== ':') {
      return null;
    }

    nextIndex = skipLocalGemmaWhitespace(text, nextIndex + 1);
    const entryValue = parseLocalGemmaValue(text, nextIndex);
    if (!entryValue) {
      return null;
    }

    if (!(key.value in value)) {
      value[key.value] = entryValue.value;
    }

    nextIndex = skipLocalGemmaWhitespace(text, entryValue.index);
    const currentChar = text.charAt(nextIndex);

    if (currentChar === '}') {
      return {
        value,
        index: nextIndex + 1,
      };
    }

    if (currentChar !== ',') {
      return null;
    }

    nextIndex = skipLocalGemmaWhitespace(text, nextIndex + 1);
  }

  return null;
}

function parseLocalGemmaValue(
  text: string,
  index: number,
): { value: unknown; index: number } | null {
  const nextIndex = skipLocalGemmaWhitespace(text, index);
  if (nextIndex >= text.length) {
    return null;
  }

  const escapedString = parseLocalGemmaEscapedString(text, nextIndex);
  if (escapedString) {
    return escapedString;
  }

  const numberValue = parseLocalGemmaNumber(text, nextIndex);
  if (numberValue) {
    return numberValue;
  }

  if (text.startsWith('true', nextIndex)) {
    return { value: true, index: nextIndex + 4 };
  }

  if (text.startsWith('false', nextIndex)) {
    return { value: false, index: nextIndex + 5 };
  }

  if (text.startsWith('null', nextIndex)) {
    return { value: null, index: nextIndex + 4 };
  }

  const objectValue = parseLocalGemmaObject(text, nextIndex);
  if (objectValue) {
    return objectValue;
  }

  return parseLocalGemmaArray(text, nextIndex);
}

function parseLocalGemmaToolCallFence(text: string): LocalStructuredToolCall | null {
  let index = skipLocalGemmaWhitespace(text, 0);
  if (!text.startsWith('call', index)) {
    return null;
  }

  index = skipLocalGemmaWhitespace(text, index + 4);
  if (text.charAt(index) !== ':') {
    return null;
  }

  index = skipLocalGemmaWhitespace(text, index + 1);
  const name = parseLocalGemmaIdentifier(text, index);
  if (!name) {
    return null;
  }

  index = skipLocalGemmaWhitespace(text, name.index);
  let argumentsValue: Record<string, any> = {};

  if (text.charAt(index) === '{') {
    const parsedArguments = parseLocalGemmaObject(text, index);
    if (!parsedArguments) {
      return null;
    }

    argumentsValue = parsedArguments.value;
    index = skipLocalGemmaWhitespace(text, parsedArguments.index);
  }

  if (skipLocalGemmaWhitespace(text, index) !== text.length) {
    return null;
  }

  return {
    name: name.value,
    arguments: argumentsValue,
  };
}

function getLocalGemmaLongestPartialMarkerLength(text: string, markers: readonly string[]): number {
  let longest = 0;

  for (const marker of markers) {
    const maxPrefixLength = Math.min(text.length, marker.length - 1);
    for (let prefixLength = maxPrefixLength; prefixLength > longest; prefixLength -= 1) {
      if (text.endsWith(marker.slice(0, prefixLength))) {
        longest = prefixLength;
        break;
      }
    }
  }

  return longest;
}

function consumeLocalGemmaToolFenceText(
  state: LocalGemmaToolFenceStreamState,
  chunk: string,
): string {
  state.pendingText += chunk;
  const visibleChunks: string[] = [];

  while (state.pendingText.length > 0) {
    if (state.insideToolCall) {
      const endIndex = state.pendingText.indexOf(LOCAL_GEMMA_TOOL_CALL_END_MARKER);
      if (endIndex < 0) {
        const retainLength = getLocalGemmaLongestPartialMarkerLength(state.pendingText, [
          LOCAL_GEMMA_TOOL_CALL_END_MARKER,
        ]);
        state.pendingToolCall += state.pendingText.slice(
          0,
          state.pendingText.length - retainLength,
        );
        state.pendingText = state.pendingText.slice(state.pendingText.length - retainLength);
        break;
      }

      state.pendingToolCall += state.pendingText.slice(0, endIndex);
      state.pendingText = state.pendingText.slice(
        endIndex + LOCAL_GEMMA_TOOL_CALL_END_MARKER.length,
      );

      const parsedToolCall = parseLocalGemmaToolCallFence(state.pendingToolCall.trim());
      if (parsedToolCall) {
        state.parsedToolCalls.push(parsedToolCall);
      } else {
        visibleChunks.push(
          `${LOCAL_GEMMA_TOOL_CALL_START_MARKER}${state.pendingToolCall}${LOCAL_GEMMA_TOOL_CALL_END_MARKER}`,
        );
      }

      state.pendingToolCall = '';
      state.insideToolCall = false;
      continue;
    }

    const markerMatches = [
      {
        marker: LOCAL_GEMMA_TOOL_CALL_START_MARKER,
        index: state.pendingText.indexOf(LOCAL_GEMMA_TOOL_CALL_START_MARKER),
      },
      {
        marker: LOCAL_GEMMA_TOOL_RESPONSE_START_MARKER,
        index: state.pendingText.indexOf(LOCAL_GEMMA_TOOL_RESPONSE_START_MARKER),
      },
      {
        marker: LOCAL_GEMMA_TOOL_RESPONSE_END_MARKER,
        index: state.pendingText.indexOf(LOCAL_GEMMA_TOOL_RESPONSE_END_MARKER),
      },
    ]
      .filter((match) => match.index >= 0)
      .sort((left, right) => left.index - right.index);

    const nextMarker = markerMatches[0];
    if (!nextMarker) {
      const retainLength = getLocalGemmaLongestPartialMarkerLength(
        state.pendingText,
        LOCAL_GEMMA_CONTROL_MARKERS,
      );
      visibleChunks.push(state.pendingText.slice(0, state.pendingText.length - retainLength));
      state.pendingText = state.pendingText.slice(state.pendingText.length - retainLength);
      break;
    }

    visibleChunks.push(state.pendingText.slice(0, nextMarker.index));
    state.pendingText = state.pendingText.slice(nextMarker.index + nextMarker.marker.length);

    if (nextMarker.marker === LOCAL_GEMMA_TOOL_CALL_START_MARKER) {
      state.insideToolCall = true;
      state.pendingToolCall = '';
    }
  }

  return visibleChunks.join('');
}

function flushLocalGemmaToolFenceText(state: LocalGemmaToolFenceStreamState): string {
  if (state.insideToolCall) {
    state.pendingToolCall += state.pendingText;
    state.pendingText = '';
    const rawFence = `${LOCAL_GEMMA_TOOL_CALL_START_MARKER}${state.pendingToolCall}`;
    state.pendingToolCall = '';
    state.insideToolCall = false;
    return rawFence;
  }

  const visibleText = state.pendingText;
  state.pendingText = '';
  return visibleText;
}

function extractLocalGemmaToolCallContent(text: string): {
  content: string;
  toolCalls: LocalStructuredToolCall[];
} {
  const state = createLocalGemmaToolFenceStreamState();
  const content = `${consumeLocalGemmaToolFenceText(state, text)}${flushLocalGemmaToolFenceText(state)}`;

  return {
    content,
    toolCalls: state.parsedToolCalls,
  };
}

function stringifyLocalStructuredValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value ?? '');
  }
}

function flattenLocalStructuredMessage(message: LocalStructuredMessage): string {
  if (message.role === 'tool') {
    return (message.toolResponses || [])
      .map(
        (toolResponse) =>
          `${toolResponse.name}:\n${stringifyLocalStructuredValue(toolResponse.response)}`,
      )
      .join('\n\n');
  }

  const parts: string[] = [];
  if (typeof message.content === 'string' && message.content.trim().length > 0) {
    parts.push(message.content.trim());
  }

  if (message.toolCalls?.length) {
    parts.push(
      message.toolCalls
        .map((toolCall) => `${toolCall.name}(${stringifyLocalStructuredValue(toolCall.arguments)})`)
        .join('\n'),
    );
  }

  return parts.join('\n\n').trim();
}

function estimateStructuredLocalConversationTokens(params: {
  systemPrompt?: string;
  messages: LocalStructuredMessage[];
  tools?: LocalStructuredToolDefinition[];
}): number {
  const systemTokens = params.systemPrompt
    ? estimateLocalLlmTextTokens(params.systemPrompt) + LOCAL_LLM_SYSTEM_OVERHEAD_TOKENS
    : 0;
  const messageTokens = params.messages.reduce(
    (total, message) =>
      total +
      estimateLocalLlmTextTokens(flattenLocalStructuredMessage(message)) +
      LOCAL_LLM_MESSAGE_OVERHEAD_TOKENS,
    0,
  );
  const toolTokens = (params.tools || []).reduce(
    (total, tool) =>
      total +
      estimateLocalLlmTextTokens(
        `${tool.name}\n${tool.description}\n${stringifyLocalStructuredValue(tool.parameters)}`,
      ) +
      LOCAL_LLM_MESSAGE_OVERHEAD_TOKENS,
    0,
  );

  return systemTokens + messageTokens + toolTokens;
}

function buildStructuredLocalToolDefinitions(
  tools?: ToolDefinition[],
): LocalStructuredToolDefinition[] | undefined {
  if (!tools?.length) {
    return undefined;
  }

  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: normalizeToolInputSchema(tool.input_schema),
  }));
}

function compressLocalStructuredToolDescription(description: string): string {
  const normalized = description.trim();
  if (!normalized) {
    return '';
  }

  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (sentences.length <= 2) {
    return normalized;
  }

  return sentences.slice(0, 2).join(' ');
}

function compressLocalStructuredToolSchema(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => compressLocalStructuredToolSchema(entry));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const omittedKeys = new Set(['description', 'title', 'examples', 'default', '$comment']);
  const compressedEntries = Object.entries(value)
    .filter(([key]) => !omittedKeys.has(key))
    .map(([key, entryValue]) => [key, compressLocalStructuredToolSchema(entryValue)]);

  return Object.fromEntries(compressedEntries);
}

function compressLocalStructuredToolDefinitions(
  tools?: LocalStructuredToolDefinition[],
): LocalStructuredToolDefinition[] | undefined {
  if (!tools?.length) {
    return undefined;
  }

  return tools.map((tool) => ({
    ...tool,
    description: compressLocalStructuredToolDescription(tool.description),
    parameters: compressLocalStructuredToolSchema(tool.parameters) as Record<string, any>,
  }));
}

function appendLocalSystemPromptNote(systemPrompt: string | undefined, note: string): string {
  const normalizedPrompt = systemPrompt?.trim();
  if (!normalizedPrompt) {
    return note;
  }

  return `${normalizedPrompt}\n\n${note}`;
}

function trimLocalLlmTextFromStartUntil(
  text: string,
  fitsCandidate: (candidate: string) => boolean,
): string {
  const normalized = text.trim();
  if (!normalized || fitsCandidate(normalized)) {
    return normalized;
  }

  let low = 0;
  let high = normalized.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = normalized.slice(middle).trimStart();
    if (fitsCandidate(candidate)) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }

  return normalized.slice(low).trimStart();
}

function fitStructuredLocalConversationToBudget(params: {
  inputBudget: number;
  systemPrompt?: string;
  messages: LocalStructuredMessage[];
  tools?: LocalStructuredToolDefinition[];
}): {
  systemPrompt?: string;
  messages: LocalStructuredMessage[];
  tools?: LocalStructuredToolDefinition[];
} {
  let systemPrompt = params.systemPrompt?.trim() || undefined;
  let messages = params.messages.slice();
  let tools = params.tools?.slice();
  const originalToolCount = tools?.length ?? 0;

  const fitsBudget = (candidate: {
    systemPrompt?: string;
    messages: LocalStructuredMessage[];
    tools?: LocalStructuredToolDefinition[];
  }): boolean => estimateStructuredLocalConversationTokens(candidate) <= params.inputBudget;

  if (fitsBudget({ systemPrompt, messages, tools })) {
    return {
      ...(systemPrompt ? { systemPrompt } : {}),
      messages,
      ...(tools?.length ? { tools } : {}),
    };
  }

  if (tools?.length) {
    const compressedTools = compressLocalStructuredToolDefinitions(tools);
    if (compressedTools) {
      tools = compressedTools;
    }

    while (tools?.length && !fitsBudget({ systemPrompt, messages, tools })) {
      tools = tools.slice(0, -1);
    }
  }

  if (originalToolCount > 0 && (!tools || tools.length === 0)) {
    systemPrompt = appendLocalSystemPromptNote(
      systemPrompt,
      LOCAL_LLM_TEXT_ONLY_BUDGET_FALLBACK_NOTE,
    );
  }

  if (systemPrompt && !fitsBudget({ systemPrompt, messages, tools })) {
    const trimmedSystemPrompt = trimLocalLlmTextFromStartUntil(systemPrompt, (candidate) =>
      fitsBudget({
        systemPrompt: candidate || undefined,
        messages,
        tools,
      }),
    );
    systemPrompt = trimmedSystemPrompt || undefined;
  }

  const currentMessage = messages[messages.length - 1];
  if (
    currentMessage &&
    typeof currentMessage.content === 'string' &&
    currentMessage.content.trim().length > 0 &&
    !fitsBudget({ systemPrompt, messages, tools })
  ) {
    const trimmedContent = trimLocalLlmTextFromStartUntil(currentMessage.content, (candidate) =>
      fitsBudget({
        systemPrompt,
        messages: [
          ...messages.slice(0, -1),
          {
            ...currentMessage,
            content: candidate,
          },
        ],
        tools,
      }),
    );
    messages = [
      ...messages.slice(0, -1),
      {
        ...currentMessage,
        ...(trimmedContent ? { content: trimmedContent } : {}),
      },
    ];
  }

  return {
    ...(systemPrompt ? { systemPrompt } : {}),
    messages,
    ...(tools?.length ? { tools } : {}),
  };
}

function fitLocalPromptToBudget(params: {
  inputBudget: number;
  systemPrompt?: string;
  prompt: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
}): {
  systemPrompt?: string;
  prompt: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
} {
  let systemPrompt = params.systemPrompt?.trim() || undefined;
  let prompt = params.prompt;
  const history = params.history.slice();

  const fitsBudget = (candidate: {
    systemPrompt?: string;
    prompt: string;
    history: Array<{ role: 'user' | 'assistant'; content: string }>;
  }): boolean => estimateLocalLlmPromptTokens(candidate) <= params.inputBudget;

  if (systemPrompt && !fitsBudget({ systemPrompt, prompt, history })) {
    const trimmedSystemPrompt = trimLocalLlmTextFromStartUntil(systemPrompt, (candidate) =>
      fitsBudget({
        systemPrompt: candidate || undefined,
        prompt,
        history,
      }),
    );
    systemPrompt = trimmedSystemPrompt || undefined;
  }

  if (!fitsBudget({ systemPrompt, prompt, history })) {
    prompt = trimLocalLlmTextFromStartUntil(prompt, (candidate) =>
      fitsBudget({
        systemPrompt,
        prompt: candidate,
        history,
      }),
    );
  }

  return {
    ...(systemPrompt ? { systemPrompt } : {}),
    prompt,
    history,
  };
}

function extractLocalStructuredToolCalls(
  message: LocalChatMessage,
  toolNameById: Map<string, string>,
): LocalStructuredToolCall[] {
  if (!Array.isArray(message.tool_calls)) {
    return [];
  }

  return message.tool_calls
    .map((toolCall) => {
      if (!toolCall || typeof toolCall !== 'object' || Array.isArray(toolCall)) {
        return null;
      }

      const rawFunction =
        toolCall.function &&
        typeof toolCall.function === 'object' &&
        !Array.isArray(toolCall.function)
          ? toolCall.function
          : undefined;
      const name = typeof rawFunction?.name === 'string' ? rawFunction.name.trim() : '';
      if (!name) {
        return null;
      }

      const id = typeof toolCall.id === 'string' ? toolCall.id.trim() : '';
      if (id) {
        toolNameById.set(id, name);
      }

      const parsedArguments =
        typeof rawFunction?.arguments === 'string'
          ? parseJsonLikeLocalValue(rawFunction.arguments)
          : rawFunction?.arguments;

      return {
        name,
        arguments:
          parsedArguments && typeof parsedArguments === 'object' && !Array.isArray(parsedArguments)
            ? (parsedArguments as Record<string, any>)
            : {},
      };
    })
    .filter((toolCall): toolCall is LocalStructuredToolCall => Boolean(toolCall));
}

function buildStructuredLocalMessages(messages: LocalChatMessage[]): {
  systemPrompt?: string;
  messages: LocalStructuredMessage[];
} {
  const systemParts: string[] = [];
  const structuredMessages: LocalStructuredMessage[] = [];
  const toolNameById = new Map<string, string>();
  let pendingToolResponses: LocalStructuredToolResponse[] = [];

  const flushPendingToolResponses = () => {
    if (pendingToolResponses.length === 0) {
      return;
    }

    structuredMessages.push({
      role: 'tool',
      toolResponses: pendingToolResponses,
    });
    pendingToolResponses = [];
  };

  for (const message of messages) {
    if (message.role === 'system') {
      flushPendingToolResponses();
      const content = flattenMessageContent(message.content);
      if (content) {
        systemParts.push(content);
      }
      continue;
    }

    if (message.role === 'tool') {
      const content = flattenMessageContent(message.content);
      if (!content) {
        continue;
      }

      const toolCallId =
        typeof message.tool_call_id === 'string' ? message.tool_call_id.trim() : '';
      const resolvedName =
        typeof message.name === 'string' && message.name.trim().length > 0
          ? message.name.trim()
          : (toolCallId ? toolNameById.get(toolCallId) : undefined) || toolCallId || 'tool_result';

      pendingToolResponses.push({
        name: resolvedName,
        response: parseJsonLikeLocalValue(content),
      });
      continue;
    }

    flushPendingToolResponses();

    if (message.role === 'assistant') {
      const content = flattenMessageContent(message.content);
      const toolCalls = extractLocalStructuredToolCalls(message, toolNameById);
      if (!content && toolCalls.length === 0) {
        continue;
      }

      structuredMessages.push({
        role: 'assistant',
        ...(content ? { content } : {}),
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      });
      continue;
    }

    const content = flattenMessageContent(message.content);
    if (!content) {
      continue;
    }

    structuredMessages.push({
      role: 'user',
      content,
    });
  }

  flushPendingToolResponses();

  return {
    ...(systemParts.length > 0 ? { systemPrompt: systemParts.join('\n\n') } : {}),
    messages: structuredMessages,
  };
}

function groupStructuredLocalMessages(
  messages: LocalStructuredMessage[],
): LocalStructuredMessageGroup[] {
  const groups: LocalStructuredMessageGroup[] = [];

  for (let index = 0; index < messages.length; index += 1) {
    const current = messages[index];
    const next = messages[index + 1];

    if (current.role === 'assistant' && current.toolCalls?.length && next?.role === 'tool') {
      groups.push([current, next]);
      index += 1;
      continue;
    }

    groups.push([current]);
  }

  return groups;
}

function buildStructuredLocalConversation(
  messages: LocalChatMessage[],
  executionPolicy: LocalLlmExecutionPolicy,
  tools?: ToolDefinition[],
): {
  systemPrompt?: string;
  history: LocalStructuredMessage[];
  currentMessage: LocalStructuredMessage;
  tools?: LocalStructuredToolDefinition[];
  estimatedInputTokens: number;
} {
  const structuredConversation = buildStructuredLocalMessages(messages);
  const toolDefinitions = buildStructuredLocalToolDefinitions(tools);
  const contextWindowTokens = getNativeLocalLlmMaximumContextWindowTokens(executionPolicy);
  const inputBudget =
    contextWindowTokens != null
      ? Math.max(1, contextWindowTokens - executionPolicy.maxTokens)
      : null;

  const groupedMessages = groupStructuredLocalMessages(structuredConversation.messages);

  if (groupedMessages.length === 0) {
    throw new Error('On-device requests require at least one user or tool message.');
  }

  const trimmedGroups = groupedMessages.slice();

  while (
    inputBudget != null &&
    trimmedGroups.length > 1 &&
    estimateStructuredLocalConversationTokens({
      systemPrompt: structuredConversation.systemPrompt,
      messages: trimmedGroups.flat(),
      tools: toolDefinitions,
    }) > inputBudget
  ) {
    trimmedGroups.shift();
  }

  const trimmedMessages = trimmedGroups.flat();
  if (trimmedMessages.length === 0) {
    throw new Error('On-device requests require at least one user or tool message.');
  }

  const fittedConversation =
    inputBudget != null
      ? fitStructuredLocalConversationToBudget({
          inputBudget,
          systemPrompt: structuredConversation.systemPrompt,
          messages: trimmedMessages,
          tools: toolDefinitions,
        })
      : {
          ...(structuredConversation.systemPrompt
            ? { systemPrompt: structuredConversation.systemPrompt }
            : {}),
          messages: trimmedMessages,
          ...(toolDefinitions?.length ? { tools: toolDefinitions } : {}),
        };
  const fittedMessages = fittedConversation.messages;
  const fittedTools = fittedConversation.tools;
  const fittedSystemPrompt = fittedConversation.systemPrompt;

  if (
    inputBudget != null &&
    estimateStructuredLocalConversationTokens({
      systemPrompt: fittedSystemPrompt,
      messages: fittedMessages,
      tools: fittedTools,
    }) > inputBudget
  ) {
    throw new Error(
      `${executionPolicy.modelName} input is too long for safe on-device inference on this device. Shorten the message or start a new chat.`,
    );
  }

  const currentMessage = fittedMessages[fittedMessages.length - 1];
  if (currentMessage.role === 'assistant') {
    throw new Error('On-device tool-capable requests require a final user or tool message.');
  }

  const estimatedInputTokens = estimateStructuredLocalConversationTokens({
    systemPrompt: fittedSystemPrompt,
    messages: fittedMessages,
    tools: fittedTools,
  });

  return {
    ...(fittedSystemPrompt ? { systemPrompt: fittedSystemPrompt } : {}),
    history: fittedMessages.slice(0, -1),
    currentMessage,
    ...(fittedTools?.length ? { tools: fittedTools } : {}),
    estimatedInputTokens,
  };
}

function stringifyLocalToolArguments(argumentsValue: Record<string, any>): string {
  try {
    return JSON.stringify(argumentsValue || {});
  } catch {
    return '{}';
  }
}

function buildLocalChatCompletionToolCalls(
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, any> }> | undefined,
): Array<Record<string, any>> | undefined {
  if (!toolCalls?.length) {
    return undefined;
  }

  return toolCalls.map((toolCall) => ({
    id: toolCall.id,
    type: 'function',
    function: {
      name: toolCall.name,
      arguments: stringifyLocalToolArguments(toolCall.arguments),
    },
  }));
}

function buildLocalSyntheticToolCallResults(
  requestId: string,
  toolCalls: LocalStructuredToolCall[] | undefined,
): Array<{ id: string; name: string; arguments: Record<string, any> }> | undefined {
  if (!toolCalls?.length) {
    return undefined;
  }

  return toolCalls.map((toolCall, index) => ({
    id: `local_${requestId}_tool_${index}`,
    name: toolCall.name,
    arguments: toolCall.arguments,
  }));
}

function buildLocalPrompt(
  messages: LocalChatMessage[],
  executionPolicy: LocalLlmExecutionPolicy,
): {
  prompt: string;
  systemPrompt?: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  estimatedInputTokens: number;
} {
  const systemParts: string[] = [];
  const turns: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const message of messages) {
    const content = flattenMessageContent(message.content);
    if (!content) {
      continue;
    }

    switch (message.role) {
      case 'system':
        systemParts.push(content);
        break;
      case 'assistant':
        turns.push({ role: 'assistant', content });
        break;
      case 'user':
        turns.push({ role: 'user', content });
        break;
      case 'tool':
        turns.push({
          role: 'user',
          content: `${message.name || message.tool_call_id || 'Tool result'}:\n${content}`,
        });
        break;
      default:
        turns.push({ role: 'user', content });
        break;
    }
  }

  const finalTurn = turns[turns.length - 1];
  if (!finalTurn || finalTurn.role !== 'user') {
    throw new Error('On-device requests require a final user message.');
  }

  const systemPrompt = systemParts.length > 0 ? systemParts.join('\n\n') : undefined;
  const contextWindowTokens = getNativeLocalLlmMaximumContextWindowTokens(executionPolicy);
  const inputBudget =
    contextWindowTokens != null
      ? Math.max(1, contextWindowTokens - executionPolicy.maxTokens)
      : null;
  const history = turns.slice(0, -1);

  if (inputBudget == null) {
    const estimatedInputTokens = estimateLocalLlmPromptTokens({
      systemPrompt,
      prompt: finalTurn.content,
      history,
    });

    return {
      prompt: finalTurn.content,
      systemPrompt,
      history,
      estimatedInputTokens,
    };
  }

  const trimmedHistory = history.slice();
  while (
    trimmedHistory.length > 0 &&
    estimateLocalLlmPromptTokens({
      systemPrompt,
      prompt: finalTurn.content,
      history: trimmedHistory,
    }) > inputBudget
  ) {
    trimmedHistory.shift();
  }

  if (
    estimateLocalLlmPromptTokens({
      systemPrompt,
      prompt: finalTurn.content,
      history: trimmedHistory,
    }) > inputBudget
  ) {
    const fittedPrompt = fitLocalPromptToBudget({
      inputBudget,
      systemPrompt,
      prompt: finalTurn.content,
      history: trimmedHistory,
    });

    if (estimateLocalLlmPromptTokens(fittedPrompt) > inputBudget) {
      throw new Error(
        `${executionPolicy.modelName} input is too long for safe on-device inference on this device. Shorten the message or start a new chat.`,
      );
    }

    const estimatedInputTokens = estimateLocalLlmPromptTokens(fittedPrompt);

    return {
      prompt: fittedPrompt.prompt,
      ...(fittedPrompt.systemPrompt ? { systemPrompt: fittedPrompt.systemPrompt } : {}),
      history: fittedPrompt.history,
      estimatedInputTokens,
    };
  }

  const estimatedInputTokens = estimateLocalLlmPromptTokens({
    systemPrompt,
    prompt: finalTurn.content,
    history: trimmedHistory,
  });

  return {
    prompt: finalTurn.content,
    systemPrompt,
    history: trimmedHistory,
    estimatedInputTokens,
  };
}

export function isOnDeviceLlmProvider(
  provider: Pick<LlmProviderConfig, 'kind' | 'local'> | null | undefined,
): boolean {
  return provider?.kind === 'on-device' || Boolean(provider?.local?.runtime);
}

export function supportsOnDeviceLlmTools(
  provider:
    | Pick<LlmProviderConfig, 'kind' | 'local' | 'model' | 'modelCapabilities'>
    | null
    | undefined,
  modelId: string = provider?.model || DEFAULT_LOCAL_LLM_MODEL_ID,
): boolean {
  if (!isOnDeviceLlmProvider(provider)) {
    return false;
  }

  return (
    provider?.modelCapabilities?.[modelId]?.tools === true ||
    getLocalLlmModelCapabilities(modelId).tools
  );
}

function getLocalLlmRuntime(
  provider: Pick<LlmProviderConfig, 'model' | 'local'>,
  modelId = provider.model,
): LocalLlmRuntime {
  return getLocalLlmCatalogEntry(modelId)?.runtime || provider.local?.runtime || 'litert-lm';
}

function shouldApplyLocalGemmaToolFenceFallback(
  provider: Pick<LlmProviderConfig, 'kind' | 'local' | 'model' | 'modelCapabilities'>,
): boolean {
  return (
    supportsOnDeviceLlmTools(provider) &&
    getLocalLlmRuntime(provider, provider.model) === 'litert-lm'
  );
}

export function getLocalLlmProviderModelIds(provider: LlmProviderConfig): string[] {
  return getLocalLlmCatalogEntriesForProvider(provider).map((entry) => entry.id);
}

export function getInstalledLocalLlmModels(provider: LlmProviderConfig): InstalledLocalLlmModel[] {
  return normalizeInstalledModels(provider).filter((entry) =>
    isValidLocalLlmModelFile(entry.modelId, new File(entry.localPath), entry.sizeBytes),
  );
}

export function isLocalLlmModelInstalled(provider: LlmProviderConfig, modelId: string): boolean {
  return getInstalledLocalLlmModels(provider).some((entry) => entry.modelId === modelId);
}

export function getSelectableLocalLlmModels(provider: LlmProviderConfig): string[] {
  const installed = getInstalledLocalLlmModels(provider).map((entry) => entry.modelId);
  if (installed.length > 0) {
    return installed;
  }

  return provider.model ? [provider.model] : [DEFAULT_LOCAL_LLM_MODEL_ID];
}

export function createDefaultLocalLlmProvider(id: string): LlmProviderConfig {
  const catalogEntries = getLocalLlmCatalogEntriesForProvider(null);
  const availableModels = catalogEntries.map((entry) => entry.id);
  const defaultModel = availableModels[0] || DEFAULT_LOCAL_LLM_MODEL_ID;
  const modelCapabilities = Object.fromEntries(
    availableModels.map((modelId) => [modelId, getLocalLlmModelCapabilities(modelId)]),
  );

  return {
    id,
    kind: 'on-device',
    name: GEMMA_LOCAL_PROVIDER_NAME,
    baseUrl: '',
    apiKey: '',
    model: defaultModel,
    availableModels,
    modelCapabilities,
    enabled: true,
    local: {
      runtime: getLocalLlmRuntime({ model: defaultModel, local: undefined }, defaultModel),
      backend: getDefaultLocalLlmBackend(defaultModel),
      catalogModelIds: availableModels,
      installedModels: [],
    },
  };
}

export function normalizeLocalLlmProvider(provider: LlmProviderConfig): LlmProviderConfig {
  if (!isOnDeviceLlmProvider(provider)) {
    return provider;
  }

  const catalog = getLocalLlmCatalogEntriesForProvider(provider);
  const availableModels = catalog.map((entry) => entry.id);
  const model = availableModels.includes(provider.model)
    ? provider.model
    : availableModels[0] || DEFAULT_LOCAL_LLM_MODEL_ID;
  const runtime = getLocalLlmRuntime(provider, model);
  const modelCapabilities = Object.fromEntries(
    availableModels.map((modelId) => [modelId, getLocalLlmModelCapabilities(modelId)]),
  );

  return {
    ...provider,
    kind: 'on-device',
    name: provider.name?.trim() || GEMMA_LOCAL_PROVIDER_NAME,
    baseUrl: '',
    apiKey: '',
    model,
    availableModels,
    modelCapabilities,
    local: {
      runtime,
      backend: resolveLocalLlmBackend(provider, model),
      catalogModelIds: provider.local?.catalogModelIds || availableModels,
      installedModels: normalizeInstalledModels(provider),
    },
  };
}

export async function installLocalLlmModel(
  provider: LlmProviderConfig,
  modelId: string,
  options: InstallLocalLlmModelOptions = {},
): Promise<LlmProviderConfig> {
  const normalizedProvider = normalizeLocalLlmProvider(provider);
  const catalogEntry = getLocalLlmCatalogEntry(modelId);
  if (!catalogEntry) {
    throw new Error(`Unknown local model: ${modelId}`);
  }

  const availability = await ensureLocalLlmModelCanRun(modelId);

  const destination = getLocalLlmModelFile(modelId);
  const tempDestination = getLocalLlmModelTempFile(modelId);
  const existingInstallEntry = normalizeInstalledModels(normalizedProvider).find(
    (entry) => entry.modelId === modelId,
  );

  await ensureLocalLlmModelArtifactReady({
    modelId,
    sourceUrl: catalogEntry.downloadUrl,
    destination,
    tempDestination,
    expectedSizeBytes: existingInstallEntry?.sizeBytes,
    onProgress: options.onProgress,
  });

  const installedSizeBytes = getLocalLlmModelObservedSize(destination) || catalogEntry.sizeBytes;

  emitLocalLlmInstallProgress(modelId, installedSizeBytes, installedSizeBytes, options.onProgress);

  const installedModels = normalizeInstalledModels(normalizedProvider).filter(
    (entry) => entry.modelId !== modelId,
  );
  installedModels.push({
    modelId,
    fileName: catalogEntry.fileName,
    localPath: destination.uri,
    installedAt: Date.now(),
    sizeBytes: installedSizeBytes,
    sourceUrl: catalogEntry.downloadUrl,
  });

  const updatedProvider = {
    ...normalizedProvider,
    model: modelId,
    local: {
      runtime: catalogEntry.runtime,
      backend: resolveLocalLlmBackend(
        normalizedProvider,
        modelId,
        availability.deviceMemoryGb ?? null,
      ),
      catalogModelIds:
        normalizedProvider.local?.catalogModelIds ||
        getLocalLlmProviderModelIds(normalizedProvider),
      installedModels,
    },
  };

  return updatedProvider;
}

export async function warmupLocalLlmSession(
  provider: LlmProviderConfig,
  modelId = provider.model,
  options: LocalLlmWarmupOptions = {},
): Promise<void> {
  const modelPath = resolveInstalledLocalLlmModelPath(provider, modelId);
  if (!modelPath) {
    return;
  }

  const availability = await getLocalLlmAvailability(modelId).catch(() => null);
  if (!availability?.available) {
    return;
  }

  const deviceMemoryGb = availability.deviceMemoryGb ?? null;
  const backend = resolveLocalLlmBackend(provider, modelId, deviceMemoryGb);
  const executionPolicy = getLocalLlmExecutionPolicy(modelId, {
    backend,
    deviceMemoryGb,
  });
  const runtime = getLocalLlmRuntime(provider, modelId);
  const toolDefinitions = buildStructuredLocalToolDefinitions(options.tools);
  const conversationId = options.conversationId?.trim() || undefined;
  const shouldWarmConversation = Boolean(conversationId);

  if (!shouldWarmupLocalLlmEngine(executionPolicy, deviceMemoryGb, shouldWarmConversation)) {
    return;
  }

  const systemPrompt = shouldWarmConversation ? (options.systemPrompt ?? null) : null;
  const contextWindowTokens = getNativeLocalLlmMaximumContextWindowTokens(executionPolicy);
  const inputBudget =
    contextWindowTokens != null
      ? Math.max(1, contextWindowTokens - executionPolicy.maxTokens)
      : null;
  const fittedWarmupConversation =
    shouldWarmConversation && inputBudget != null
      ? fitStructuredLocalConversationToBudget({
          inputBudget,
          ...(systemPrompt ? { systemPrompt } : {}),
          messages: [],
          tools: toolDefinitions,
        })
      : {
          ...(systemPrompt ? { systemPrompt } : {}),
          messages: [],
          ...(toolDefinitions?.length ? { tools: toolDefinitions } : {}),
        };
  const warmupSystemPrompt = shouldWarmConversation
    ? (fittedWarmupConversation.systemPrompt ?? null)
    : null;
  const conversationTools = shouldWarmConversation ? fittedWarmupConversation.tools : undefined;
  const samplingConfig = getNativeLocalLlmRequestSamplingConfig(executionPolicy);
  const enableConstrainedDecoding = shouldEnableNativeLocalLlmConstrainedDecoding(
    executionPolicy,
    conversationTools,
  );
  const warmupInputTokens = shouldWarmConversation
    ? estimateStructuredLocalConversationTokens({
        ...(warmupSystemPrompt ? { systemPrompt: warmupSystemPrompt } : {}),
        messages: [],
        tools: conversationTools,
      })
    : 0;
  const warmupTaskKey = buildLocalLlmWarmupTaskKey({
    modelPath,
    runtime,
    backend,
    conversationId,
    systemPrompt: warmupSystemPrompt,
    tools: conversationTools,
    topK: samplingConfig.topK,
    topP: samplingConfig.topP,
    temperature: samplingConfig.temperature,
    enableConstrainedDecoding,
  });
  const existingTask = LOCAL_LLM_WARMUP_TASKS.get(warmupTaskKey);
  if (existingTask) {
    return existingTask;
  }

  const warmupTask = warmupNativeLocalLlmEngine({
    modelPath: getNativeLocalLlmModelPath(modelPath),
    runtime,
    backend,
    maxTokens: executionPolicy.maxTokens,
    contextWindowTokens: getNativeLocalLlmRequestContextWindowTokens(
      executionPolicy,
      warmupInputTokens,
    ),
    ...samplingConfig,
    ...(enableConstrainedDecoding ? { enableConstrainedDecoding: true } : {}),
    minDeviceMemoryGb: executionPolicy.minDeviceMemoryGb ?? undefined,
    conversationKey: conversationId,
    ...(warmupSystemPrompt != null ? { systemPrompt: warmupSystemPrompt } : {}),
    ...(conversationTools?.length ? { tools: conversationTools } : {}),
  })
    .then((result) => {
      rememberObservedLocalLlmBackend(modelPath, result?.backend);
    })
    .finally(() => {
      LOCAL_LLM_WARMUP_TASKS.delete(warmupTaskKey);
    });

  LOCAL_LLM_WARMUP_TASKS.set(warmupTaskKey, warmupTask);
  return warmupTask;
}

export function resolveInstalledLocalLlmModelPath(
  provider: LlmProviderConfig,
  modelId = provider.model,
): string | null {
  const installed = getInstalledLocalLlmModels(provider).find((entry) => entry.modelId === modelId);
  if (installed?.localPath) {
    return installed.localPath;
  }

  const fallbackFile = getLocalLlmCatalogEntry(modelId) ? getLocalLlmModelFile(modelId) : null;
  if (fallbackFile && isValidLocalLlmModelFile(modelId, fallbackFile)) {
    return fallbackFile.uri;
  }

  return null;
}

export async function sendLocalLlmMessage(
  provider: LlmProviderConfig,
  messages: LocalChatMessage[],
  tools?: ToolDefinition[],
  options?: LocalLlmRequestOptions,
): Promise<{ choices: Array<{ message: { content: string } }> }> {
  const availability = await ensureLocalLlmModelCanRun(provider.model);
  const backend = resolveLocalLlmBackend(
    provider,
    provider.model,
    availability.deviceMemoryGb ?? null,
  );
  const executionPolicy = applyLocalLlmRequestOverrides(
    getLocalLlmExecutionPolicy(provider.model, {
      backend,
      deviceMemoryGb: availability.deviceMemoryGb ?? null,
    }),
    options,
  );

  const modelPath = resolveInstalledLocalLlmModelPath(provider, provider.model);
  if (!modelPath) {
    throw new Error(
      `Model ${provider.model} is missing or invalid on this device. Download it again before using on-device inference.`,
    );
  }

  const requestId = generateId();

  if (supportsOnDeviceLlmTools(provider)) {
    const conversation = buildStructuredLocalConversation(messages, executionPolicy, tools);
    const samplingConfig = getNativeLocalLlmRequestSamplingConfig(executionPolicy);
    const enableConstrainedDecoding = shouldEnableNativeLocalLlmConstrainedDecoding(
      executionPolicy,
      conversation.tools,
    );
    const result = await generateWithNativeLocalLlm({
      requestId,
      conversationKey: options?.conversationId?.trim() || undefined,
      modelPath: getNativeLocalLlmModelPath(modelPath),
      runtime: getLocalLlmRuntime(provider, provider.model),
      systemPrompt: conversation.systemPrompt,
      history: conversation.history,
      currentMessage: conversation.currentMessage,
      tools: conversation.tools,
      backend,
      maxTokens: executionPolicy.maxTokens,
      contextWindowTokens: getNativeLocalLlmRequestContextWindowTokens(
        executionPolicy,
        conversation.estimatedInputTokens,
      ),
      ...samplingConfig,
      ...(enableConstrainedDecoding ? { enableConstrainedDecoding: true } : {}),
      minDeviceMemoryGb: executionPolicy.minDeviceMemoryGb ?? undefined,
    });
    rememberObservedLocalLlmBackend(modelPath, result.backend);
    const gemmaToolFenceFallback = shouldApplyLocalGemmaToolFenceFallback(provider)
      ? extractLocalGemmaToolCallContent(result.text)
      : undefined;
    const toolCalls = buildLocalChatCompletionToolCalls(
      result.toolCalls?.length
        ? result.toolCalls
        : buildLocalSyntheticToolCallResults(requestId, gemmaToolFenceFallback?.toolCalls),
    );

    return {
      choices: [
        {
          message: {
            content: gemmaToolFenceFallback?.content ?? result.text,
            ...(toolCalls ? { tool_calls: toolCalls } : {}),
          },
        },
      ],
    };
  }

  const prompt = buildLocalPrompt(messages, executionPolicy);
  const samplingConfig = getNativeLocalLlmRequestSamplingConfig(executionPolicy);
  const result = await generateWithNativeLocalLlm({
    requestId: generateId(),
    conversationKey: options?.conversationId?.trim() || undefined,
    modelPath: getNativeLocalLlmModelPath(modelPath),
    runtime: getLocalLlmRuntime(provider, provider.model),
    prompt: prompt.prompt,
    systemPrompt: prompt.systemPrompt,
    history: prompt.history,
    backend,
    maxTokens: executionPolicy.maxTokens,
    contextWindowTokens: getNativeLocalLlmRequestContextWindowTokens(
      executionPolicy,
      prompt.estimatedInputTokens,
    ),
    ...samplingConfig,
    minDeviceMemoryGb: executionPolicy.minDeviceMemoryGb ?? undefined,
  });
  rememberObservedLocalLlmBackend(modelPath, result.backend);

  return {
    choices: [
      {
        message: {
          content: result.text,
        },
      },
    ],
  };
}

export async function* streamLocalLlmMessage(
  provider: LlmProviderConfig,
  messages: LocalChatMessage[],
  tools?: ToolDefinition[],
  options?: LocalLlmRequestOptions,
): AsyncGenerator<
  | { type: 'token'; content: string }
  | { type: 'tool_call'; toolCall: { id: string; name: string; arguments: string } }
  | { type: 'done' }
> {
  const availability = await ensureLocalLlmModelCanRun(provider.model);
  const backend = resolveLocalLlmBackend(
    provider,
    provider.model,
    availability.deviceMemoryGb ?? null,
  );
  const executionPolicy = applyLocalLlmRequestOverrides(
    getLocalLlmExecutionPolicy(provider.model, {
      backend,
      deviceMemoryGb: availability.deviceMemoryGb ?? null,
    }),
    options,
  );

  const modelPath = resolveInstalledLocalLlmModelPath(provider, provider.model);
  if (!modelPath) {
    throw new Error(
      `Model ${provider.model} is missing or invalid on this device. Download it again before using on-device inference.`,
    );
  }

  const requestId = generateId();

  if (supportsOnDeviceLlmTools(provider)) {
    const conversation = buildStructuredLocalConversation(messages, executionPolicy, tools);
    const samplingConfig = getNativeLocalLlmRequestSamplingConfig(executionPolicy);
    const enableConstrainedDecoding = shouldEnableNativeLocalLlmConstrainedDecoding(
      executionPolicy,
      conversation.tools,
    );
    const gemmaToolFenceFallback = shouldApplyLocalGemmaToolFenceFallback(provider)
      ? createLocalGemmaToolFenceStreamState()
      : null;
    let sawNativeToolCall = false;

    try {
      for await (const event of streamWithNativeLocalLlm({
        requestId,
        conversationKey: options?.conversationId?.trim() || undefined,
        modelPath: getNativeLocalLlmModelPath(modelPath),
        runtime: getLocalLlmRuntime(provider, provider.model),
        systemPrompt: conversation.systemPrompt,
        history: conversation.history,
        currentMessage: conversation.currentMessage,
        tools: conversation.tools,
        backend,
        maxTokens: executionPolicy.maxTokens,
        contextWindowTokens: getNativeLocalLlmRequestContextWindowTokens(
          executionPolicy,
          conversation.estimatedInputTokens,
        ),
        ...samplingConfig,
        ...(enableConstrainedDecoding ? { enableConstrainedDecoding: true } : {}),
        minDeviceMemoryGb: executionPolicy.minDeviceMemoryGb ?? undefined,
      })) {
        rememberObservedLocalLlmBackend(modelPath, event.backend);
        if (event.type === 'token' && event.content) {
          const normalizedContent = gemmaToolFenceFallback
            ? consumeLocalGemmaToolFenceText(gemmaToolFenceFallback, event.content)
            : event.content;
          if (normalizedContent) {
            yield { type: 'token', content: normalizedContent };
          }
          continue;
        }

        if (event.type === 'tool_call' && event.toolCall) {
          sawNativeToolCall = true;
          yield {
            type: 'tool_call',
            toolCall: {
              id: event.toolCall.id,
              name: event.toolCall.name,
              arguments: stringifyLocalToolArguments(event.toolCall.arguments),
            },
          };
        }
      }
    } finally {
      await cancelNativeLocalLlmRequest(requestId);
    }

    if (gemmaToolFenceFallback) {
      const trailingContent = flushLocalGemmaToolFenceText(gemmaToolFenceFallback);
      if (trailingContent) {
        yield { type: 'token', content: trailingContent };
      }

      if (!sawNativeToolCall) {
        for (const toolCall of buildLocalSyntheticToolCallResults(
          requestId,
          gemmaToolFenceFallback.parsedToolCalls,
        ) || []) {
          yield {
            type: 'tool_call',
            toolCall: {
              id: toolCall.id,
              name: toolCall.name,
              arguments: stringifyLocalToolArguments(toolCall.arguments),
            },
          };
        }
      }
    }

    yield { type: 'done' };
    return;
  }

  const prompt = buildLocalPrompt(messages, executionPolicy);
  const samplingConfig = getNativeLocalLlmRequestSamplingConfig(executionPolicy);

  try {
    for await (const event of streamWithNativeLocalLlm({
      requestId,
      conversationKey: options?.conversationId?.trim() || undefined,
      modelPath: getNativeLocalLlmModelPath(modelPath),
      runtime: getLocalLlmRuntime(provider, provider.model),
      prompt: prompt.prompt,
      systemPrompt: prompt.systemPrompt,
      history: prompt.history,
      backend,
      maxTokens: executionPolicy.maxTokens,
      contextWindowTokens: getNativeLocalLlmRequestContextWindowTokens(
        executionPolicy,
        prompt.estimatedInputTokens,
      ),
      ...samplingConfig,
      minDeviceMemoryGb: executionPolicy.minDeviceMemoryGb ?? undefined,
    })) {
      rememberObservedLocalLlmBackend(modelPath, event.backend);
      if (event.content) {
        yield { type: 'token', content: event.content };
      }
    }
  } finally {
    await cancelNativeLocalLlmRequest(requestId);
  }

  yield { type: 'done' };
}

export async function getLocalLlmAvailability(modelId?: string): Promise<LocalLlmAvailability> {
  const nativeAvailability = await getNativeLocalLlmAvailability();
  if (!modelId) {
    return {
      ...nativeAvailability,
      warningReason: null,
    };
  }

  const catalogEntry = getLocalLlmCatalogEntry(modelId);
  const executionPolicy = getLocalLlmExecutionPolicy(modelId, {
    backend: resolveLocalLlmBackend(
      { model: modelId, local: { runtime: catalogEntry?.runtime || 'litert-lm' } },
      modelId,
      nativeAvailability.deviceMemoryGb ?? null,
    ),
    deviceMemoryGb: nativeAvailability.deviceMemoryGb ?? null,
  });

  if (!catalogEntry) {
    return {
      ...nativeAvailability,
      available: false,
      modelId,
      reason: `Unknown local model: ${modelId}.`,
      minDeviceMemoryGb: null,
      recommendedMaxTokens: null,
      warningReason: null,
    };
  }

  if (!catalogEntry.supportedPlatforms.includes(getCurrentLocalLlmPlatform())) {
    return {
      ...nativeAvailability,
      available: false,
      modelId,
      runtime: nativeAvailability.runtime || executionPolicy.runtime,
      reason: buildUnsupportedLocalLlmPlatformReason(modelId),
      minDeviceMemoryGb: executionPolicy.minDeviceMemoryGb,
      recommendedMaxTokens: executionPolicy.maxTokens,
      warningReason: null,
    };
  }

  if (!nativeAvailability.available) {
    return {
      ...nativeAvailability,
      modelId,
      runtime: nativeAvailability.runtime || executionPolicy.runtime,
      minDeviceMemoryGb: executionPolicy.minDeviceMemoryGb,
      recommendedMaxTokens: executionPolicy.maxTokens,
      warningReason: buildConstrainedLocalLlmExecutionWarning(executionPolicy),
    };
  }

  if (nativeAvailability.lowMemoryDevice) {
    return {
      ...nativeAvailability,
      available: false,
      modelId,
      reason: buildLowRamLocalLlmReason(executionPolicy),
      minDeviceMemoryGb: executionPolicy.minDeviceMemoryGb,
      recommendedMaxTokens: executionPolicy.maxTokens,
      warningReason: null,
    };
  }

  const deviceMemoryGb =
    typeof nativeAvailability.deviceMemoryGb === 'number' &&
    Number.isFinite(nativeAvailability.deviceMemoryGb)
      ? nativeAvailability.deviceMemoryGb
      : null;

  if (executionPolicy.minDeviceMemoryGb != null && deviceMemoryGb != null) {
    const memoryRequirementStatus = getLocalLlmMemoryRequirementStatus(
      executionPolicy.minDeviceMemoryGb,
      deviceMemoryGb,
    );

    if (memoryRequirementStatus === 'block') {
      return {
        ...nativeAvailability,
        available: false,
        modelId,
        reason: buildLowMemoryLocalLlmReason(executionPolicy, deviceMemoryGb),
        minDeviceMemoryGb: executionPolicy.minDeviceMemoryGb,
        recommendedMaxTokens: executionPolicy.maxTokens,
        warningReason: null,
      };
    }

    if (memoryRequirementStatus === 'warn') {
      return {
        ...nativeAvailability,
        modelId,
        runtime: nativeAvailability.runtime || executionPolicy.runtime,
        minDeviceMemoryGb: executionPolicy.minDeviceMemoryGb,
        recommendedMaxTokens: executionPolicy.maxTokens,
        warningReason: buildBorderlineLocalLlmMemoryWarning(executionPolicy, deviceMemoryGb),
      };
    }
  }

  return {
    ...nativeAvailability,
    modelId,
    runtime: nativeAvailability.runtime || executionPolicy.runtime,
    minDeviceMemoryGb: executionPolicy.minDeviceMemoryGb,
    recommendedMaxTokens: executionPolicy.maxTokens,
    warningReason: buildConstrainedLocalLlmExecutionWarning(executionPolicy),
  };
}
