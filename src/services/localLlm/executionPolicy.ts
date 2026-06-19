import type { LocalLlmAccelerator, LocalLlmPlatform } from '../../types/provider';
import {
  DEFAULT_LITERT_LM_TEMPERATURE,
  DEFAULT_LITERT_LM_TOP_K,
  DEFAULT_LITERT_LM_TOP_P,
  getCurrentLocalLlmPlatform,
  getLocalLlmCatalogEntry,
} from './catalog';
import {
  DEFAULT_LOCAL_LLM_MAX_TOKENS,
  LOCAL_LLM_ANDROID_PRECISE_MEMORY_API_LEVEL,
  LOCAL_LLM_CONSTRAINED_DEVICE_MAX_TOKENS,
  LOCAL_LLM_MEMORY_EPSILON_GB,
  LOCAL_LLM_NEAR_MINIMUM_MEMORY_HEADROOM_GB,
} from './constants';
import { getAndroidLiteRtSafeTotalContextWindowTokens } from './contextWindowPolicy';
import { getLocalLlmMemoryRequirementStatus } from './memoryPolicy';
import { getAndroidApiLevel } from './platformPolicy';
import type { LocalLlmExecutionPolicy } from './types';

export function getLocalLlmExecutionPolicy(
  modelId: string,
  options?: {
    backend?: LocalLlmAccelerator;
    deviceMemoryGb?: number | null;
    observedBackend?: LocalLlmAccelerator | null;
    lowMemoryDevice?: boolean | null;
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
          minDeviceMemoryGb,
          maxContextLength: catalogEntry?.maxContextLength ?? null,
          backend,
          observedBackend: options?.observedBackend ?? null,
          lowMemoryDevice: options?.lowMemoryDevice ?? null,
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
    defaultVisionAccelerator: catalogEntry?.defaultVisionAccelerator ?? null,
    defaultAudioAccelerator: catalogEntry?.defaultAudioAccelerator ?? null,
  };
}
