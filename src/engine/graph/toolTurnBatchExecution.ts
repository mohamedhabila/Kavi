import type { LlmProviderConfig } from '../../types/provider';
import type { ToolCall } from '../../types/message';
import type { ToolDefinition } from '../../types/tool';

import { detectLoops, type ToolCallRecord } from '../loopDetection';
import type { TrackedAsyncOperation } from '../pendingAsyncOperations';
import {
  executeToolCallLifecycle,
  isDeferredToolExecutionLifecycleResult,
  type ToolExecutionLifecycleMetricsRecorder,
} from '../toolExecution/toolCallLifecycle';
import { executeToolExecutionBatch } from '../toolExecution/toolExecutionBatch';
import type { RuntimeToolAvailabilityContext } from '../tools/runtimeAvailability';
import { resolveRegisteredToolName } from '../tools/toolNameNormalization';
import {
  buildUnsupportedEffectContractBlock,
  resolveUnsupportedEffectContract,
} from '../toolExecution/toolEffectCompletionContract';
import type { AgentControlPerformance } from './agentControlGraph';
import type { PendingAgentToolCall } from './modelTurnExecutionTypes';
import { parseAgentControlGraphSessionsYieldResult } from './sessionsYield';
import { shouldExecuteToolBatchInParallel } from './toolBatchExecutionPolicy';
import type { ToolExecutionOutcome } from './toolExecutionOutcomeResolution';
import type { CodeOwnedCurrentUserMessage } from '../tools/toolExecutionContext';
import { MOBILE_UI_ACTION_TOOL_NAME } from '../mobileController/contracts';
import type { MobileControllerExecutionBinding } from '../mobileController/runtimeBinding';

const MOBILE_CONTROLLER_ISOLATED_TURN_BLOCK =
  'Blocked: mobile_ui_action must be the only tool call in its model turn because the external action suspends execution and changes the current observation.';

/**
 * Why a call in this batch never ran, phrased so the next turn knows what to do.
 *
 * A suspended batch is not a rejection: the call was simply behind one that yielded, and
 * reissuing it is the correct move. Reporting it with the loop-detection wording told the
 * model the opposite — that something about the call itself was wrong — so the message is
 * chosen from the reason rather than shared.
 */
function describeSkippedToolExecution(reason: string): string {
  if (reason === 'batch_suspended') {
    return (
      'Not run: an earlier tool call in this batch suspended the turn before this one ' +
      'started. Nothing about this call was rejected — issue it again if you still need it.'
    );
  }
  return `Blocked: Tool execution skipped because the graph detected ${reason}.`;
}

