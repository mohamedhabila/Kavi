import { isVertexNativeGeminiBaseUrl } from '../../../../constants/api';
import type { LlmProviderConfig } from '../../../../types/provider';
import {
  supportsGeminiStructuredOutputWithTools as providerSupportsGeminiStructuredOutputWithTools,
  supportsTemperature as providerSupportsTemperature,
} from '../../catalog/providerCapabilities';
import { attachProviderResponse } from '../../core/providerResponse';
import { splitCacheableSystemPromptSections } from '../../core/systemPromptSections';
import { reorderToolsForPromptCaching } from '../../core/toolCaching';
import type { LlmPerformFetch } from '../../core/fetchTransport';
import type { ChatCompletionMessage, MessageRequestOptions } from '../../support/contracts';
import { sendGeminiNative } from './adapter';
import {
  buildGeminiGenerateContentUrl,
  buildGeminiModelName,
  buildGeminiRequestBody,
  resolveGeminiStructuredOutputSyntax,
  shouldRetryGeminiStructuredOutputWithLegacySyntax,
} from './request';
import { normalizeGeminiResponse } from './response';

export function sendGeminiMessage(params: {
  provider: LlmProviderConfig;
  baseUrl: string;
  headers: Record<string, string>;
  model: string;
  messages: ChatCompletionMessage[];
  options: MessageRequestOptions;
  performFetch: LlmPerformFetch;
}): Promise<any> {
  return sendGeminiNative({
    baseUrl: params.baseUrl,
    headers: params.headers,
    model: params.model,
    messages: params.messages,
    options: params.options,
    buildGeminiModelName,
    buildGeminiRequestBody: (
      requestBaseUrl,
      candidateModel,
      requestMessages,
      requestOptions,
      structuredOutputSyntax,
    ) =>
      buildGeminiRequestBody({
        baseUrl: requestBaseUrl,
        model: candidateModel,
        messages: requestMessages,
        options: requestOptions,
        structuredOutputSyntax:
          structuredOutputSyntax ??
          resolveGeminiStructuredOutputSyntax(requestBaseUrl, {
            isVertexNativeGeminiBaseUrl,
          }),
        supportsGeminiStructuredOutputWithTools: (resolvedModel) =>
          providerSupportsGeminiStructuredOutputWithTools(resolvedModel, params.provider),
        supportsTemperature: providerSupportsTemperature,
        isVertexNativeGeminiBaseUrl,
        reorderToolsForPromptCaching,
      }),
    buildGeminiGenerateContentUrl: (requestBaseUrl, candidateModel, methodName) =>
      buildGeminiGenerateContentUrl(requestBaseUrl, candidateModel, methodName, {
        isVertexNativeGeminiBaseUrl,
      }),
    shouldRetryGeminiStructuredOutputWithLegacySyntax,
    normalizeGeminiResponse,
    attachProviderResponse,
    splitCacheableSystemPromptSections,
    performFetch: params.performFetch,
  });
}
