import type { LlmProviderConfig } from '../../types/provider';
import type { ToolDefinition } from '../../types/tool';
import { generateId } from '../../utils/id';
import {
  clearLocalLlmRuntimeActivity,
  rememberLocalLlmRuntimeActivity,
  rememberObservedLocalLlmBackend,
} from './backendStatus';
import { getNativeLocalLlmRequestContextWindowTokens } from './contextWindowPolicy';
import { buildNativeLocalLlmContextTelemetryFields } from './contextPressure';
import { cancelNativeLocalLlmRequest, streamWithNativeLocalLlm } from './native';
import { buildLocalPrompt } from './plainPrompt';
import { supportsOnDeviceLlmTools } from './provider';
import { prepareLocalLlmRequest } from './requestConfig';
import {
  getNativeLocalLlmRequestSamplingConfig,
  shouldEnableNativeLocalLlmConstrainedDecoding,
} from './samplingPolicy';
import { buildStructuredLocalConversation } from './structuredConversation';
import { stringifyLocalToolArguments } from './toolAdapter';
import type { LocalChatMessage, LocalLlmRequestOptions } from './types';

export async function* streamLocalLlmMessage(
  provider: LlmProviderConfig,
  messages: LocalChatMessage[],
  tools?: ToolDefinition[],
  options?: LocalLlmRequestOptions,
): AsyncGenerator<
  | { type: 'token'; content: string }
  | { type: 'tool_call'; toolCall: { id: string; name: string; arguments: string } }
  | { type: 'done' }
> {
  const request = await prepareLocalLlmRequest(provider, options);
  const requestId = generateId();

  if (supportsOnDeviceLlmTools(provider)) {
    const conversation = buildStructuredLocalConversation(messages, request.executionPolicy, tools);
    const samplingConfig = getNativeLocalLlmRequestSamplingConfig(request.executionPolicy);
    const contextWindowTokens = getNativeLocalLlmRequestContextWindowTokens(
      request.executionPolicy,
      conversation.estimatedInputTokens,
    );
    const enableConstrainedDecoding = shouldEnableNativeLocalLlmConstrainedDecoding(
      request.executionPolicy,
      conversation.tools,
    );

    rememberLocalLlmRuntimeActivity(request.modelPath, 'running');
    try {
      for await (const event of streamWithNativeLocalLlm({
        requestId,
        conversationKey: request.conversationKey,
        modelPath: request.nativeModelPath,
        runtime: request.runtime,
        systemPrompt: conversation.systemPrompt,
        history: conversation.history,
        currentMessage: conversation.currentMessage,
        tools: conversation.tools,
        backend: request.backend,
        ...(request.visionBackend ? { visionBackend: request.visionBackend } : {}),
        ...(request.audioBackend ? { audioBackend: request.audioBackend } : {}),
        maxTokens: request.executionPolicy.maxTokens,
        contextWindowTokens,
        ...buildNativeLocalLlmContextTelemetryFields(conversation.context),
        ...samplingConfig,
        ...(enableConstrainedDecoding ? { enableConstrainedDecoding: true } : {}),
        minDeviceMemoryGb: request.executionPolicy.minDeviceMemoryGb ?? undefined,
      })) {
        rememberObservedLocalLlmBackend(request.modelPath, event.backend);
        if (event.type === 'token' && event.content) {
          yield { type: 'token', content: event.content };
          continue;
        }

        if (event.type === 'tool_call' && event.toolCall) {
          yield {
            type: 'tool_call',
            toolCall: {
              id: event.toolCall.id,
              name: event.toolCall.name,
              arguments: stringifyLocalToolArguments(event.toolCall.arguments),
            },
          };
        }
      }
    } finally {
      clearLocalLlmRuntimeActivity(request.modelPath, 'running');
      await cancelNativeLocalLlmRequest(requestId);
    }

    yield { type: 'done' };
    return;
  }

  const prompt = buildLocalPrompt(messages, request.executionPolicy);
  const samplingConfig = getNativeLocalLlmRequestSamplingConfig(request.executionPolicy);
  const contextWindowTokens = getNativeLocalLlmRequestContextWindowTokens(
    request.executionPolicy,
    prompt.estimatedInputTokens,
  );

  rememberLocalLlmRuntimeActivity(request.modelPath, 'running');
  try {
    for await (const event of streamWithNativeLocalLlm({
      requestId,
      conversationKey: request.conversationKey,
      modelPath: request.nativeModelPath,
      runtime: request.runtime,
      prompt: prompt.prompt,
      systemPrompt: prompt.systemPrompt,
      history: prompt.history,
      backend: request.backend,
      ...(request.visionBackend ? { visionBackend: request.visionBackend } : {}),
      ...(request.audioBackend ? { audioBackend: request.audioBackend } : {}),
      maxTokens: request.executionPolicy.maxTokens,
      contextWindowTokens,
      ...buildNativeLocalLlmContextTelemetryFields(prompt.context),
      ...samplingConfig,
      minDeviceMemoryGb: request.executionPolicy.minDeviceMemoryGb ?? undefined,
    })) {
      rememberObservedLocalLlmBackend(request.modelPath, event.backend);
      if (event.content) {
        yield { type: 'token', content: event.content };
      }
    }
  } finally {
    clearLocalLlmRuntimeActivity(request.modelPath, 'running');
    await cancelNativeLocalLlmRequest(requestId);
  }

  yield { type: 'done' };
}
