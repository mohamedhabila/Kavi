import type { LlmProviderConfig, LocalLlmAccelerator, LocalLlmRuntime } from '../../types/provider';
import { getLocalLlmAvailability } from './availability';
import {
  clearLocalLlmRuntimeActivity,
  getObservedLocalLlmBackend,
  rememberLocalLlmRuntimeActivity,
  rememberObservedLocalLlmBackend,
} from './backendStatus';
import {
  getLocalLlmRuntime,
  resolveLocalLlmAccelerator,
  resolveLocalLlmAuxiliaryAccelerator,
} from './backendPolicy';
import {
  getNativeLocalLlmMaximumContextWindowTokens,
  getNativeLocalLlmRequestContextWindowTokens,
} from './contextWindowPolicy';
import {
  buildLocalLlmContextTelemetry,
  buildNativeLocalLlmContextTelemetryFields,
  isLocalLlmContextPressureError,
} from './contextPressure';
import { getLocalLlmExecutionPolicy } from './executionPolicy';
import { shouldWarmupLocalLlmEngine } from './memoryPolicy';
import { getNativeLocalLlmModelPath, resolveInstalledLocalLlmModelPath } from './modelArtifacts';
import { warmupNativeLocalLlmEngine } from './native';
import { estimateStructuredLocalConversationTokens } from './promptContent';
import {
  getNativeLocalLlmRequestSamplingConfig,
  shouldEnableNativeLocalLlmConstrainedDecoding,
} from './samplingPolicy';
import { fitStructuredLocalConversationToBudget } from './structuredBudget';
import { buildStructuredLocalToolDefinitions } from './toolAdapter';
import type {
  LocalLlmWarmupOptions,
  LocalStructuredMessage,
  LocalStructuredToolDefinition,
} from './types';

const LOCAL_LLM_WARMUP_TASKS = new Map<string, Promise<void>>();

function buildLocalLlmWarmupTaskKey(params: {
  modelPath: string;
  runtime: LocalLlmRuntime;
  backend: LocalLlmAccelerator;
  visionBackend?: LocalLlmAccelerator;
  audioBackend?: LocalLlmAccelerator;
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
    visionBackend: params.visionBackend || null,
    audioBackend: params.audioBackend || null,
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
  const resolvedBackend = resolveLocalLlmAccelerator(provider, modelId, deviceMemoryGb);
  const observedBackend =
    resolvedBackend === 'cpu' ? null : getObservedLocalLlmBackend(provider, modelId);
  const backend = observedBackend || resolvedBackend;
  const executionPolicy = getLocalLlmExecutionPolicy(modelId, {
    backend,
    deviceMemoryGb,
    observedBackend,
    lowMemoryDevice: availability.lowMemoryDevice ?? null,
  });
  const visionBackend = resolveLocalLlmAuxiliaryAccelerator(
    backend,
    executionPolicy.defaultVisionAccelerator,
  );
  const audioBackend = resolveLocalLlmAuxiliaryAccelerator(
    backend,
    executionPolicy.defaultAudioAccelerator,
  );
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
  let fittedWarmupConversation: {
    systemPrompt?: string;
    messages: LocalStructuredMessage[];
    tools?: LocalStructuredToolDefinition[];
  };
  try {
    fittedWarmupConversation =
      shouldWarmConversation && inputBudget != null
        ? fitStructuredLocalConversationToBudget({
            inputBudget,
            contextWindowTokens,
            modelName: executionPolicy.modelName,
            ...(systemPrompt ? { systemPrompt } : {}),
            messages: [],
            tools: toolDefinitions,
          })
        : {
            ...(systemPrompt ? { systemPrompt } : {}),
            messages: [],
            ...(toolDefinitions?.length ? { tools: toolDefinitions } : {}),
          };
  } catch (error) {
    if (isLocalLlmContextPressureError(error)) {
      return;
    }
    throw error;
  }
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
  const warmupContext = buildLocalLlmContextTelemetry({
    contextWindowTokens,
    inputBudgetTokens: inputBudget,
    estimatedInputTokens: warmupInputTokens,
    compactionState: 'full',
  });
  const warmupTaskKey = buildLocalLlmWarmupTaskKey({
    modelPath,
    runtime,
    backend,
    visionBackend,
    audioBackend,
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

  rememberLocalLlmRuntimeActivity(modelPath, 'warming');
  const warmupTask = warmupNativeLocalLlmEngine({
    modelPath: getNativeLocalLlmModelPath(modelPath),
    runtime,
    backend,
    ...(visionBackend ? { visionBackend } : {}),
    ...(audioBackend ? { audioBackend } : {}),
    maxTokens: executionPolicy.maxTokens,
    contextWindowTokens: getNativeLocalLlmRequestContextWindowTokens(
      executionPolicy,
      warmupInputTokens,
    ),
    ...buildNativeLocalLlmContextTelemetryFields(warmupContext),
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
      clearLocalLlmRuntimeActivity(modelPath, 'warming');
      LOCAL_LLM_WARMUP_TASKS.delete(warmupTaskKey);
    });

  LOCAL_LLM_WARMUP_TASKS.set(warmupTaskKey, warmupTask);
  return warmupTask;
}
