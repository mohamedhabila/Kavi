import type { LocalLlmExecutionPolicy, LocalStructuredToolDefinition } from './types';

export function getNativeLocalLlmRequestSamplingConfig(executionPolicy: LocalLlmExecutionPolicy): {
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

export function shouldEnableNativeLocalLlmConstrainedDecoding(
  executionPolicy: LocalLlmExecutionPolicy,
  tools?: LocalStructuredToolDefinition[],
): boolean {
  return executionPolicy.runtime === 'litert-lm' && Boolean(tools?.length);
}
