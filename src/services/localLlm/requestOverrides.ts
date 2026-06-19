import type { LocalLlmExecutionPolicy, LocalLlmRequestOptions } from './types';

export function normalizeLocalLlmRequestMaxTokens(maxTokens?: number): number | null {
  if (typeof maxTokens !== 'number' || !Number.isFinite(maxTokens) || maxTokens <= 0) {
    return null;
  }

  return Math.max(1, Math.floor(maxTokens));
}

export function normalizeLocalLlmRequestTemperature(temperature?: number): number | null {
  if (typeof temperature !== 'number' || !Number.isFinite(temperature) || temperature < 0) {
    return null;
  }

  return temperature;
}

export function applyLocalLlmRequestOverrides(
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
