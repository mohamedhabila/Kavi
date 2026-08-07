import { emitAgentEvent } from '../../services/events/bus';
import { getWorkingContextWindow } from '../../services/context/tokenCounter';
import { executeTool } from '../tools/index';
import { resolveRegisteredToolName } from '../tools/toolNameNormalization';
import { maybeSpillToolOutput } from '../tools/toolOutputSpill';
import { enforceToolResultBudget } from '../toolResultGuard';
import {
  applyTrackedAsyncToolResult,
  getPendingTrackedAsyncOperations,
} from '../pendingAsyncOperations';
import {
  buildToolResultMessage,
  completeRunningToolCall,
  createFailedToolCall,
  createRunningToolCall,
  failRunningToolCall,
} from './toolExecutionMessages';
import {
  recordLifecyclePerformanceMetrics,
  recordLifecycleToolCall,
  yieldToUiFrame,
} from './toolCallLifecycleRecording';
import { resolveToolCallPreflight } from './toolCallLifecyclePreflight';
import { buildRepeatedToolCallNotice } from './repeatedToolCallNotice';
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
import {
  isCodeOwnedEffectFreeInvocation,
  type ToolEffectDispatchObservation,
} from '../../services/executionJournal/toolEffectDispatchLifecycle';
import { failedToolOutcome, type ToolRuntimeOutcome } from '../../types/toolRuntimeOutcome';
import { canSettleAfterModelAuthorityChange } from './modelAuthorityIndependentCompletion';
import {
  buildModelTurnMemoryPolicyExpiredToolResult,
  isModelTurnMemoryPolicyBindingDurablyCurrent,
} from '../authority/modelTurnMemoryPolicyBinding';

function runtimeToolDeclaration(lifecycle: ToolExecutionLifecycleParams, toolName: string) {
  return lifecycle.groundedRequestScopedTools?.find(
    (tool) => resolveRegisteredToolName(tool.name) === toolName,
  );
}

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
      executionRunId: params.lifecycle.executionRunId,
      recordedAt: params.recordedAt,
    });
  } catch {
    // Receipt creation is fail-closed: absence remains unknown and never becomes success evidence.
    return undefined;
  }

  attachExecutionReceipt({ lifecycle: params.lifecycle, toolCall: params.toolCall, receipt });
  return receipt;
}

function attachExecutionReceipt(params: {
  lifecycle: ToolExecutionLifecycleParams;
  toolCall: ToolCall;
  receipt: ToolEffectReceipt;
}): void {
  params.toolCall.effectReceipts = appendToolEffectReceipt(
    params.toolCall.effectReceipts,
    params.receipt,
    { toolCallId: params.toolCall.id, toolName: params.toolCall.name },
  );
}

async function observeVerifiedProcedureRawOutcome(params: {
  lifecycle: ToolExecutionLifecycleParams;
  toolCall: ToolCall;
  resultText: string;
  receipt?: ToolEffectReceipt;
  reconciliationRequired?: boolean;
}): Promise<void> {
  try {
    await params.lifecycle.verifiedProcedureSession?.observeRawOutcome({
      iteration: params.lifecycle.iteration,
      batchIndex: params.lifecycle.batchIndex,
      toolCallId: params.toolCall.id,
      toolName: params.toolCall.name,
      argumentsText: params.toolCall.arguments,
      resultText: params.resultText,
      receipt: params.receipt,
      reconciliationRequired: params.reconciliationRequired,
    });
  } catch {
    params.lifecycle.verifiedProcedureSession?.markReconciliationRequired();
  }
}

