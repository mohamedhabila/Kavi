import type { LlmProviderConfig } from '../../types/provider';
import type { LocalLlmRequestOptions } from '../localLlm/types';
import type { MessageRequestOptions } from './support/contracts';

export function resolveLocalProviderForRequest(
  provider: LlmProviderConfig,
  options: Pick<MessageRequestOptions, 'model'>,
): LlmProviderConfig {
  return options.model && options.model !== provider.model
    ? { ...provider, model: options.model }
    : provider;
}

export function buildLocalLlmRequestOptions(
  options: Pick<MessageRequestOptions, 'conversationId' | 'maxTokens' | 'temperature'>,
): LocalLlmRequestOptions | undefined {
  const requestOptions: LocalLlmRequestOptions = {};

  if (options.conversationId !== undefined) {
    requestOptions.conversationId = options.conversationId;
  }
  if (options.maxTokens !== undefined) {
    requestOptions.maxTokens = options.maxTokens;
  }
  if (options.temperature !== undefined) {
    requestOptions.temperature = options.temperature;
  }

  return Object.keys(requestOptions).length > 0 ? requestOptions : undefined;
}
