import type { AgentGoal } from '../../types/agentRun';
import type { LlmProviderConfig } from '../../types/provider';
import type { Message, ToolCall } from '../../types/message';
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
import { normalizeToolName, resolveRegisteredToolName } from '../tools/toolNameNormalization';
import { GOAL_BOOTSTRAP_TOOL_NAME } from '../goals/bootstrap';
import {
  buildEffectCompletionContractBlock,
  buildGoalMutationBoundaryBlock,
  findGoalForEffectCompletionRequirement,
  resolveToolEffectCompletionRequirement,
} from '../toolExecution/toolEffectCompletionContract';
import type { AgentControlPerformance } from './agentControlGraph';
import type { PendingAgentToolCall } from './modelTurnExecutionTypes';
import { parseAgentControlGraphSessionsYieldResult } from './sessionsYield';
import { shouldExecuteToolBatchInParallel } from './toolBatchExecutionPolicy';
import type { ToolExecutionOutcome } from './toolExecutionOutcomeResolution';
import type { CodeOwnedCurrentUserMessage } from '../tools/toolExecutionContext';
import type { VerifiedProcedureExecutionSession } from '../../services/memory/verifiedProcedure/executionSession';
import {
  assertModelTurnMemoryPolicyBindingDurablyCurrent,
  type ModelTurnMemoryPolicyBinding,
} from '../authority/modelTurnMemoryPolicyBinding';
import {
  bindCurrentTurnToolObservedMemoryEvidence,
  collectCurrentRunCompletedToolResults,
} from '../../services/memory/toolObservedMemoryEvidence';
import { MOBILE_UI_ACTION_TOOL_NAME } from '../mobileController/contracts';

const MOBILE_CONTROLLER_ISOLATED_TURN_BLOCK =
  'Blocked: mobile_ui_action must be the only tool call in its model turn because the external action suspends execution and changes the current observation.';

