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

function throwIfLocalLlmRequestAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  const error = new Error('Request cancelled');
  error.name = 'AbortError';
  throw error;
}

async function finishLocalLlmRequestCancellation(
  requestId: string,
  signal: AbortSignal | undefined,
): Promise<void> {
  const cancellation = cancelNativeLocalLlmRequest(requestId);
  if (!signal) {
    await cancellation;
    return;
  }
  if (signal.aborted) {
    void cancellation.catch(() => undefined);
    return;
  }

  let resolveAbort: (() => void) | null = null;
  const abort = () => resolveAbort?.();
  signal.addEventListener('abort', abort, { once: true });
  try {
    await Promise.race([
      cancellation,
      new Promise<void>((resolve) => {
        resolveAbort = resolve;
        if (signal.aborted) resolve();
      }),
    ]);
  } finally {
    resolveAbort = null;
    signal.removeEventListener('abort', abort);
  }
}

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
  throwIfLocalLlmRequestAborted(options?.signal);
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
      for await (const event of streamWithNativeLocalLlm(
        {
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
        },
        options?.signal,
      )) {
        throwIfLocalLlmRequestAborted(options?.signal);
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
      throwIfLocalLlmRequestAborted(options?.signal);
    } finally {
      clearLocalLlmRuntimeActivity(request.modelPath, 'running');
      await finishLocalLlmRequestCancellation(requestId, options?.signal);
    }

    throwIfLocalLlmRequestAborted(options?.signal);
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
    for await (const event of streamWithNativeLocalLlm(
      {
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
      },
      options?.signal,
    )) {
      throwIfLocalLlmRequestAborted(options?.signal);
      rememberObservedLocalLlmBackend(request.modelPath, event.backend);
      if (event.content) {
        yield { type: 'token', content: event.content };
      }
    }
    throwIfLocalLlmRequestAborted(options?.signal);
  } finally {
    clearLocalLlmRuntimeActivity(request.modelPath, 'running');
    await finishLocalLlmRequestCancellation(requestId, options?.signal);
  }

  throwIfLocalLlmRequestAborted(options?.signal);
  yield { type: 'done' };
}