async function completeUnstartedMemoryPolicyRevocation(params: {
  lifecycle: ToolExecutionLifecycleParams;
  effectiveToolCall: ToolExecutionLifecycleParams['tc'];
}): Promise<ToolExecutionLifecycleResult> {
  const result = buildModelTurnMemoryPolicyExpiredToolResult();
  const toolCall = createFailedToolCall(
    params.effectiveToolCall,
    result,
    Date.now(),
    'authority_revoked',
  );
  await observeVerifiedProcedureRawOutcome({
    lifecycle: params.lifecycle,
    toolCall,
    resultText: result,
  });
  recordLifecycleToolCall(
    params.lifecycle.toolCallHistory,
    params.effectiveToolCall.id,
    params.effectiveToolCall.name,
    params.effectiveToolCall.arguments,
    result,
    'failed',
    'authority_revoked',
    params.lifecycle.iteration,
  );
  return {
    toolCallId: params.effectiveToolCall.id,
    effectiveToolName: params.effectiveToolCall.name,
    toolMessage: buildToolResultMessage({
      idPrefix: params.lifecycle.idPrefixes.filtered,
      toolCallId: params.effectiveToolCall.id,
      content: result,
      toolCall,
      isError: true,
    }),
    result,
  };
}

export type {
  ToolExecutionLifecycleCallbacks,
  ToolExecutionLifecycleIdPrefixes,
  ToolExecutionLifecycleMetricsRecorder,
  ToolExecutionLifecycleParams,
  ToolExecutionLifecycleResult,
} from './toolCallLifecycleTypes';
export { isDeferredToolExecutionLifecycleResult } from './toolCallLifecycleTypes';

