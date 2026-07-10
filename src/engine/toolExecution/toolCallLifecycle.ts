import { emitAgentEvent } from '../../services/events/bus';
import { getWorkingContextWindow } from '../../services/context/tokenCounter';
import { isToolResultErrorLike } from '../../utils/toolResultErrors';
import { executeTool } from '../tools/index';
import { resolveRegisteredToolName } from '../tools/toolNameNormalization';
import { maybeSpillToolOutput } from '../tools/toolOutputSpill';
import { enforceToolResultBudget } from '../toolResultGuard';
import { applyTrackedAsyncToolResult } from '../pendingAsyncOperations';
import {
  buildToolResultMessage,
  completeRunningToolCall,
  createRunningToolCall,
  failRunningToolCall,
} from './toolExecutionMessages';
import {
  recordLifecyclePerformanceMetrics,
  recordLifecycleToolCall,
  yieldToUiFrame,
} from './toolCallLifecycleRecording';
import { resolveToolCallPreflight } from './toolCallLifecyclePreflight';
import { enrichToolResultWithSchemaRepair } from './toolResultRepair';
import { buildToolEffectReceipt } from './toolEffectReceipt';
import { appendToolEffectReceipt } from '../../utils/toolEffectReceipt';
import type { ToolCall } from '../../types/message';
import type { ToolEffectReceipt } from '../../types/toolEffectReceipt';
import type {
  ToolExecutionLifecycleParams,
  ToolExecutionLifecycleResult,
} from './toolCallLifecycleTypes';
import {
  buildUntrackedExternalToolResult,
  observeExternalToolResultDurability,
} from '../../services/executionJournal/externalToolDurabilityLifecycle';
import { recordVerifiedToolEffectExperience } from '../../services/memory/verifiedToolEffectExperience';

async function appendExecutionReceipt(params: {
  lifecycle: ToolExecutionLifecycleParams;
  toolCall: ToolCall;
  result: string;
  transportState: 'returned' | 'rejected' | 'threw';
  resultIsError?: boolean;
  terminalEffectState?: 'cancelled' | 'failed';
  recordedAt: number;
}): Promise<ToolEffectReceipt | undefined> {
  let receipt: ToolEffectReceipt;
  try {
    receipt = await buildToolEffectReceipt({
      toolCallId: params.toolCall.id,
      toolName: params.toolCall.name,
      argumentsText: params.toolCall.arguments,
      resultText: params.result,
      transportState: params.transportState,
      resultIsError: params.resultIsError,
      terminalEffectState: params.terminalEffectState,
      runId: params.lifecycle.agentRunId,
      recordedAt: params.recordedAt,
    });
    params.toolCall.effectReceipts = appendToolEffectReceipt(
      params.toolCall.effectReceipts,
      receipt,
      { toolCallId: params.toolCall.id, toolName: params.toolCall.name },
    );
  } catch {
    // Receipt creation is fail-closed: absence remains unknown and never becomes success evidence.
    return undefined;
  }

  // Experience collection is ancillary. A hashing or storage failure must not
  // erase the authoritative receipt or alter the primary tool outcome.
  void recordVerifiedToolEffectExperience({
    memoryConversationId: params.lifecycle.memoryConversationId,
    sourceThreadId: params.lifecycle.conversationId,
    sourceRunId: params.lifecycle.agentRunId,
    toolCallId: params.toolCall.id,
    toolName: params.toolCall.name,
    receipt,
  }).catch(() => {
    // The producer is fail-closed internally; this guard preserves completion
    // if an unexpected implementation error escapes that boundary.
  });
  return receipt;
}

export type {
  ToolExecutionLifecycleCallbacks,
  ToolExecutionLifecycleIdPrefixes,
  ToolExecutionLifecycleMetricsRecorder,
  ToolExecutionLifecycleParams,
  ToolExecutionLifecycleResult,
} from './toolCallLifecycleTypes';

