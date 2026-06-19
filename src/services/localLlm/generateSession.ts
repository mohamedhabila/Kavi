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
import { generateWithNativeLocalLlm } from './native';
import { buildLocalPrompt } from './plainPrompt';
import { supportsOnDeviceLlmTools } from './provider';
import { prepareLocalLlmRequest } from './requestConfig';
import {
  getNativeLocalLlmRequestSamplingConfig,
  shouldEnableNativeLocalLlmConstrainedDecoding,
} from './samplingPolicy';
import { buildStructuredLocalConversation } from './structuredConversation';
import { buildLocalChatCompletionToolCalls } from './toolAdapter';
import type { LocalChatMessage, LocalLlmRequestOptions } from './types';

export async function sendLocalLlmMessage(
  provider: LlmProviderConfig,
  messages: LocalChatMessage[],
  tools?: ToolDefinition[],
  options?: LocalLlmRequestOptions,
): Promise<{ choices: Array<{ message: { content: string } }> }> {
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
    const result = await generateWithNativeLocalLlm({
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
    }).finally(() => {
      clearLocalLlmRuntimeActivity(request.modelPath, 'running');
    });
    rememberObservedLocalLlmBackend(request.modelPath, result.backend);
    const toolCalls = buildLocalChatCompletionToolCalls(result.toolCalls);

    return {
      choices: [
        {
          message: {
            content: result.text,
            ...(toolCalls ? { tool_calls: toolCalls } : {}),
          },
        },
      ],
    };
  }

  const prompt = buildLocalPrompt(messages, request.executionPolicy);
  const samplingConfig = getNativeLocalLlmRequestSamplingConfig(request.executionPolicy);
  const contextWindowTokens = getNativeLocalLlmRequestContextWindowTokens(
    request.executionPolicy,
    prompt.estimatedInputTokens,
  );
  rememberLocalLlmRuntimeActivity(request.modelPath, 'running');
  const result = await generateWithNativeLocalLlm({
    requestId: generateId(),
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
  }).finally(() => {
    clearLocalLlmRuntimeActivity(request.modelPath, 'running');
  });
  rememberObservedLocalLlmBackend(request.modelPath, result.backend);

  return {
    choices: [
      {
        message: {
          content: result.text,
        },
      },
    ],
  };
}
