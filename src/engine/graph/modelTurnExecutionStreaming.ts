import type { AssistantCompletionMetadata, MessageProviderReplay } from '../../types/message';
import type { ToolDefinition } from '../../types/tool';
import { createAgentRunAbortError } from '../../services/runtimeError';
import { upsertPendingToolCall } from '../orchestratorToolTranscript';
import { createModelTurnUsageTracker, pickCalibrationInputs } from './modelTurnExecutionSupport';
import { createModelProjectionPublisher } from './modelTurnProjectionPublisher';
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
import {
  createModelTurnActivityGuard,
  FOREGROUND_MODEL_TURN_INACTIVITY_TIMEOUT_MS,
  normalizeModelTurnActivityError,
} from './modelTurnActivityGuard';
export { MODEL_TURN_INACTIVITY_TIMEOUT_MS } from './modelTurnActivityGuard';

// The streaming (SSE) request path. `modelTurnExecutionSendMessage.ts` holds the sibling
// non-streaming send-message path (Gemini-native tool-turn replay reconciliation); both share
// the batching/authority projection publisher in `modelTurnProjectionPublisher.ts` and the
// usage/calibration tracker in `modelTurnExecutionSupport.ts`. Split this way — rather than one
// file — to stay under this repo's maintainability line-count guardrail while keeping each
// request path's real logic in one place instead of scattering it across re-export shims.

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
  signal?: AbortSignal,
): Promise<{ kind: 'iterator'; value: IteratorResult<T> } | { kind: 'deadline' }> {
  const readSettled = (): IteratorResult<T> | undefined => {
    if (observed.state === 'rejected') throw observed.error;
    return observed.state === 'fulfilled' ? observed.value : undefined;
  };
  if (signal?.aborted) throw createAgentRunAbortError('Request cancelled');
  if (deadline !== undefined && deadline <= Date.now()) return { kind: 'deadline' };
  const settled = readSettled();
  if (settled) return { kind: 'iterator', value: settled };

  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      observed.waiters.delete(onSettled);
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(createAgentRunAbortError('Request cancelled'));
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
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
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

function closeModelStreamIterator(iterator: AsyncIterator<unknown> | undefined): void {
  if (!iterator?.return) return;
  try {
    void Promise.resolve(iterator.return()).catch(() => undefined);
  } catch {
    // The authority fence and projection rollback remain authoritative.
  }
}

export async function executeAgentControlGraphModelTurnStreaming(
  params: {
    allowQueuedToolCalls: boolean;
    budgetTools: ReadonlyArray<ToolDefinition>;
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
  let fullContent = '';
  let reasoning = '';
  let providerReplay: MessageProviderReplay | undefined;
  let completion: AssistantCompletionMetadata | undefined;
  const pendingToolCalls: PendingAgentToolCall[] = [];
  const usageTracker = createModelTurnUsageTracker({
    getContentSnapshot: () => ({ fullContent, reasoning }),
    reportUsage: params.reportUsage,
    requestModel: params.requestModel,
    ...pickCalibrationInputs(params),
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
  const activityGuard = createModelTurnActivityGuard(
    params.signal?.signal,
    params.isForegroundRun ? FOREGROUND_MODEL_TURN_INACTIVITY_TIMEOUT_MS : undefined,
  );
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
    const stream = params.llm.streamMessage(params.requestMessages, {
      ...params.streamOptions,
      signal: activityGuard.signal,
    });
    const iterator = stream[Symbol.asyncIterator]();
    streamIterator = iterator;
    let observedNext = observeIteratorNext(Promise.resolve(iterator.next()));

    params.callbacks.onStateChange('responding');

    while (true) {
      const next = await waitForIteratorOrDeadline(
        observedNext,
        projectionPublisher.nextDeadline(),
        activityGuard.signal,
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
      activityGuard.markActivity();
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
    const effectiveError = normalizeModelTurnActivityError(streamError, activityGuard);
    closeModelStreamIterator(streamIterator);
    if (effectiveError instanceof MemoryPromptEpochExpiredError) {
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
    const streamErrorMsg = effectiveError.message;
    params.applyGraphEvents([
      {
        type: 'MODEL_TURN_FAILED',
        iteration: params.iteration,
        reason: streamErrorMsg,
      },
    ]);
    throw effectiveError;
  } finally {
    activityGuard.dispose();
  }
}
