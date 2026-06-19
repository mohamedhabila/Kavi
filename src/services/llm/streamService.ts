import type { LlmProviderConfig } from '../../types/provider';
import { streamLocalLlmMessage } from '../localLlm/streamSession';
import { shouldSurfaceReasoning as shouldSurfaceProviderReasoning } from './catalog/providerCapabilities';
import { resolveModelHostedFamily } from './catalog/providerFamilies';
import { resolveProviderTransport } from './catalog/providerProtocols';
import type { LlmPerformFetch } from './core/fetchTransport';
import { safeJsonParse } from './core/json';
import { getOpenAIReasoningTextParts } from './core/reasoningExtraction';
import { buildDeclaredToolNameSet } from './core/toolNameFilter';
import {
  buildAnthropicToolRaw,
  normalizeAnthropicAssistantBlocks,
} from './providers/anthropic/toolReplay';
import { streamAnthropicMessages } from './providers/anthropic/stream';
import { streamGeminiNative } from './providers/gemini/stream';
import {
  buildOpenAIResponseToolRaw,
  buildOpenAIResponsesReplayInputContext,
  mergeOpenAIStreamToolCall,
  normalizeOpenAIResponsesResult,
} from './providers/openaiResponses/helpers';
import { streamOpenAIResponses } from './providers/openaiResponses/stream';
import { streamOpenAICompatibleChat } from './providers/openaiChat/stream';
import {
  extractOpenAiCompatibleStreamText,
  extractOpenAiCompatibleTextValue,
  trimGeminiCumulativeText,
} from './providers/openaiChat/streamText';
import { buildLocalLlmRequestOptions, resolveLocalProviderForRequest } from './localProviderRequest';
import { sendLlmMessage } from './messageService';
import type {
  ChatCompletionMessage,
  MessageRequestOptions,
  StreamEvent,
} from './support/contracts';

export async function* streamLlmMessage(params: {
  provider: LlmProviderConfig;
  messages: ChatCompletionMessage[];
  options?: Omit<MessageRequestOptions, 'stream'>;
  performFetch: LlmPerformFetch;
}): AsyncGenerator<StreamEvent> {
  const options = params.options || {};
  const model = options.model || params.provider.model;
  const providerTransport = resolveProviderTransport(params.provider);

  if (providerTransport === 'local') {
    const localConfig = resolveLocalProviderForRequest(params.provider, options);
    for await (const event of streamLocalLlmMessage(
      localConfig,
      params.messages,
      options.tools,
      buildLocalLlmRequestOptions(options),
    )) {
      if (event.type === 'token' && event.content) {
        yield { type: 'token', content: event.content };
        continue;
      }

      if (event.type === 'tool_call' && event.toolCall) {
        yield { type: 'tool_call', toolCall: event.toolCall };
        continue;
      }

      if (event.type === 'done') {
        yield {
          type: 'done',
          completion: {
            completionStatus: 'complete',
          },
        };
      }
    }
    return;
  }

  const response = await sendLlmMessage({
    provider: params.provider,
    messages: params.messages,
    options: { ...options, stream: true },
    performFetch: params.performFetch,
  });
  const shouldSurfaceReasoning = shouldSurfaceProviderReasoning(model);
  const providerFamily = params.provider.providerFamily || 'custom';
  const hostedModelFamily = resolveModelHostedFamily(model);
  const geminiTarget = providerFamily === 'gemini' || hostedModelFamily === 'gemini';

  if (providerTransport === 'anthropic') {
    yield* streamAnthropicMessages({
      response,
      signal: options.signal,
      buildAnthropicToolRaw,
      normalizeAnthropicAssistantBlocks,
      safeJsonParse,
    });
    return;
  }

  if (providerTransport === 'gemini') {
    yield* streamGeminiNative({
      declaredToolNames: buildDeclaredToolNameSet(options.tools),
      response,
      signal: options.signal,
      shouldSurfaceReasoning,
      safeJsonParse,
    });
    return;
  }

  if (providerTransport === 'openai') {
    yield* streamOpenAIResponses({
      response,
      signal: options.signal,
      shouldSurfaceReasoning,
      replayInputContext: buildOpenAIResponsesReplayInputContext(options),
      buildOpenAIResponseToolRaw,
      mergeOpenAIStreamToolCall,
      normalizeOpenAIResponsesResult,
      getOpenAIReasoningTextParts,
    });
    return;
  }

  yield* streamOpenAICompatibleChat({
    response,
    signal: options.signal,
    geminiTarget,
    shouldSurfaceReasoning,
    extractOpenAiCompatibleStreamText,
    extractOpenAiCompatibleTextValue,
    trimGeminiCumulativeText,
    safeJsonParse,
  });
}
