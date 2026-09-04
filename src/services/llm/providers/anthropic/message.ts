import type { LlmProviderConfig } from '../../../../types/provider';
import { rejectsForcedToolChoice } from '../../catalog/providerCapabilities';
import { isPlainRecord } from '../../core/json';
import { attachProviderResponse } from '../../core/providerResponse';
import { isStrictCompatibleSchema } from '../../core/schemaTransforms';
import { buildAnthropicToolChoice, resolveForcedToolChoiceFallback } from '../../core/toolChoice';
import type { LlmPerformFetch } from '../../core/fetchTransport';
import type { ChatCompletionMessage, MessageRequestOptions } from '../../support/contracts';
import { sendAnthropicMessages } from './adapter';
import {
  anthropicContentIsEmpty,
  mergeAnthropicAssistantContent,
  mergeAnthropicContent,
  mergeAnthropicToolResultsById,
  normalizeAnthropicUserContent,
} from './contentBlocks';
import { normalizeAnthropicConversationHistory } from './conversation';
import {
  buildAnthropicToolRaw,
  extractAnthropicReasoningText,
  normalizeAnthropicAssistantBlocks,
} from './toolReplay';
import {
  ANTHROPIC_EPHEMERAL_CACHE_CONTROL,
  ANTHROPIC_INTERLEAVED_THINKING_BETA,
  MAX_ANTHROPIC_STRICT_TOOLS,
  buildAnthropicSystemPromptContent,
  isAnthropicStrictEligible,
  reorderAnthropicToolsForCaching,
  simplifyAnthropicSchema,
  simplifyAnthropicToolDescription,
  strictifySchema,
} from './helpers';
import {
  buildAnthropicOutputConfig,
  sanitizeAnthropicRequestOptions,
  shouldIncludeAnthropicInterleavedThinkingBeta,
} from './requestOptions';

export function sendAnthropicMessage(params: {
  provider: LlmProviderConfig;
  baseUrl: string;
  headers: Record<string, string>;
  model: string;
  messages: ChatCompletionMessage[];
  options: MessageRequestOptions;
  performFetch: LlmPerformFetch;
}): Promise<any> {
  return sendAnthropicMessages({
    baseUrl: params.baseUrl,
    headers: params.headers,
    model: params.model,
    messages: params.messages,
    options: params.options,
    sanitizeAnthropicRequestOptions: (candidateModel, requestMessages, requestOptions) =>
      sanitizeAnthropicRequestOptions({
        model: candidateModel,
        messages: requestMessages,
        options: requestOptions,
        buildAnthropicOutputConfig: (resolvedOptions, resolvedModel) =>
          buildAnthropicOutputConfig(
            resolvedOptions,
            {
              simplifyAnthropicSchema,
              strictifySchema,
            },
            resolvedModel,
          ),
      }),
    normalizeAnthropicAssistantBlocks,
    mergeAnthropicContent,
    mergeAnthropicToolResultsById,
    mergeAnthropicAssistantContent,
    normalizeAnthropicUserContent,
    anthropicContentIsEmpty,
    normalizeAnthropicConversationHistory,
    buildAnthropicToolRaw,
    extractAnthropicReasoningText,
    buildAnthropicToolChoice,
    rejectsForcedToolChoice,
    resolveForcedToolChoiceFallback,
    shouldIncludeAnthropicInterleavedThinkingBeta: (candidateModel, requestOptions, thinking) =>
      shouldIncludeAnthropicInterleavedThinkingBeta({
        model: candidateModel,
        defaultModel: params.provider.model,
        options: requestOptions,
        thinking: isPlainRecord(thinking) ? thinking : undefined,
      }),
    buildAnthropicSystemPromptContent,
    reorderAnthropicToolsForCaching,
    simplifyAnthropicToolDescription,
    simplifyAnthropicSchema,
    isAnthropicStrictEligible,
    strictifySchema,
    isStrictCompatibleSchema,
    maxAnthropicStrictTools: MAX_ANTHROPIC_STRICT_TOOLS,
    anthropicEphemeralCacheControl: ANTHROPIC_EPHEMERAL_CACHE_CONTROL,
    anthropicInterleavedThinkingBeta: ANTHROPIC_INTERLEAVED_THINKING_BETA,
    performFetch: params.performFetch,
    attachProviderResponse,
  });
}
