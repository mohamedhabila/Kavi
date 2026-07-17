import type {
  AssistantCompletionMetadata,
  MessageProviderReplay,
  ToolCall,
} from '../../types/message';
import type { ToolDefinition } from '../../types/tool';
import { isPlainRecord } from '../../services/llm/core/json';
import { createAgentRunAbortError } from '../../services/runtimeError';
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
import {
  assertModelTurnMemoryPolicyBindingCurrent,
  assertModelTurnMemoryPolicyBindingDurablyCurrent,
  MemoryPromptEpochExpiredError,
  type ModelTurnMemoryPolicyBinding,
} from '../authority/modelTurnMemoryPolicyBinding';

const MODEL_PROJECTION_BATCH_MAX_LATENCY_MS = 48;
const MODEL_PROJECTION_BATCH_MAX_EVENTS = 24;
const MODEL_PROJECTION_BATCH_MAX_TEXT_CHARS = 768;
const MODEL_PROJECTION_AUTHORITY_LEASE_MS = 200;

type ModelProjectionOperation =
  | { kind: 'token'; content: string }
  | { kind: 'reasoning'; content: string }
  | { kind: 'tool_call'; toolCall: ToolCall };

type ObservedIteratorNext<T> = {
  state: 'pending' | 'fulfilled' | 'rejected';
  value?: IteratorResult<T>;
  error?: unknown;
  waiters: Set<() => void>;
};

function observeIteratorNext<T>(next: Promise<IteratorResult<T>>): ObservedIteratorNext<T> {
  const observed: ObservedIteratorNext<T> = {
    state: 'pending',
    waiters: new Set(),
  };
  void next.then(
    (value) => {
      observed.state = 'fulfilled';
      observed.value = value;
      for (const waiter of observed.waiters) waiter();
      observed.waiters.clear();
    },
    (error: unknown) => {
      observed.state = 'rejected';
      observed.error = error;
      for (const waiter of observed.waiters) waiter();
      observed.waiters.clear();
    },
  );
  return observed;
}

async function waitForIteratorOrDeadline<T>(
  observed: ObservedIteratorNext<T>,
  deadline: number | undefined,
): Promise<{ kind: 'iterator'; value: IteratorResult<T> } | { kind: 'deadline' }> {
  const readSettled = (): IteratorResult<T> | undefined => {
    if (observed.state === 'rejected') throw observed.error;
    return observed.state === 'fulfilled' ? observed.value : undefined;
  };
  if (deadline !== undefined && deadline <= Date.now()) return { kind: 'deadline' };
  const settled = readSettled();
  if (settled) return { kind: 'iterator', value: settled };

  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      observed.waiters.delete(onSettled);
      if (timer !== undefined) clearTimeout(timer);
    };
    const onSettled = () => {
      cleanup();
      try {
        const value = readSettled();
        if (!value) {
          reject(new Error('model_projection_iterator_state_invalid'));
          return;
        }
        resolve({ kind: 'iterator', value });
      } catch (error) {
        reject(error);
      }
    };
    observed.waiters.add(onSettled);
    if (deadline !== undefined) {
      timer = setTimeout(
        () => {
          cleanup();
          resolve({ kind: 'deadline' });
        },
        Math.max(0, deadline - Date.now()),
      );
    }
  });
}

