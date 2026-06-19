import {
  LOCAL_LLM_ANDROID_LITERT_HIGH_TOTAL_CONTEXT_MEMORY_GB,
  LOCAL_LLM_ANDROID_LITERT_HIGH_STABLE_ACCELERATED_CONTEXT_TOKENS,
  LOCAL_LLM_ANDROID_LITERT_HIGH_STABLE_ACCELERATED_HEADROOM_GB,
  LOCAL_LLM_ANDROID_LITERT_HIGH_TOTAL_CONTEXT_TOKENS,
  LOCAL_LLM_ANDROID_LITERT_LOW_TOTAL_CONTEXT_TOKENS,
  LOCAL_LLM_ANDROID_LITERT_MID_TOTAL_CONTEXT_MEMORY_GB,
  LOCAL_LLM_ANDROID_LITERT_MID_TOTAL_CONTEXT_TOKENS,
  LOCAL_LLM_ANDROID_LITERT_MIN_INPUT_BUDGET_TOKENS,
  LOCAL_LLM_ANDROID_LITERT_STABLE_ACCELERATED_CONTEXT_TOKENS,
  LOCAL_LLM_ANDROID_LITERT_STABLE_ACCELERATED_HEADROOM_GB,
  LOCAL_LLM_CONTEXT_WINDOW_BUCKET_TOKENS,
  LOCAL_LLM_ENGINE_INIT_INPUT_RESERVE_TOKENS,
  LOCAL_LLM_MEMORY_EPSILON_GB,
} from './constants';
import type { LocalLlmAccelerator } from '../../types/provider';
import type { LocalLlmExecutionPolicy } from './types';

export function roundUpLocalLlmContextWindowTokens(tokens: number): number {
  return (
    Math.ceil(tokens / LOCAL_LLM_CONTEXT_WINDOW_BUCKET_TOKENS) *
    LOCAL_LLM_CONTEXT_WINDOW_BUCKET_TOKENS
  );
}

export function getAndroidLiteRtSafeTotalContextWindowTokens(params: {
  maxTokens: number;
  deviceMemoryGb: number | null;
  minDeviceMemoryGb?: number | null;
  maxContextLength: number | null;
  backend?: LocalLlmAccelerator | null;
  observedBackend?: LocalLlmAccelerator | null;
  lowMemoryDevice?: boolean | null;
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

  const memoryHeadroomGb =
    params.deviceMemoryGb != null && params.minDeviceMemoryGb != null
      ? params.deviceMemoryGb - params.minDeviceMemoryGb
      : null;
  const stableAcceleratedBackend =
    params.backend != null && params.observedBackend === params.backend && params.backend !== 'cpu';

  if (!params.lowMemoryDevice && stableAcceleratedBackend && memoryHeadroomGb != null) {
    if (
      memoryHeadroomGb + LOCAL_LLM_MEMORY_EPSILON_GB >=
      LOCAL_LLM_ANDROID_LITERT_HIGH_STABLE_ACCELERATED_HEADROOM_GB
    ) {
      tierCap = Math.max(tierCap, LOCAL_LLM_ANDROID_LITERT_HIGH_STABLE_ACCELERATED_CONTEXT_TOKENS);
    } else if (
      memoryHeadroomGb + LOCAL_LLM_MEMORY_EPSILON_GB >=
      LOCAL_LLM_ANDROID_LITERT_STABLE_ACCELERATED_HEADROOM_GB
    ) {
      tierCap = Math.max(tierCap, LOCAL_LLM_ANDROID_LITERT_STABLE_ACCELERATED_CONTEXT_TOKENS);
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

export function getNativeLocalLlmMaximumContextWindowTokens(
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

export function getNativeLocalLlmMinimumInputReserveTokens(
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

export function normalizeNativeLocalLlmContextWindowTokens(
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

export function getNativeLocalLlmRequestContextWindowTokens(
  executionPolicy: LocalLlmExecutionPolicy,
  estimatedInputTokens = 0,
): number {
  return normalizeNativeLocalLlmContextWindowTokens(
    executionPolicy.maxTokens +
      Math.max(estimatedInputTokens, getNativeLocalLlmMinimumInputReserveTokens(executionPolicy)),
    executionPolicy,
  );
}
