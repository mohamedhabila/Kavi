import type { LlmProviderConfig } from '../../types/provider';
import { resolveModelOutputTokenBudget } from '../context/outputTokenBudget';
import { sendLocalLlmMessage } from '../localLlm/generateSession';
import { isOnDeviceLlmProvider } from '../localLlm/provider';
import { resolveProviderTransport } from './catalog/providerProtocols';
import { buildProviderHeaders, resolveProviderBaseUrl } from './core/providerRequest';
import { selectByteEquivalentSystemPromptSections } from './core/systemPromptSections';
import type { LlmPerformFetch } from './core/fetchTransport';
import {
  buildLocalLlmRequestOptions,
  resolveLocalProviderForRequest,
} from './localProviderRequest';
import { sendAnthropicMessage } from './providers/anthropic/message';
import { sendGeminiMessage } from './providers/gemini/message';
import { sendOpenAICompatibleChatMessage } from './providers/openaiChat/message';
import { sendOpenAIResponsesMessage } from './providers/openaiResponses/message';
import type { ChatCompletionMessage, MessageRequestOptions } from './support/contracts';

export function sendLlmMessage(params: {
  provider: LlmProviderConfig;
  messages: ChatCompletionMessage[];
  options?: MessageRequestOptions;
  performFetch: LlmPerformFetch;
}): Promise<any> {
  const requestedOptions = params.options || {};
  const approvedSystemPromptSections = selectByteEquivalentSystemPromptSections(
    params.messages,
    requestedOptions.systemPromptSections,
  );
  const options: MessageRequestOptions = { ...requestedOptions };
  delete options.systemPromptSections;
  if (approvedSystemPromptSections) {
    options.systemPromptSections = approvedSystemPromptSections;
  }

  if (isOnDeviceLlmProvider(params.provider)) {
    return sendLocalLlmMessage(
      resolveLocalProviderForRequest(params.provider, options),
      params.messages,
      options.tools,
      buildLocalLlmRequestOptions(options),
    );
  }

  const baseUrl = resolveProviderBaseUrl(params.provider);
  const headers = buildProviderHeaders(params.provider);
  const model = options.model || params.provider.model;
  const requestOptions =
    options.maxTokens === undefined
      ? { ...options, maxTokens: resolveModelOutputTokenBudget(model) }
      : options;
  const providerTransport = resolveProviderTransport(params.provider);

  switch (providerTransport) {
    case 'anthropic':
      return sendAnthropicMessage({
        provider: params.provider,
        baseUrl,
        headers,
        model,
        messages: params.messages,
        options: requestOptions,
        performFetch: params.performFetch,
      });
    case 'gemini':
      return sendGeminiMessage({
        provider: params.provider,
        baseUrl,
        headers,
        model,
        messages: params.messages,
        options: requestOptions,
        performFetch: params.performFetch,
      });
    case 'openai':
      return sendOpenAIResponsesMessage({
        provider: params.provider,
        baseUrl,
        headers,
        model,
        messages: params.messages,
        options: requestOptions,
        performFetch: params.performFetch,
      });
    default:
      return sendOpenAICompatibleChatMessage({
        provider: params.provider,
        baseUrl,
        headers,
        model,
        messages: params.messages,
        options: requestOptions,
        performFetch: params.performFetch,
      });
  }
}