export async function executeAgentControlGraphToolBatch(params: {
  executableToolCalls: ReadonlyArray<PendingAgentToolCall>;
  memoryPolicyBinding: ModelTurnMemoryPolicyBinding;
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
  memoryEvidenceToolDefinitions?: ReadonlyArray<ToolDefinition>;
  workingMessages?: ReadonlyArray<Message>;
  completedWorkflowToolNames: Set<string>;
  emitPendingAsyncOperationsChange?: () => void;
  recordPerformanceMetrics: (metrics: Partial<AgentControlPerformance>, bucket: string) => void;
  controlGraphGoals?: ReadonlyArray<AgentGoal>;
  agentRunId?: string;
  executionRunId: string;
  beforeEffectDispatch?: (toolName: string) => Promise<void>;
  verifiedProcedureSession?: VerifiedProcedureExecutionSession;
  onBatchCommitted: () => void;
}): Promise<ToolExecutionOutcome[]> {
  assertModelTurnMemoryPolicyBindingDurablyCurrent(params.memoryPolicyBinding);
  const groundedToolNames = new Set(
    params.groundedRequestScopedTools.map((tool) => normalizeToolName(tool.name)).filter(Boolean),
  );
  const isToolAllowedByGroundedSurface = (toolName: string): boolean =>
    groundedToolNames.has(normalizeToolName(toolName));
  const executionToolFilter = (toolName: string): boolean =>
    isToolAllowedByGroundedSurface(toolName) &&
    (params.toolFilter ? params.toolFilter(toolName) : true);
  const hasGoalMutation = params.executableToolCalls.some(
    (toolCall) => normalizeToolName(toolCall.name) === GOAL_BOOTSTRAP_TOOL_NAME,
  );
  const toolEvidenceWorkingMessages = [...(params.workingMessages ?? [])];
  const completionRequirements = await Promise.all(
    params.executableToolCalls.map((toolCall) =>
      resolveToolEffectCompletionRequirement({
        toolName: toolCall.name,
        argumentsText: toolCall.arguments,
      }),
    ),
  );
  const workflowBlockerByCallId = new Map<string, string>();
  const hasMixedMobileControllerBoundary =
    params.executableToolCalls.length > 1 &&
    params.executableToolCalls.some(
      (toolCall) => resolveRegisteredToolName(toolCall.name) === MOBILE_UI_ACTION_TOOL_NAME,
    );
  for (const [index, toolCall] of params.executableToolCalls.entries()) {
    if (hasMixedMobileControllerBoundary) {
      workflowBlockerByCallId.set(toolCall.id, MOBILE_CONTROLLER_ISOLATED_TURN_BLOCK);
      continue;
    }
    const requirement = completionRequirements[index];
    if (!requirement || requirement.kind === 'effect_free') {
      continue;
    }
    if (
      hasGoalMutation &&
      (requirement.kind === 'effectful' || requirement.kind === 'operational')
    ) {
      workflowBlockerByCallId.set(
        toolCall.id,
        buildGoalMutationBoundaryBlock(requirement.toolName),
      );
      continue;
    }
    if (requirement.kind === 'operational') {
      continue;
    }
    if (
      requirement.kind === 'effectful' &&
      findGoalForEffectCompletionRequirement(params.controlGraphGoals, requirement)
    ) {
      continue;
    }
    workflowBlockerByCallId.set(toolCall.id, buildEffectCompletionContractBlock(requirement));
  }

  const executePendingToolCall = async (
    toolCall: PendingAgentToolCall,
    _index: number,
    _context: { previewCompletedToolNames: ReadonlySet<string> },
  ): Promise<ToolExecutionOutcome> => {
    const toolObservedMemoryEvidence = params.currentUserMessage
      ? bindCurrentTurnToolObservedMemoryEvidence({
          executionRunId: params.executionRunId,
          currentUserMessageId: params.currentUserMessage.id,
          workingMessages: toolEvidenceWorkingMessages,
          executedToolDefinitions:
            params.memoryEvidenceToolDefinitions ?? params.groundedRequestScopedTools,
          currentRunCompletedToolResults: collectCurrentRunCompletedToolResults({
            executionRunId: params.executionRunId,
            workingMessages: toolEvidenceWorkingMessages,
            toolCallHistory: params.toolCallHistory,
          }),
        })
      : [];
    const outcome = await executeToolCallLifecycle({
      tc: toolCall,
      iteration: params.iteration,
      batchIndex: _index,
      conversationId: params.conversationId,
      provider: params.activeProvider,
      allProviders: params.allProviders,
      model: params.activeModel,
      currentUserMessage: params.currentUserMessage,
      toolObservedMemoryEvidence,
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
      controlGraphGoals: params.controlGraphGoals,
      agentRunId: params.agentRunId,
      executionRunId: params.executionRunId,
      modelTurnMemoryPolicyBinding: params.memoryPolicyBinding,
      beforeEffectDispatch: params.beforeEffectDispatch,
      verifiedProcedureSession: params.verifiedProcedureSession,
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
    if (!executeBatchInParallel) {
      toolEvidenceWorkingMessages.push(outcome.toolMessage);
    }
    return resolvedOutcome;
  };

  const executeBatchInParallel = shouldExecuteToolBatchInParallel(
    params.executableToolCalls,
    params.controlGraphGoals,
    params.groundedRequestScopedTools,
  );
  assertModelTurnMemoryPolicyBindingDurablyCurrent(params.memoryPolicyBinding);
  await params.verifiedProcedureSession?.observePlannedBatch({
    iteration: params.iteration,
    executeInParallel: executeBatchInParallel,
    memoryPolicyBinding: params.memoryPolicyBinding,
    toolCalls: params.executableToolCalls.map((toolCall, batchIndex) => ({
      batchIndex,
      toolCallId: toolCall.id,
      toolName: resolveRegisteredToolName(toolCall.name),
    })),
  });
  assertModelTurnMemoryPolicyBindingDurablyCurrent(params.memoryPolicyBinding);
  params.onBatchCommitted();
  assertModelTurnMemoryPolicyBindingDurablyCurrent(params.memoryPolicyBinding);

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
      const loopCheck = detectLoops(params.toolCallHistory, [], {
        goals: params.controlGraphGoals,
      });
      return loopCheck.loopDetected && loopCheck.level === 'critical';
    },
    buildSkippedExecutionOutcome: (toolCall, index, reason) => ({
      index,
      toolCallId: toolCall.id,
      toolMessage: {
        id: `msg_${Date.now()}_tool_skipped_${index}_${toolCall.id}`,
        role: 'tool' as const,
        content: `Blocked: Tool execution skipped because the graph detected ${reason}.`,
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
    getYieldedMessage: (outcome) =>
      'toolMessage' in outcome ? outcome.yieldedMessage : undefined,
    shouldSuspendAfterOutcome: (outcome) => 'deferredHandoff' in outcome,
    initialCompletedToolNames: params.completedWorkflowToolNames,
  });
}