function createModelProjectionPublisher(params: {
  callbacks: ExecuteAgentControlGraphModelTurnParams['callbacks'];
  memoryPolicyBinding: ModelTurnMemoryPolicyBinding;
  onInvalidated: () => void;
}) {
  let batch: ModelProjectionOperation[] = [];
  let batchEventCount = 0;
  let batchTextChars = 0;
  let batchStartedAt: number | undefined;
  let authorityLeaseDeadline: number | undefined;
  let hasPublishedProjection = false;
  let invalidated = false;

  const clearBatch = () => {
    batch = [];
    batchEventCount = 0;
    batchTextChars = 0;
    batchStartedAt = undefined;
  };
  const invalidate = () => {
    if (invalidated) return;
    invalidated = true;
    clearBatch();
    authorityLeaseDeadline = undefined;
    params.onInvalidated();
    if (hasPublishedProjection) {
      try {
        params.callbacks.onAssistantStreamReset?.();
      } catch {
        // Reset observer failures are ancillary; authority revocation remains primary.
      }
    }
  };
  const assertDurablyCurrent = () => {
    try {
      assertModelTurnMemoryPolicyBindingDurablyCurrent(params.memoryPolicyBinding);
    } catch (error) {
      invalidate();
      throw error;
    }
  };
  const renewAuthorityLease = () => {
    if (params.memoryPolicyBinding.kind === 'policy_independent') {
      authorityLeaseDeadline = undefined;
      return;
    }
    const now = Date.now();
    const bindingDeadline = params.memoryPolicyBinding.validUntil ?? Number.POSITIVE_INFINITY;
    authorityLeaseDeadline = Math.min(now + MODEL_PROJECTION_AUTHORITY_LEASE_MS, bindingDeadline);
  };
  const enqueueText = (kind: 'token' | 'reasoning', content: string) => {
    if (!content) return;
    batchStartedAt ??= Date.now();
    batchEventCount += 1;
    batchTextChars += content.length;
    const previous = batch.at(-1);
    if (previous?.kind === kind) {
      previous.content += content;
      return;
    }
    batch.push({ kind, content });
  };

  return {
    enqueueReasoning(content: string) {
      enqueueText('reasoning', content);
    },
    enqueueToken(content: string) {
      enqueueText('token', content);
    },
    enqueueToolCall(toolCall: ToolCall) {
      batchStartedAt ??= Date.now();
      batchEventCount += 1;
      batch.push({ kind: 'tool_call', toolCall });
    },
    flush() {
      if (batch.length === 0) return;
      const operations = batch;
      clearBatch();
      const publishGroup = (group: ReadonlyArray<ModelProjectionOperation>) => {
        assertDurablyCurrent();
        let callbackThrew = false;
        let callbackError: unknown;
        try {
          for (const operation of group) {
            switch (operation.kind) {
              case 'token':
                hasPublishedProjection = true;
                params.callbacks.onToken(operation.content);
                break;
              case 'reasoning':
                if (params.callbacks.onReasoning) {
                  hasPublishedProjection = true;
                  params.callbacks.onReasoning(operation.content);
                }
                break;
              case 'tool_call':
                if (params.callbacks.onToolCallQueued) {
                  hasPublishedProjection = true;
                  params.callbacks.onToolCallQueued(operation.toolCall);
                }
                break;
            }
          }
        } catch (error) {
          callbackThrew = true;
          callbackError = error;
        }
        assertDurablyCurrent();
        if (callbackThrew) throw callbackError;
      };
      let textGroup: ModelProjectionOperation[] = [];
      for (const operation of operations) {
        if (operation.kind !== 'tool_call') {
          textGroup.push(operation);
          continue;
        }
        if (textGroup.length > 0) {
          publishGroup(textGroup);
          textGroup = [];
        }
        publishGroup([operation]);
      }
      if (textGroup.length > 0) publishGroup(textGroup);
      renewAuthorityLease();
    },
    invalidate,
    nextDeadline(): number | undefined {
      const batchDeadline =
        batchStartedAt === undefined
          ? undefined
          : batchStartedAt + MODEL_PROJECTION_BATCH_MAX_LATENCY_MS;
      if (batchDeadline === undefined) return authorityLeaseDeadline;
      if (authorityLeaseDeadline === undefined) return batchDeadline;
      return Math.min(batchDeadline, authorityLeaseDeadline);
    },
    onDeadline() {
      const now = Date.now();
      if (
        batchStartedAt !== undefined &&
        batchStartedAt + MODEL_PROJECTION_BATCH_MAX_LATENCY_MS <= now
      ) {
        this.flush();
      }
      if (authorityLeaseDeadline !== undefined && authorityLeaseDeadline <= Date.now()) {
        assertDurablyCurrent();
        renewAuthorityLease();
      }
    },
    shouldFlushImmediately(): boolean {
      return (
        batchEventCount >= MODEL_PROJECTION_BATCH_MAX_EVENTS ||
        batchTextChars >= MODEL_PROJECTION_BATCH_MAX_TEXT_CHARS
      );
    },
  };
}