export async function executeToolCallLifecycle(
  params: ToolExecutionLifecycleParams,
): Promise<ToolExecutionLifecycleResult> {
  const effectiveToolCall = {
    ...params.tc,
    name: resolveRegisteredToolName(params.tc.name),
  };
  const preflightResult = resolveToolCallPreflight(params, effectiveToolCall);
  if (preflightResult) {
    return preflightResult;
  }

  const toolCall = createRunningToolCall(effectiveToolCall);
  params.callbacks.onToolCallStart(toolCall);
  await yieldToUiFrame();

  if (params.signal?.signal.aborted) {
    const cancellationMessage = 'Error: Request cancelled';
    const completedAt = Date.now();
    failRunningToolCall(toolCall, 'Request cancelled', completedAt);
    const effectReceipt = await appendExecutionReceipt({
      lifecycle: params,
      toolCall,
      result: cancellationMessage,
      transportState: 'rejected',
      resultIsError: true,
      terminalEffectState: 'cancelled',
      recordedAt: completedAt,
    });
    params.callbacks.onToolCallComplete(toolCall);
    return {
      toolCallId: effectiveToolCall.id,
      effectiveToolName: effectiveToolCall.name,
      toolMessage: buildToolResultMessage({
        idPrefix: params.idPrefixes.cancelled,
        toolCallId: effectiveToolCall.id,
        content: cancellationMessage,
        toolCall,
        isError: true,
      }),
      result: cancellationMessage,
      ...(effectReceipt ? { effectReceipt } : {}),
    };
  }

  await emitAgentEvent('tool_start', {
    conversationId: params.conversationId,
    toolName: effectiveToolCall.name,
    iteration: params.iteration,
  });
  const toolExecutionStartedAt = Date.now();

  try {
    let result = await executeTool(
      effectiveToolCall.name,
      effectiveToolCall.arguments,
      params.conversationId,
      {
        provider: params.provider,
        allProviders: params.allProviders,
        model: params.model,
        memoryConversationId: params.memoryConversationId,
        workspaceConversationId: params.workspaceConversationId,
        workspaceReadFallbackConversationId: params.workspaceReadFallbackConversationId,
        availableToolNames: Array.from(params.availableToolNames),
        controlGraphGoals: params.controlGraphGoals,
        agentRunId: params.agentRunId,
      },
    );
    if (!isToolResultErrorLike(result)) {
      const durability = await observeExternalToolResultDurability({
        toolName: effectiveToolCall.name,
        toolCallId: effectiveToolCall.id,
        argumentsText: effectiveToolCall.arguments,
        resultText: result,
        conversationId: params.conversationId,
        parentAgentRunId: params.agentRunId,
        observedAt: Date.now(),
      });
      if (durability.kind === 'untracked_external' || durability.kind === 'persistence_failed') {
        result = buildUntrackedExternalToolResult(durability);
      } else if (
        durability.kind === 'persisted' &&
        (durability.scheduling.kind === 'blocked' || durability.scheduling.kind === 'deferred')
      ) {
        console.warn(
          `[durability] External workflow ${durability.observation.runId} persisted but immediate scheduling ${durability.scheduling.kind}`,
        );
      }
    }
    const spillConversationId = params.workspaceConversationId ?? params.conversationId;
    const spilled = await maybeSpillToolOutput({
      result,
      conversationId: spillConversationId,
      toolName: effectiveToolCall.name,
    });
    result = spilled.payload;
    result = enrichToolResultWithSchemaRepair({
      result,
      toolName: effectiveToolCall.name,
      tools: params.groundedRequestScopedTools,
    });
    const effectiveBudgetWindow =
      params.toolResultContextWindow ?? getWorkingContextWindow(params.model);
    result = enforceToolResultBudget(result, effectiveBudgetWindow);
    applyTrackedAsyncToolResult(
      params.trackedAsyncOperations,
      effectiveToolCall.name,
      effectiveToolCall.arguments,
      result,
    );
    params.onPendingAsyncOperationsChange?.();

    const toolResultIsError = isToolResultErrorLike(result);
    const completedAt = Date.now();
    completeRunningToolCall(
      toolCall,
      result,
      toolResultIsError,
      completedAt,
      toolResultIsError ? 'tool_error' : undefined,
    );
    const effectReceipt = await appendExecutionReceipt({
      lifecycle: params,
      toolCall,
      result,
      transportState: 'returned',
      resultIsError: toolResultIsError,
      recordedAt: completedAt,
    });
    params.callbacks.onToolCallComplete(toolCall);
    await emitAgentEvent('tool_end', {
      conversationId: params.conversationId,
      toolName: effectiveToolCall.name,
      iteration: params.iteration,
    });
    recordLifecyclePerformanceMetrics({
      enabled: params.usePerformanceMetrics,
      recorder: params.onRecordPerformanceMetrics,
      startedAt: toolExecutionStartedAt,
      reason: 'tool_execution_completed',
    });

    recordLifecycleToolCall(
      params.toolCallHistory,
      effectiveToolCall.id,
      effectiveToolCall.name,
      effectiveToolCall.arguments,
      result,
    );

    return {
      toolCallId: effectiveToolCall.id,
      effectiveToolName: effectiveToolCall.name,
      toolMessage: buildToolResultMessage({
        idPrefix: params.idPrefixes.success,
        toolCallId: effectiveToolCall.id,
        content: result,
        toolCall,
        isError: toolResultIsError,
      }),
      result,
      ...(effectReceipt ? { effectReceipt } : {}),
    };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const completedAt = Date.now();
    failRunningToolCall(toolCall, errMsg, completedAt, 'runtime_error');
    const errorResult = `Error: ${errMsg}`;
    const effectReceipt = await appendExecutionReceipt({
      lifecycle: params,
      toolCall,
      result: errorResult,
      transportState: 'threw',
      resultIsError: true,
      recordedAt: completedAt,
    });
    params.callbacks.onToolCallComplete(toolCall);
    recordLifecyclePerformanceMetrics({
      enabled: params.usePerformanceMetrics,
      recorder: params.onRecordPerformanceMetrics,
      startedAt: toolExecutionStartedAt,
      reason: 'tool_execution_failed',
    });

    applyTrackedAsyncToolResult(
      params.trackedAsyncOperations,
      effectiveToolCall.name,
      effectiveToolCall.arguments,
      errorResult,
    );
    params.onPendingAsyncOperationsChange?.();
    recordLifecycleToolCall(
      params.toolCallHistory,
      effectiveToolCall.id,
      effectiveToolCall.name,
      effectiveToolCall.arguments,
      errorResult,
    );

    return {
      toolCallId: effectiveToolCall.id,
      effectiveToolName: effectiveToolCall.name,
      toolMessage: buildToolResultMessage({
        idPrefix: params.idPrefixes.error,
        toolCallId: effectiveToolCall.id,
        content: errorResult,
        toolCall,
        isError: true,
      }),
      result: errorResult,
      ...(effectReceipt ? { effectReceipt } : {}),
    };
  }
}
