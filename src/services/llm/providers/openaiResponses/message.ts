import type { LlmProviderConfig } from '../../../../types/provider';
import { resolveProviderFamily } from '../../catalog/providerFamilies';
import { attachProviderResponse } from '../../core/providerResponse';
import { reorderToolsForPromptCaching } from '../../core/toolCaching';
import type { LlmPerformFetch } from '../../core/fetchTransport';
import type { ChatCompletionMessage, MessageRequestOptions } from '../../support/contracts';
import { sendOpenAIResponses } from './adapter';
import {
  buildOpenAIResponsesBody,
  buildOpenAIResponsesReplayInputContext,
  normalizeOpenAIResponsesResult,
} from './helpers';

export function sendOpenAIResponsesMessage(params: {
  provider: LlmProviderConfig;
  baseUrl: string;
  headers: Record<string, string>;
  model: string;
  messages: ChatCompletionMessage[];
  options: MessageRequestOptions;
  performFetch: LlmPerformFetch;
}): Promise<any> {
  const serializeOpenAIPromptCacheHints = resolveProviderFamily(params.provider) === 'openai';
  return sendOpenAIResponses({
    baseUrl: params.baseUrl,
    headers: params.headers,
    model: params.model,
    messages: params.messages,
    options: params.options,
    buildOpenAIResponsesBody: (resolvedModel, resolvedMessages, resolvedOptions) =>
      buildOpenAIResponsesBody({
        model: resolvedModel,
        messages: resolvedMessages,
        options: resolvedOptions,
        serializeOpenAIPromptCacheHints,
        reorderToolsForPromptCaching,
      }),
    performFetch: params.performFetch,
    normalizeOpenAIResponsesResult: (json) =>
      normalizeOpenAIResponsesResult(json, {
        replayInputContext: buildOpenAIResponsesReplayInputContext(params.options),
      }),
    attachProviderResponse,
  });
}