function closeModelStreamIterator(iterator: AsyncIterator<unknown> | undefined): void {
  if (!iterator?.return) return;
  try {
    void Promise.resolve(iterator.return()).catch(() => undefined);
  } catch {
    // The authority fence and projection rollback remain authoritative.
  }
}

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
    memoryPolicyBinding: ModelTurnMemoryPolicyBinding;
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
  const projectionPublisher = createModelProjectionPublisher({
    callbacks: params.callbacks,
    memoryPolicyBinding: params.memoryPolicyBinding,
    onInvalidated: () => {
      fullContent = '';
      reasoning = '';
      providerReplay = undefined;
      completion = undefined;
      pendingToolCalls.splice(0);
    },
  });
  let streamIterator: AsyncIterator<any> | undefined;

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
    const iterator = stream[Symbol.asyncIterator]();
    streamIterator = iterator;
    let observedNext = observeIteratorNext(Promise.resolve(iterator.next()));

    params.callbacks.onStateChange('responding');

    while (true) {
      const next = await waitForIteratorOrDeadline(
        observedNext,
        projectionPublisher.nextDeadline(),
      );
      if (next.kind === 'deadline') {
        projectionPublisher.onDeadline();
        continue;
      }
      if (next.value.done) {
        projectionPublisher.flush();
        break;
      }
      const event = next.value.value;
      observedNext = observeIteratorNext(Promise.resolve(iterator.next()));
      if (params.signal?.signal.aborted) {
        throw createAgentRunAbortError('Request cancelled');
      }
      if (event.type === 'usage') {
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
        continue;
      }
      assertModelTurnMemoryPolicyBindingCurrent(params.memoryPolicyBinding);

      switch (event.type) {
        case 'token': {
          const content = event.content || '';
          fullContent += content;
          firstModelOutputAt = firstModelOutputAt ?? Date.now();
          projectionPublisher.enqueueToken(content);
          break;
        }
        case 'reasoning': {
          const content = event.content || '';
          reasoning += content;
          firstModelOutputAt = firstModelOutputAt ?? Date.now();
          projectionPublisher.enqueueReasoning(content);
          break;
        }
        case 'tool_call':
          if (event.toolCall && params.allowQueuedToolCalls) {
            const queuedToolCall = upsertPendingToolCall(pendingToolCalls, event.toolCall);
            projectionPublisher.enqueueToolCall({
              id: queuedToolCall.id,
              name: queuedToolCall.name,
              arguments: queuedToolCall.arguments,
              ...(queuedToolCall.raw ? { raw: queuedToolCall.raw } : {}),
              status: 'pending',
            });
            projectionPublisher.flush();
          }
          break;
        case 'done':
          projectionPublisher.flush();
          providerReplay = event.providerReplay;
          completion = event.completion;
          break;
      }
      if (projectionPublisher.shouldFlushImmediately()) {
        projectionPublisher.flush();
      }
      if (event.type !== 'done') {
        assertModelTurnMemoryPolicyBindingCurrent(params.memoryPolicyBinding);
      }
    }

    usageTracker.flush({
      allowFallback: true,
      requestMessages: params.requestMessages,
      budgetTools: params.budgetTools,
    });
    assertModelTurnMemoryPolicyBindingDurablyCurrent(params.memoryPolicyBinding);
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
    closeModelStreamIterator(streamIterator);
    if (streamError instanceof MemoryPromptEpochExpiredError) {
      projectionPublisher.invalidate();
    }
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
    memoryPolicyBinding: ModelTurnMemoryPolicyBinding;
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
  const projectionPublisher = createModelProjectionPublisher({
    callbacks: params.callbacks,
    memoryPolicyBinding: params.memoryPolicyBinding,
    onInvalidated: () => undefined,
  });

  params.applyGraphEvents([
    {
      type: 'MODEL_TURN_STARTED',
      iteration: params.iteration,
      toolNames: params.budgetTools.map((tool) => tool.name),
    },
  ]);

  const modelTurnStartedAt = Date.now();
  try {
    const response = await params.llm.sendMessage(params.requestMessages, {
      ...params.streamOptions,
      stream: false,
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
    if (error instanceof MemoryPromptEpochExpiredError) {
      projectionPublisher.invalidate();
    }
    usageTracker.flush({
      allowFallback: false,
      requestMessages: params.requestMessages,
      budgetTools: params.budgetTools,
    });
    params.recordPerformanceMetrics({ modelTurnCount: 1 }, 'model_turn_failed');
    const reason = error instanceof Error ? error.message : String(error);
    params.applyGraphEvents([
      {
        type: 'MODEL_TURN_FAILED',
        iteration: params.iteration,
        reason,
      },
    ]);
    throw error instanceof Error ? error : new Error(reason);
  }
}
