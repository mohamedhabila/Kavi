import type {
  AssistantCompletionMetadata,
  AssistantCompletionStatus,
} from '../../../../types/message';
import { normalizeUsage } from '../../../usage/tracker';
import type { StreamUsage } from '../../support/contracts';

export function createCompletionMetadata(
  completionStatus: AssistantCompletionStatus,
  finishReason: string,
): AssistantCompletionMetadata {
  return {
    completionStatus,
    finishReason,
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

const MAX_UPSTREAM_PROVIDER_LENGTH = 80;

/**
 * The upstream a router served the call from. OpenRouter reports it as a top-level
 * `provider` string on each completion chunk; a router can send one model to many
 * upstreams, and prompt caching and tool parsing differ between them.
 */
export function readUpstreamProvider(response: unknown): string | undefined {
  if (!response || typeof response !== 'object') return undefined;
  const provider = (response as { provider?: unknown }).provider;
  if (typeof provider !== 'string') return undefined;
  const trimmed = provider.trim();
  return trimmed && trimmed.length <= MAX_UPSTREAM_PROVIDER_LENGTH ? trimmed : undefined;
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

  if (
    normalizedReason === 'end_turn' ||
    normalizedReason === 'refusal' ||
    normalizedReason === 'stop_sequence' ||
    normalizedReason === 'tool_use'
  ) {
    return createCompletionMetadata('complete', normalizedReason);
  }

  return createCompletionMetadata('incomplete', normalizedReason);
}
