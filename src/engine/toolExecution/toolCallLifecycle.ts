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
import type {
  ToolExecutionLifecycleParams,
  ToolExecutionLifecycleResult,
} from './toolCallLifecycleTypes';

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
    failRunningToolCall(toolCall, 'Request cancelled');
    params.callbacks.onToolCallComplete(toolCall);
    const cancellationMessage = 'Error: Request cancelled';
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
        workspaceConversationId: params.workspaceConversationId,
        workspaceReadFallbackConversationId: params.workspaceReadFallbackConversationId,
        availableToolNames: Array.from(params.availableToolNames),
        controlGraphGoals: params.controlGraphGoals,
        agentRunId: params.agentRunId,
      },
    );
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
    completeRunningToolCall(
      toolCall,
      result,
      toolResultIsError,
      Date.now(),
      toolResultIsError ? 'tool_error' : undefined,
    );
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
    };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    failRunningToolCall(toolCall, errMsg, Date.now(), 'runtime_error');
    params.callbacks.onToolCallComplete(toolCall);
    recordLifecyclePerformanceMetrics({
      enabled: params.usePerformanceMetrics,
      recorder: params.onRecordPerformanceMetrics,
      startedAt: toolExecutionStartedAt,
      reason: 'tool_execution_failed',
    });

    const errorResult = `Error: ${errMsg}`;
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
    };
  }
}
