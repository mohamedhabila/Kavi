import type {
  AssistantCompletionMetadata,
  AssistantCompletionStatus,
} from '../../../../types/message';
import { normalizeUsage } from '../../../usage/tracker';
import type { StreamUsage } from '../../support/contracts';

export function createCompletionMetadata(
  completionStatus: AssistantCompletionStatus,
  finishReason?: string,
): AssistantCompletionMetadata {
  return {
    completionStatus,
    ...(finishReason ? { finishReason } : {}),
  };
}

export function normalizeStreamUsage(usage: any): StreamUsage | undefined {
  const normalizedUsage = normalizeUsage(usage);
  if (!normalizedUsage) {
    return undefined;
  }

  return {
    inputTokens: normalizedUsage.inputTokens,
    outputTokens: normalizedUsage.outputTokens,
    cacheReadTokens: normalizedUsage.cacheReadTokens,
    cacheWriteTokens: normalizedUsage.cacheWriteTokens,
    totalTokens: normalizedUsage.totalTokens,
  };
}

export function normalizeOpenAiCompatibleCompletion(
  reason: unknown,
): AssistantCompletionMetadata | undefined {
  if (typeof reason !== 'string') {
    return undefined;
  }

  const normalizedReason = reason.trim().toLowerCase();
  if (!normalizedReason) {
    return undefined;
  }

  if (
    normalizedReason === 'stop' ||
    normalizedReason === 'tool_calls' ||
    normalizedReason === 'tool_call' ||
    normalizedReason === 'stop_sequence' ||
    normalizedReason === 'end_turn'
  ) {
    return createCompletionMetadata('complete', normalizedReason);
  }

  return createCompletionMetadata('incomplete', normalizedReason);
}

export function normalizeGeminiCompletion(
  reason: unknown,
): AssistantCompletionMetadata | undefined {
  if (typeof reason !== 'string') {
    return undefined;
  }

  const normalizedReason = reason.trim();
  if (!normalizedReason) {
    return undefined;
  }

  const upperReason = normalizedReason.toUpperCase();
  if (upperReason === 'STOP' || upperReason === 'STOP_SEQUENCE' || upperReason === 'TOOL_CALL') {
    return createCompletionMetadata('complete', normalizedReason);
  }

  return createCompletionMetadata('incomplete', normalizedReason);
}

export function normalizeAnthropicCompletion(
  reason: unknown,
): AssistantCompletionMetadata | undefined {
  if (typeof reason !== 'string') {
    return undefined;
  }

  const normalizedReason = reason.trim().toLowerCase();
  if (!normalizedReason) {
    return undefined;
  }

  if (normalizedReason === 'end_turn' || normalizedReason === 'tool_use') {
    return createCompletionMetadata('complete', normalizedReason);
  }

  return createCompletionMetadata('incomplete', normalizedReason);
}