export async function executeAgentControlGraphToolBatch(params: {
  executableToolCalls: ReadonlyArray<PendingAgentToolCall>;
  iteration: number;
  conversationId: string;
  activeProvider: LlmProviderConfig;
  allProviders?: LlmProviderConfig[];
  activeModel: string;
  currentUserMessage?: CodeOwnedCurrentUserMessage;
  memoryConversationId: string;
  workspaceConversationId?: string;
  workspaceReadFallbackConversationId?: string;
  availableToolNames: ReadonlySet<string>;
  catalogVisibleToolNames?: ReadonlySet<string>;
  runtimeToolAvailability: RuntimeToolAvailabilityContext;
  toolCallHistory: ToolCallRecord[];
  trackedAsyncOperations: Map<string, TrackedAsyncOperation>;
  signal?: AbortController;
  callbacks: {
    onToolCallStart: (toolCall: ToolCall) => void;
    onToolCallComplete: (toolCall: ToolCall) => void;
  };
  toolFilter?: (toolName: string) => boolean;
  pendingAsyncMonitorToolNames: ReadonlySet<string>;
  groundedRequestScopedTools: ToolDefinition[];
  completedWorkflowToolNames: Set<string>;
  emitPendingAsyncOperationsChange?: () => void;
  recordPerformanceMetrics: (metrics: Partial<AgentControlPerformance>, bucket: string) => void;
  activeTaskId?: string;
  toolCallBlockers?: ReadonlyMap<string, string>;
  agentRunId?: string;
  executionRunId: string;
  beforeEffectDispatch?: (toolName: string) => Promise<void>;
  mobileController?: MobileControllerExecutionBinding;
  onBatchCommitted: () => void;
}): Promise<ToolExecutionOutcome[]> {
  /**
   * Execution is filtered by permission alone, never by what this turn advertised.
   *
   * This filter used to AND the grounded surface into the run allowlist, which made the
   * advertised list an enforcement boundary at the point of dispatch — the same
   * over-planning the preflight now rejects, and the place it was actually applied. A
   * capability the run holds stayed unreachable whenever the previous turn had not
   * predicted the need for it, and the model was told to fix that with a `tool_catalog`
   * round-trip it should never have had to make.
   */
  const executionToolFilter = (toolName: string): boolean =>
    params.toolFilter ? params.toolFilter(toolName) : true;
  const unsupportedEffectContracts = params.executableToolCalls.map((toolCall) =>
    resolveUnsupportedEffectContract({
      toolName: toolCall.name,
      argumentsText: toolCall.arguments,
    }),
  );
  const workflowBlockerByCallId = new Map<string, string>();
  const hasMixedMobileControllerBoundary =
    params.executableToolCalls.length > 1 &&
    params.executableToolCalls.some(
      (toolCall) => resolveRegisteredToolName(toolCall.name) === MOBILE_UI_ACTION_TOOL_NAME,
    );
  for (const [index, toolCall] of params.executableToolCalls.entries()) {
    const policyBlocker = params.toolCallBlockers?.get(toolCall.id);
    if (policyBlocker) {
      workflowBlockerByCallId.set(toolCall.id, policyBlocker);
      continue;
    }
    if (hasMixedMobileControllerBoundary) {
      workflowBlockerByCallId.set(toolCall.id, MOBILE_CONTROLLER_ISOLATED_TURN_BLOCK);
      continue;
    }
    const unsupportedEffectContract = unsupportedEffectContracts[index];
    if (unsupportedEffectContract) {
      workflowBlockerByCallId.set(
        toolCall.id,
        buildUnsupportedEffectContractBlock(unsupportedEffectContract),
      );
    }
  }

  const executePendingToolCall = async (
    toolCall: PendingAgentToolCall,
    _index: number,
    _context: { previewCompletedToolNames: ReadonlySet<string> },
  ): Promise<ToolExecutionOutcome> => {
    const outcome = await executeToolCallLifecycle({
      tc: toolCall,
      iteration: params.iteration,
      batchIndex: _index,
      conversationId: params.conversationId,
      provider: params.activeProvider,
      allProviders: params.allProviders,
      model: params.activeModel,
      currentUserMessage: params.currentUserMessage,
      memoryConversationId: params.memoryConversationId,
      workspaceConversationId: params.workspaceConversationId,
      workspaceReadFallbackConversationId: params.workspaceReadFallbackConversationId,
      availableToolNames: params.availableToolNames,
      catalogVisibleToolNames: params.catalogVisibleToolNames,
      runtimeToolAvailability: params.runtimeToolAvailability,
      toolCallHistory: params.toolCallHistory,
      groundedRequestScopedTools: params.groundedRequestScopedTools,
      trackedAsyncOperations: params.trackedAsyncOperations,
      signal: params.signal,
      callbacks: {
        onToolCallStart: params.callbacks.onToolCallStart,
        onToolCallComplete: params.callbacks.onToolCallComplete,
      },
      workflowToolCallBlocker: () => workflowBlockerByCallId.get(toolCall.id),
      toolFilter: executionToolFilter,
      pendingAsyncMonitorToolNames: params.pendingAsyncMonitorToolNames,
      usePerformanceMetrics: true,
      onPendingAsyncOperationsChange: params.emitPendingAsyncOperationsChange,
      onRecordPerformanceMetrics:
        params.recordPerformanceMetrics as ToolExecutionLifecycleMetricsRecorder,
      activeTaskId: params.activeTaskId,
      agentRunId: params.agentRunId,
      executionRunId: params.executionRunId,
      beforeEffectDispatch: params.beforeEffectDispatch,
      ...(params.mobileController ? { mobileController: params.mobileController } : {}),
      idPrefixes: {
        blocked: 'tool_blocked',
        filtered: 'tool_filtered',
        workflow: 'tool_workflow_guard',
        cancelled: 'tool_error',
        success: 'tool',
        error: 'tool_error',
      },
    });
    if (isDeferredToolExecutionLifecycleResult(outcome)) {
      return {
        index: _index,
        toolCallId: toolCall.id,
        deferredHandoff: outcome.deferredHandoff,
        effectDispatchObservation: outcome.effectDispatchObservation,
      };
    }
    const yieldResult = outcome.result
      ? parseAgentControlGraphSessionsYieldResult(outcome.effectiveToolName, outcome.result)
      : { yielded: false };
    const resolvedOutcome: ToolExecutionOutcome = {
      index: _index,
      toolCallId: toolCall.id,
      toolMessage: outcome.toolMessage,
      effectReceipt: outcome.effectReceipt,
      effectReconciliationRequired: outcome.effectReconciliationRequired,
      effectDispatchObservation: outcome.effectDispatchObservation,
      yieldedMessage: yieldResult.yielded
        ? yieldResult.message || 'Waiting for background agent results.'
        : undefined,
      forceFinalText: yieldResult.forceFinalText,
      yieldCompletionNoteMessage: yieldResult.message,
    };
    return resolvedOutcome;
  };

  const executeBatchInParallel = shouldExecuteToolBatchInParallel(
    params.executableToolCalls,
    params.groundedRequestScopedTools,
  );
  params.onBatchCommitted();

  return executeToolExecutionBatch({
    executableToolCalls: params.executableToolCalls,
    executeBatchInParallel,
    executePendingToolCall: (toolCall, index, context) =>
      executePendingToolCall(toolCall, index, context),
    getCompletedToolName: (outcome) =>
      'toolMessage' in outcome
        ? outcome.toolMessage.toolCalls?.[0]?.name?.trim() || undefined
        : undefined,
    buildUnexpectedExecutionFailureOutcome: (toolCall, index, error) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        index,
        toolCallId: toolCall.id,
        toolMessage: {
          id: `msg_${Date.now()}_tool_rejected_${index}_${toolCall.id}`,
          role: 'tool' as const,
          content: `Error: Unexpected failure during parallel execution — ${errorMessage}`,
          toolCallId: toolCall.id,
          toolCalls: [
            {
              id: toolCall.id,
              name: toolCall.name,
              arguments: toolCall.arguments,
              status: 'failed' as const,
              error: errorMessage,
            },
          ],
          timestamp: Date.now(),
          isError: true,
        },
      };
    },
    shouldStopAfterOutcome: () => {
      const loopCheck = detectLoops(params.toolCallHistory);
      return loopCheck.loopDetected && loopCheck.level === 'critical';
    },
    buildSkippedExecutionOutcome: (toolCall, index, reason) => ({
      index,
      toolCallId: toolCall.id,
      toolMessage: {
        id: `msg_${Date.now()}_tool_skipped_${index}_${toolCall.id}`,
        role: 'tool' as const,
        content: describeSkippedToolExecution(reason),
        toolCallId: toolCall.id,
        toolCalls: [
          {
            id: toolCall.id,
            name: toolCall.name,
            arguments: toolCall.arguments,
            status: 'failed' as const,
            error: reason,
          },
        ],
        timestamp: Date.now(),
        isError: true,
      },
    }),
    getYieldedMessage: (outcome) => ('toolMessage' in outcome ? outcome.yieldedMessage : undefined),
    shouldSuspendAfterOutcome: (outcome) => 'deferredHandoff' in outcome,
    initialCompletedToolNames: params.completedWorkflowToolNames,
  });
}