export async function executeToolCallLifecycle(
  params: ToolExecutionLifecycleParams,
): Promise<ToolExecutionLifecycleResult> {
  const effectiveToolCall = {
    ...params.tc,
    name: resolveRegisteredToolName(params.tc.name),
  };
  const effectFreeInvocation = isCodeOwnedEffectFreeInvocation(
    effectiveToolCall.name,
    effectiveToolCall.arguments,
  );
  if (!isModelTurnMemoryPolicyBindingDurablyCurrent(params.modelTurnMemoryPolicyBinding)) {
    return completeUnstartedMemoryPolicyRevocation({
      lifecycle: params,
      effectiveToolCall,
    });
  }
  const preflightResult = resolveToolCallPreflight(params, effectiveToolCall);
  if (preflightResult) {
    if (!isModelTurnMemoryPolicyBindingDurablyCurrent(params.modelTurnMemoryPolicyBinding)) {
      return completeUnstartedMemoryPolicyRevocation({
        lifecycle: params,
        effectiveToolCall,
      });
    }
    return preflightResult;
  }

  const toolCall = createRunningToolCall(effectiveToolCall);
  let toolStartEventEmitted = false;
  const emitBalancedToolEnd = async (): Promise<void> => {
    if (!toolStartEventEmitted) return;
    toolStartEventEmitted = false;
    try {
      await emitAgentEvent('tool_end', {
        conversationId: params.conversationId,
        toolName: effectiveToolCall.name,
        iteration: params.iteration,
        agentRunId: params.agentRunId,
        executionSignal: params.signal,
      });
    } catch {
      // Telemetry is ancillary to the already-settled tool outcome.
    }
  };

  const completeMemoryPolicyRevocation = async (): Promise<ToolExecutionLifecycleResult> => {
    const result = buildModelTurnMemoryPolicyExpiredToolResult();
    const completedAt = Date.now();
    failRunningToolCall(toolCall, result, completedAt, 'authority_revoked');
    params.callbacks.onToolCallComplete(toolCall);
    await observeVerifiedProcedureRawOutcome({
      lifecycle: params,
      toolCall,
      resultText: result,
    });
    recordLifecycleToolCall(
      params.toolCallHistory,
      effectiveToolCall.id,
      effectiveToolCall.name,
      effectiveToolCall.arguments,
      result,
      'failed',
      'authority_revoked',
      params.iteration,
    );
    await emitBalancedToolEnd();
    return {
      toolCallId: effectiveToolCall.id,
      effectiveToolName: effectiveToolCall.name,
      toolMessage: buildToolResultMessage({
        idPrefix: params.idPrefixes.filtered,
        toolCallId: effectiveToolCall.id,
        content: result,
        toolCall,
        isError: true,
      }),
      result,
    };
  };

  if (!isModelTurnMemoryPolicyBindingDurablyCurrent(params.modelTurnMemoryPolicyBinding)) {
    return completeUnstartedMemoryPolicyRevocation({
      lifecycle: params,
      effectiveToolCall,
    });
  }

  params.callbacks.onToolCallStart(toolCall);
  if (!isModelTurnMemoryPolicyBindingDurablyCurrent(params.modelTurnMemoryPolicyBinding)) {
    return completeMemoryPolicyRevocation();
  }
  await yieldToUiFrame();

  const completeCancellation = async (): Promise<ToolExecutionLifecycleResult> => {
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
    await observeVerifiedProcedureRawOutcome({
      lifecycle: params,
      toolCall,
      resultText: cancellationMessage,
      receipt: effectReceipt,
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
  };

  if (params.signal?.signal.aborted) {
    return completeCancellation();
  }

  if (params.beforeEffectDispatch && !effectFreeInvocation) {
    await params.beforeEffectDispatch(effectiveToolCall.name);
    if (params.signal?.signal.aborted) return completeCancellation();
    if (!isModelTurnMemoryPolicyBindingDurablyCurrent(params.modelTurnMemoryPolicyBinding)) {
      return completeMemoryPolicyRevocation();
    }
  }

  await emitAgentEvent('tool_start', {
    conversationId: params.conversationId,
    toolName: effectiveToolCall.name,
    iteration: params.iteration,
    agentRunId: params.agentRunId,
    executionSignal: params.signal,
  });
  toolStartEventEmitted = true;
  if (!isModelTurnMemoryPolicyBindingDurablyCurrent(params.modelTurnMemoryPolicyBinding)) {
    return completeMemoryPolicyRevocation();
  }
  const toolExecutionStartedAt = Date.now();
  let authoritativeEffectReceipt: ToolEffectReceipt | undefined;
  let authoritativeReceiptFinalized = false;
  let effectReconciliationRequired = false;
  let effectDispatchObservation: ToolEffectDispatchObservation | undefined;
  let resolvedEffectFreeInvocation = effectFreeInvocation;

  try {
    const execution = await executeTool(
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
        catalogVisibleToolNames: params.catalogVisibleToolNames
          ? Array.from(params.catalogVisibleToolNames)
          : undefined,
        controlGraphGoals: params.controlGraphGoals,
        agentRunId: params.agentRunId,
        executionRunId: params.executionRunId,
        modelTurnMemoryPolicyBinding: params.modelTurnMemoryPolicyBinding,
        toolCallId: effectiveToolCall.id,
        executionSignal: params.signal?.signal,
        runtimeToolDeclaration: runtimeToolDeclaration(params, effectiveToolCall.name),
        captureEffectReceipt: (receipt) => {
          authoritativeEffectReceipt = receipt;
        },
        finalizeEffectReceiptCapture: () => {
          authoritativeReceiptFinalized = true;
        },
        captureEffectReconciliationRequired: () => {
          effectReconciliationRequired = true;
        },
        currentUserMessage: params.currentUserMessage,
        toolObservedMemoryEvidence: params.toolObservedMemoryEvidence,
        pendingSessionIds: getPendingTrackedAsyncOperations(params.trackedAsyncOperations)
          .filter((operation) => operation.kind === 'session')
          .map((operation) => operation.resourceId),
        ...(params.mobileController ? { mobileController: params.mobileController } : {}),
      },
    );
    effectDispatchObservation = execution.effectDispatchObservation;
    resolvedEffectFreeInvocation =
      effectFreeInvocation || effectDispatchObservation?.kind === 'not_applicable';
    if (execution.status === 'deferred') {
      recordLifecyclePerformanceMetrics({
        enabled: params.usePerformanceMetrics,
        recorder: params.onRecordPerformanceMetrics,
        startedAt: toolExecutionStartedAt,
        reason: 'tool_execution_deferred',
      });
      return {
        toolCallId: effectiveToolCall.id,
        effectiveToolName: effectiveToolCall.name,
        deferredHandoff: execution.deferredHandoff,
        effectDispatchObservation: execution.effectDispatchObservation,
      };
    }
    let outcome: ToolRuntimeOutcome = execution;
    const outcomeRequiresCurrentModelAuthority = (): boolean =>
      (resolvedEffectFreeInvocation &&
        !canSettleAfterModelAuthorityChange(effectiveToolCall.name, outcome)) ||
      (outcome.status === 'failed' && outcome.failureKind === 'authority_revoked');
    if (
      !isModelTurnMemoryPolicyBindingDurablyCurrent(params.modelTurnMemoryPolicyBinding) &&
      outcomeRequiresCurrentModelAuthority()
    ) {
      return completeMemoryPolicyRevocation();
    }
    let result = outcome.content;
    if (authoritativeEffectReceipt) {
      attachExecutionReceipt({
        lifecycle: params,
        toolCall,
        receipt: authoritativeEffectReceipt,
      });
    } else if (!authoritativeReceiptFinalized) {
      authoritativeEffectReceipt = await appendExecutionReceipt({
        lifecycle: params,
        toolCall,
        result,
        transportState: 'returned',
        resultIsError: outcome.status === 'failed',
        recordedAt: Date.now(),
      });
      if (
        outcomeRequiresCurrentModelAuthority() &&
        !isModelTurnMemoryPolicyBindingDurablyCurrent(params.modelTurnMemoryPolicyBinding)
      ) {
        return completeMemoryPolicyRevocation();
      }
    }
    await observeVerifiedProcedureRawOutcome({
      lifecycle: params,
      toolCall,
      resultText: result,
      receipt: authoritativeEffectReceipt,
      reconciliationRequired: effectReconciliationRequired,
    });
    if (
      outcomeRequiresCurrentModelAuthority() &&
      !isModelTurnMemoryPolicyBindingDurablyCurrent(params.modelTurnMemoryPolicyBinding)
    ) {
      return completeMemoryPolicyRevocation();
    }
    if (outcome.status === 'completed') {
      const durability = await observeExternalToolResultDurability({
        toolName: effectiveToolCall.name,
        toolCallId: effectiveToolCall.id,
        argumentsText: effectiveToolCall.arguments,
        resultText: result,
        conversationId: params.conversationId,
        parentAgentRunId: params.agentRunId,
        observedAt: Date.now(),
      });
      if (
        outcomeRequiresCurrentModelAuthority() &&
        !isModelTurnMemoryPolicyBindingDurablyCurrent(params.modelTurnMemoryPolicyBinding)
      ) {
        return completeMemoryPolicyRevocation();
      }
      if (durability.kind === 'untracked_external' || durability.kind === 'persistence_failed') {
        outcome = failedToolOutcome(buildUntrackedExternalToolResult(durability));
        result = outcome.content;
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
    if (
      outcomeRequiresCurrentModelAuthority() &&
      !isModelTurnMemoryPolicyBindingDurablyCurrent(params.modelTurnMemoryPolicyBinding)
    ) {
      return completeMemoryPolicyRevocation();
    }
    result = spilled.payload;
    result = enrichToolResultWithSchemaRepair({
      result,
      toolName: effectiveToolCall.name,
      tools: params.groundedRequestScopedTools,
    });
    const effectiveBudgetWindow =
      params.toolResultContextWindow ?? getWorkingContextWindow(params.model);
    result = enforceToolResultBudget(result, effectiveBudgetWindow);
    if (
      outcomeRequiresCurrentModelAuthority() &&
      !isModelTurnMemoryPolicyBindingDurablyCurrent(params.modelTurnMemoryPolicyBinding)
    ) {
      return completeMemoryPolicyRevocation();
    }
    applyTrackedAsyncToolResult(
      params.trackedAsyncOperations,
      effectiveToolCall.name,
      effectiveToolCall.arguments,
      result,
    );

    const toolResultIsError = outcome.status === 'failed';
    const completedAt = Date.now();
    completeRunningToolCall(
      toolCall,
      result,
      toolResultIsError,
      completedAt,
      toolResultIsError ? 'tool_error' : undefined,
    );
    recordLifecyclePerformanceMetrics({
      enabled: params.usePerformanceMetrics,
      recorder: params.onRecordPerformanceMetrics,
      startedAt: toolExecutionStartedAt,
      reason: 'tool_execution_completed',
    });

    // Computed before this call joins the history, so the ordinal counts prior calls.
    // Only the model-facing message carries the notice: the raw `result` continues to
    // flow to receipts, evidence and the journal unchanged.
    const repeatedCallNotice = buildRepeatedToolCallNotice({
      toolName: effectiveToolCall.name,
      argumentsText: effectiveToolCall.arguments,
      resultText: result,
      history: params.toolCallHistory,
    });

    recordLifecycleToolCall(
      params.toolCallHistory,
      effectiveToolCall.id,
      effectiveToolCall.name,
      effectiveToolCall.arguments,
      result,
      toolResultIsError ? 'failed' : 'completed',
      undefined,
      params.iteration,
    );
    params.onPendingAsyncOperationsChange?.();
    params.callbacks.onToolCallComplete(toolCall);
    await emitBalancedToolEnd();

    return {
      toolCallId: effectiveToolCall.id,
      effectiveToolName: effectiveToolCall.name,
      toolMessage: buildToolResultMessage({
        idPrefix: params.idPrefixes.success,
        toolCallId: effectiveToolCall.id,
        content: repeatedCallNotice ? `${result}\n\n${repeatedCallNotice}` : result,
        toolCall,
        isError: toolResultIsError,
      }),
      result,
      ...(authoritativeEffectReceipt ? { effectReceipt: authoritativeEffectReceipt } : {}),
      ...(effectReconciliationRequired ? { effectReconciliationRequired: true } : {}),
      ...(effectDispatchObservation ? { effectDispatchObservation } : {}),
    };
  } catch (err: unknown) {
    if (
      resolvedEffectFreeInvocation &&
      !isModelTurnMemoryPolicyBindingDurablyCurrent(params.modelTurnMemoryPolicyBinding)
    ) {
      return completeMemoryPolicyRevocation();
    }
    const errMsg = err instanceof Error ? err.message : String(err);
    const completedAt = Date.now();
    const errorResult = `Error: ${errMsg}`;
    if (!authoritativeEffectReceipt && !authoritativeReceiptFinalized) {
      authoritativeEffectReceipt = await appendExecutionReceipt({
        lifecycle: params,
        toolCall,
        result: errorResult,
        transportState: 'threw',
        resultIsError: true,
        recordedAt: completedAt,
      });
      if (
        resolvedEffectFreeInvocation &&
        !isModelTurnMemoryPolicyBindingDurablyCurrent(params.modelTurnMemoryPolicyBinding)
      ) {
        return completeMemoryPolicyRevocation();
      }
    }
    await observeVerifiedProcedureRawOutcome({
      lifecycle: params,
      toolCall,
      resultText: errorResult,
      receipt: authoritativeEffectReceipt,
      reconciliationRequired: effectReconciliationRequired,
    });
    if (
      resolvedEffectFreeInvocation &&
      !isModelTurnMemoryPolicyBindingDurablyCurrent(params.modelTurnMemoryPolicyBinding)
    ) {
      return completeMemoryPolicyRevocation();
    }
    failRunningToolCall(toolCall, errMsg, completedAt, 'runtime_error');
    applyTrackedAsyncToolResult(
      params.trackedAsyncOperations,
      effectiveToolCall.name,
      effectiveToolCall.arguments,
      errorResult,
    );
    recordLifecyclePerformanceMetrics({
      enabled: params.usePerformanceMetrics,
      recorder: params.onRecordPerformanceMetrics,
      startedAt: toolExecutionStartedAt,
      reason: 'tool_execution_failed',
    });
    recordLifecycleToolCall(
      params.toolCallHistory,
      effectiveToolCall.id,
      effectiveToolCall.name,
      effectiveToolCall.arguments,
      errorResult,
      'failed',
      undefined,
      params.iteration,
    );
    params.onPendingAsyncOperationsChange?.();
    params.callbacks.onToolCallComplete(toolCall);
    await emitBalancedToolEnd();

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
      ...(authoritativeEffectReceipt ? { effectReceipt: authoritativeEffectReceipt } : {}),
      ...(effectReconciliationRequired ? { effectReconciliationRequired: true } : {}),
      ...(effectDispatchObservation ? { effectDispatchObservation } : {}),
    };
  }
}
