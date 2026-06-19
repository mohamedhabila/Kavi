import type { AssistantCompletionMetadata, MessageProviderReplay } from '../../types/message';
import type { ToolDefinition } from '../../types/tool';
import { isPlainRecord } from '../../services/llm/core/json';
import {
  createCompletionMetadata,
  normalizeGeminiCompletion,
  normalizeOpenAiCompatibleCompletion,
} from '../../services/llm/core/streaming/metadataBuilder';
import { upsertPendingToolCall } from '../orchestratorToolTranscript';
import { createModelTurnUsageTracker } from './modelTurnExecutionSupport';
import type {
  ExecuteAgentControlGraphModelTurnParams,
  PendingAgentToolCall,
} from './modelTurnExecutionTypes';

function resolveSendMessageCompletionMetadata(params: {
  finishReason: unknown;
  hasToolCalls: boolean;
  geminiNative: boolean;
}): AssistantCompletionMetadata | undefined {
  if (params.hasToolCalls) {
    return createCompletionMetadata('complete', 'tool_calls');
  }

  return params.geminiNative
    ? normalizeGeminiCompletion(params.finishReason)
    : normalizeOpenAiCompatibleCompletion(params.finishReason);
}

function mapSendMessageToolCalls(
  toolCalls: ReadonlyArray<Record<string, unknown>>,
): PendingAgentToolCall[] {
  const pendingToolCalls: PendingAgentToolCall[] = [];
  for (const toolCall of toolCalls) {
    if (!isPlainRecord(toolCall)) {
      continue;
    }
    const rawFunction = isPlainRecord(toolCall.function) ? toolCall.function : undefined;
    const id = typeof toolCall.id === 'string' ? toolCall.id.trim() : '';
    const name = typeof rawFunction?.name === 'string' ? rawFunction.name.trim() : '';
    const args =
      typeof rawFunction?.arguments === 'string'
        ? rawFunction.arguments
        : JSON.stringify(rawFunction?.arguments ?? {});
    if (!id || !name) {
      continue;
    }
    const raw = isPlainRecord(toolCall.raw) ? toolCall.raw : toolCall;
    upsertPendingToolCall(pendingToolCalls, {
      id,
      name,
      arguments: args,
      raw,
    });
  }
  return pendingToolCalls;
}

export async function executeAgentControlGraphModelTurnStreaming(
  params: {
    allowQueuedToolCalls: boolean;
    budgetTools: ReadonlyArray<ToolDefinition>;
    requestMessages: Array<{ role: string; content: any }>;
    streamOptions: Record<string, any>;
  } & Pick<
    ExecuteAgentControlGraphModelTurnParams,
    | 'applyGraphEvents'
    | 'callbacks'
    | 'iteration'
    | 'llm'
    | 'recordPerformanceMetrics'
    | 'reportUsage'
    | 'requestModel'
    | 'signal'
  >,
): Promise<{
  completion?: AssistantCompletionMetadata;
  fullContent: string;
  pendingToolCalls: PendingAgentToolCall[];
  providerReplay?: MessageProviderReplay;
  reasoning: string;
}> {
  let fullContent = '';
  let reasoning = '';
  let providerReplay: MessageProviderReplay | undefined;
  let completion: AssistantCompletionMetadata | undefined;
  const pendingToolCalls: PendingAgentToolCall[] = [];
  const usageTracker = createModelTurnUsageTracker({
    getContentSnapshot: () => ({ fullContent, reasoning }),
    reportUsage: params.reportUsage,
    requestModel: params.requestModel,
    usageTelemetry: params.streamOptions.usageTelemetry,
  });

  try {
    params.applyGraphEvents([
      {
        type: 'MODEL_TURN_STARTED',
        iteration: params.iteration,
        toolNames: params.budgetTools.map((tool) => tool.name),
      },
    ]);
    const modelStreamStartedAt = Date.now();
    let firstModelOutputAt: number | undefined;
    const stream = params.llm.streamMessage(params.requestMessages, params.streamOptions);

    params.callbacks.onStateChange('responding');

    for await (const event of stream) {
      if (params.signal?.signal.aborted) {
        throw new Error('Request cancelled');
      }

      switch (event.type) {
        case 'token': {
          const content = event.content || '';
          fullContent += content;
          firstModelOutputAt = firstModelOutputAt ?? Date.now();
          params.callbacks.onToken(content);
          break;
        }
        case 'reasoning': {
          const content = event.content || '';
          reasoning += content;
          firstModelOutputAt = firstModelOutputAt ?? Date.now();
          params.callbacks.onReasoning?.(content);
          break;
        }
        case 'tool_call':
          if (event.toolCall && params.allowQueuedToolCalls) {
            const queuedToolCall = upsertPendingToolCall(pendingToolCalls, event.toolCall);
            params.callbacks.onToolCallQueued?.({
              id: queuedToolCall.id,
              name: queuedToolCall.name,
              arguments: queuedToolCall.arguments,
              ...(queuedToolCall.raw ? { raw: queuedToolCall.raw } : {}),
              status: 'pending',
            });
          }
          break;
        case 'usage':
          if (event.usage) {
            usageTracker.mergeSnapshot({
              inputTokens: event.usage.inputTokens,
              outputTokens: event.usage.outputTokens,
              cacheReadTokens: event.usage.cacheReadTokens,
              cacheWriteTokens: event.usage.cacheWriteTokens,
              totalTokens: event.usage.totalTokens,
              model: params.requestModel,
            });
          }
          break;
        case 'done':
          providerReplay = event.providerReplay;
          completion = event.completion;
          break;
      }
    }

    usageTracker.flush({
      allowFallback: true,
      requestMessages: params.requestMessages,
      budgetTools: params.budgetTools,
    });
    params.recordPerformanceMetrics(
      {
        modelTurnCount: 1,
        modelDurationMs: Date.now() - modelStreamStartedAt,
        ...(firstModelOutputAt !== undefined
          ? { timeToFirstTokenMs: firstModelOutputAt - modelStreamStartedAt }
          : {}),
      },
      'model_turn_completed',
    );

    return {
      completion,
      fullContent,
      pendingToolCalls,
      providerReplay,
      reasoning,
    };
  } catch (streamError: unknown) {
    usageTracker.flush({
      allowFallback: false,
      requestMessages: params.requestMessages,
      budgetTools: params.budgetTools,
    });
    params.recordPerformanceMetrics(
      {
        modelTurnCount: 1,
      },
      'model_turn_failed',
    );
    const streamErrorMsg = streamError instanceof Error ? streamError.message : String(streamError);
    params.applyGraphEvents([
      {
        type: 'MODEL_TURN_FAILED',
        iteration: params.iteration,
        reason: streamErrorMsg,
      },
    ]);
    throw streamError instanceof Error ? streamError : new Error(String(streamError));
  }
}

