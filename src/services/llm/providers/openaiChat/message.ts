import type { LlmProviderConfig } from '../../../../types/provider';
import {
  isOpenAIReasoningModel as supportsOpenAIReasoningModel,
  supportsTemperature as providerSupportsTemperature,
} from '../../catalog/providerCapabilities';
import {
  isGeminiModelName,
  resolveModelHostedFamily,
  resolveProviderFamily,
} from '../../catalog/providerFamilies';
import { resolveProviderTransport } from '../../catalog/providerProtocols';
import { isStrictCompatibleSchema, strictifyOpenAiSchema } from '../../core/schemaTransforms';
import { normalizeStructuredOutputOptions } from '../../core/structuredOutput';
import { reorderToolsForPromptCaching } from '../../core/toolCaching';
import { buildCompatibleToolChoice, shouldDisableParallelToolUse } from '../../core/toolChoice';
import type { LlmPerformFetch } from '../../core/fetchTransport';
import type { ChatCompletionMessage, MessageRequestOptions } from '../../support/contracts';
import { sendOpenAICompatibleChat } from './adapter';
import { buildCompatibleStructuredOutputFormat } from './structuredOutput';
import { normalizeOpenAIPromptCacheRetention } from '../openaiResponses/helpers';

export function sendOpenAICompatibleChatMessage(params: {
  provider: LlmProviderConfig;
  baseUrl: string;
  headers: Record<string, string>;
  model: string;
  messages: ChatCompletionMessage[];
  options: MessageRequestOptions;
  performFetch: LlmPerformFetch;
}): Promise<any> {
  return sendOpenAICompatibleChat({
    baseUrl: params.baseUrl,
    headers: params.headers,
    model: params.model,
    messages: params.messages,
    options: params.options,
    isGeminiModel: isGeminiModelName,
    supportsTemperature: providerSupportsTemperature,
    isOpenAIReasoningModel: supportsOpenAIReasoningModel,
    isOpenAIProvider: () => resolveProviderTransport(params.provider) === 'openai',
    isOpenRouterProvider: () => resolveProviderFamily(params.provider) === 'openrouter',
    isAnthropicModel: (model) => resolveModelHostedFamily(model) === 'anthropic',
    buildCompatibleStructuredOutputFormat,
    buildCompatibleToolChoice,
    shouldDisableParallelToolUse,
    normalizeOpenAIPromptCacheRetention,
    reorderToolsForPromptCaching,
    normalizeStructuredOutputOptions,
    strictifyOpenAiSchema,
    isStrictCompatibleSchema,
    performFetch: params.performFetch,
  });
}
