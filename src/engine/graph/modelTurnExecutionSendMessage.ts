import type { AssistantCompletionMetadata, MessageProviderReplay } from '../../types/message';
import type { ToolDefinition } from '../../types/tool';
import { isPlainRecord } from '../../services/llm/core/json';
import {
  createCompletionMetadata,
  normalizeGeminiCompletion,
  normalizeOpenAiCompatibleCompletion,
} from '../../services/llm/core/streaming/metadataBuilder';
import { createModelTurnUsageTracker, pickCalibrationInputs } from './modelTurnExecutionSupport';
import type {
  ExecuteAgentControlGraphModelTurnParams,
  PendingAgentToolCall,
} from './modelTurnExecutionTypes';
import { upsertPendingToolCall } from '../orchestratorToolTranscript';
import { createModelProjectionPublisher } from './modelTurnProjectionPublisher';
import {
  assertModelTurnMemoryPolicyBindingDurablyCurrent,
  MemoryPromptEpochExpiredError,
  type ModelTurnMemoryPolicyBinding,
} from '../authority/modelTurnMemoryPolicyBinding';
import {
  createModelTurnActivityGuard,
  FOREGROUND_MODEL_TURN_INACTIVITY_TIMEOUT_MS,
  normalizeModelTurnActivityError,
  waitForPromiseOrAbort,
} from './modelTurnActivityGuard';

// The non-streaming request path: used for `sendMessage`-based turns (Gemini-native tool-turn
// replay reconciliation) as opposed to `executeAgentControlGraphModelTurnStreaming`'s SSE path
// in `modelTurnExecutionStreaming.ts`. Split out of that file to stay under its line-count
// guardrail — see this repo's maintainability check. The two paths share the batching/authority
// projection publisher (`modelTurnProjectionPublisher.ts`) and the usage/calibration tracker
// (`modelTurnExecutionSupport.ts`).

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

export async function executeAgentControlGraphModelTurnViaSendMessage(
  params: {
    budgetTools: ReadonlyArray<ToolDefinition>;
    geminiNative: boolean;
    memoryPolicyBinding: ModelTurnMemoryPolicyBinding;
    requestMessages: Array<{ role: string; content: any }>;
    streamOptions: Record<string, any>;
  } & ReturnType<typeof pickCalibrationInputs> &
    Pick<
      ExecuteAgentControlGraphModelTurnParams,
      | 'applyGraphEvents'
      | 'callbacks'
      | 'isForegroundRun'
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
    ...pickCalibrationInputs(params),
    usageTelemetry: params.streamOptions.usageTelemetry,
  });
  const projectionPublisher = createModelProjectionPublisher({
    callbacks: params.callbacks,
    memoryPolicyBinding: params.memoryPolicyBinding,
    onInvalidated: () => undefined,
  });
  const activityGuard = createModelTurnActivityGuard(
    params.signal?.signal,
    params.isForegroundRun ? FOREGROUND_MODEL_TURN_INACTIVITY_TIMEOUT_MS : undefined,
  );

  params.applyGraphEvents([
    {
      type: 'MODEL_TURN_STARTED',
      iteration: params.iteration,
      toolNames: params.budgetTools.map((tool) => tool.name),
    },
  ]);

  const modelTurnStartedAt = Date.now();
  try {
    const response = await waitForPromiseOrAbort(
      params.llm.sendMessage(params.requestMessages, {
        ...params.streamOptions,
        signal: activityGuard.signal,
        stream: false,
      }),
      activityGuard.signal,
    );
    activityGuard.markActivity();
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
    assertModelTurnMemoryPolicyBindingDurablyCurrent(params.memoryPolicyBinding);
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

    if (fullContent) {
      params.callbacks.onStateChange('responding');
      projectionPublisher.enqueueToken(fullContent);
    } else if (reasoning) {
      params.callbacks.onStateChange('responding');
      projectionPublisher.enqueueReasoning(reasoning);
    }

    for (const toolCall of pendingToolCalls) {
      projectionPublisher.enqueueToolCall({
        id: toolCall.id,
        name: toolCall.name,
        arguments: toolCall.arguments,
        ...(toolCall.raw ? { raw: toolCall.raw } : {}),
        status: 'pending',
      });
    }
    projectionPublisher.flush();

    usageTracker.flush({
      allowFallback: true,
      requestMessages: params.requestMessages,
      budgetTools: params.budgetTools,
    });
    assertModelTurnMemoryPolicyBindingDurablyCurrent(params.memoryPolicyBinding);
    params.recordPerformanceMetrics(
      {
        modelTurnCount: 1,
        modelDurationMs: Date.now() - modelTurnStartedAt,
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
  } catch (error: unknown) {
    const effectiveError = normalizeModelTurnActivityError(error, activityGuard);
    if (effectiveError instanceof MemoryPromptEpochExpiredError) {
      projectionPublisher.invalidate();
    }
    usageTracker.flush({
      allowFallback: false,
      requestMessages: params.requestMessages,
      budgetTools: params.budgetTools,
    });
    params.recordPerformanceMetrics({ modelTurnCount: 1 }, 'model_turn_failed');
    const reason = effectiveError.message;
    params.applyGraphEvents([
      {
        type: 'MODEL_TURN_FAILED',
        iteration: params.iteration,
        reason,
      },
    ]);
    throw effectiveError;
  } finally {
    activityGuard.dispose();
  }
}