export async function executeAgentControlGraphModelTurnViaSendMessage(
  params: {
    budgetTools: ReadonlyArray<ToolDefinition>;
    geminiNative: boolean;
    requestMessages: Array<{ role: string; content: any }>;
    streamOptions: Record<string, any>;
  } & Pick<
    ExecuteAgentControlGraphModelTurnParams,
    | 'applyGraphEvents'
    | 'callbacks'
    | 'iteration'
    | 'llm'
    | 'recordPerformanceMetrics'
    | 'reportUsage'
    | 'requestModel'
    | 'signal'
  >,
): Promise<{
  completion?: AssistantCompletionMetadata;
  fullContent: string;
  pendingToolCalls: PendingAgentToolCall[];
  providerReplay?: MessageProviderReplay;
  reasoning: string;
}> {
  const usageTracker = createModelTurnUsageTracker({
    getContentSnapshot: () => ({ fullContent: '', reasoning: '' }),
    reportUsage: params.reportUsage,
    requestModel: params.requestModel,
    usageTelemetry: params.streamOptions.usageTelemetry,
  });

  params.applyGraphEvents([
    {
      type: 'MODEL_TURN_STARTED',
      iteration: params.iteration,
      toolNames: params.budgetTools.map((tool) => tool.name),
    },
  ]);

  const modelTurnStartedAt = Date.now();
  const response = await params.llm.sendMessage(params.requestMessages, {
    ...params.streamOptions,
    stream: false,
  });
  const choice = isPlainRecord(response?.choices?.[0]) ? response.choices[0] : undefined;
  const message = isPlainRecord(choice?.message) ? choice.message : {};
  const fullContent = typeof message.content === 'string' ? message.content : '';
  const reasoning = typeof message.reasoning === 'string' ? message.reasoning : '';
  const providerReplay = isPlainRecord(message.providerReplay)
    ? (message.providerReplay as MessageProviderReplay)
    : undefined;
  const rawToolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const pendingToolCalls = mapSendMessageToolCalls(rawToolCalls);
  const completion = resolveSendMessageCompletionMetadata({
    finishReason: choice?.finish_reason,
    hasToolCalls: pendingToolCalls.length > 0,
    geminiNative: params.geminiNative,
  });

  const usage = isPlainRecord(response?.usage) ? response.usage : undefined;
  if (usage) {
    usageTracker.mergeSnapshot({
      inputTokens: Number(usage.prompt_tokens ?? usage.input_tokens ?? 0),
      outputTokens: Number(usage.completion_tokens ?? usage.output_tokens ?? 0),
      cacheReadTokens: Number(usage.cache_read_input_tokens ?? 0),
      cacheWriteTokens: Number(usage.cache_creation_input_tokens ?? 0),
      totalTokens: Number(usage.total_tokens ?? 0),
      model: params.requestModel,
    });
  }

  usageTracker.flush({
    allowFallback: true,
    requestMessages: params.requestMessages,
    budgetTools: params.budgetTools,
  });
  params.recordPerformanceMetrics(
    {
      modelTurnCount: 1,
      modelDurationMs: Date.now() - modelTurnStartedAt,
    },
    'model_turn_completed',
  );

  if (fullContent) {
    params.callbacks.onStateChange('responding');
    params.callbacks.onToken(fullContent);
  } else if (reasoning) {
    params.callbacks.onStateChange('responding');
    params.callbacks.onReasoning?.(reasoning);
  }

  for (const toolCall of pendingToolCalls) {
    params.callbacks.onToolCallQueued?.({
      id: toolCall.id,
      name: toolCall.name,
      arguments: toolCall.arguments,
      ...(toolCall.raw ? { raw: toolCall.raw } : {}),
      status: 'pending',
    });
  }

  return {
    completion,
    fullContent,
    pendingToolCalls,
    providerReplay,
    reasoning,
  };
}
