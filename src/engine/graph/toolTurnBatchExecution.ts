import type { AgentGoal } from '../../types/agentRun';
import type { LlmProviderConfig } from '../../types/provider';
import type { ToolCall } from '../../types/message';
import type { ToolDefinition } from '../../types/tool';

import { detectLoops, type ToolCallRecord } from '../loopDetection';
import type { TrackedAsyncOperation } from '../pendingAsyncOperations';
import {
  executeToolCallLifecycle,
  type ToolExecutionLifecycleMetricsRecorder,
} from '../toolExecution/toolCallLifecycle';
import { executeToolExecutionBatch } from '../toolExecution/toolExecutionBatch';
import type { RuntimeToolAvailabilityContext } from '../tools/runtimeAvailability';
import { normalizeToolName } from '../tools/toolNameNormalization';
import type { AgentControlPerformance } from './agentControlGraph';
import type { PendingAgentToolCall } from './modelTurnExecutionTypes';
import { parseAgentControlGraphSessionsYieldResult } from './sessionsYield';
import { shouldExecuteToolBatchInParallel } from './toolBatchExecutionPolicy';
import type { ToolExecutionOutcome } from './toolExecutionOutcomeResolution';

export async function executeAgentControlGraphToolBatch(params: {
  executableToolCalls: ReadonlyArray<PendingAgentToolCall>;
  iteration: number;
  conversationId: string;
  activeProvider: LlmProviderConfig;
  allProviders?: LlmProviderConfig[];
  activeModel: string;
  workspaceConversationId?: string;
  workspaceReadFallbackConversationId?: string;
  availableToolNames: ReadonlySet<string>;
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
  controlGraphGoals?: ReadonlyArray<AgentGoal>;
  agentRunId?: string;
}): Promise<ToolExecutionOutcome[]> {
  const groundedToolNames = new Set(
    params.groundedRequestScopedTools.map((tool) => normalizeToolName(tool.name)).filter(Boolean),
  );
  const isToolAllowedByGroundedSurface = (toolName: string): boolean =>
    groundedToolNames.has(normalizeToolName(toolName));
  const executionToolFilter = (toolName: string): boolean =>
    isToolAllowedByGroundedSurface(toolName) &&
    (params.toolFilter ? params.toolFilter(toolName) : true);

  const executePendingToolCall = async (
    toolCall: PendingAgentToolCall,
    _index: number,
    _context: { previewCompletedToolNames: ReadonlySet<string> },
  ): Promise<ToolExecutionOutcome> => {
    const outcome = await executeToolCallLifecycle({
      tc: toolCall,
      iteration: params.iteration,
      conversationId: params.conversationId,
      provider: params.activeProvider,
      allProviders: params.allProviders,
      model: params.activeModel,
      workspaceConversationId: params.workspaceConversationId,
      workspaceReadFallbackConversationId: params.workspaceReadFallbackConversationId,
      availableToolNames: params.availableToolNames,
      runtimeToolAvailability: params.runtimeToolAvailability,
      toolCallHistory: params.toolCallHistory,
      groundedRequestScopedTools: params.groundedRequestScopedTools,
      trackedAsyncOperations: params.trackedAsyncOperations,
      signal: params.signal,
      callbacks: {
        onToolCallStart: params.callbacks.onToolCallStart,
        onToolCallComplete: params.callbacks.onToolCallComplete,
      },
      toolFilter: executionToolFilter,
      pendingAsyncMonitorToolNames: params.pendingAsyncMonitorToolNames,
      usePerformanceMetrics: true,
      onPendingAsyncOperationsChange: params.emitPendingAsyncOperationsChange,
      onRecordPerformanceMetrics:
        params.recordPerformanceMetrics as ToolExecutionLifecycleMetricsRecorder,
      controlGraphGoals: params.controlGraphGoals,
      agentRunId: params.agentRunId,
      idPrefixes: {
        blocked: 'tool_blocked',
        filtered: 'tool_filtered',
        workflow: 'tool_workflow_guard',
        cancelled: 'tool_error',
        success: 'tool',
        error: 'tool_error',
      },
    });
    const yieldResult = outcome.result
      ? parseAgentControlGraphSessionsYieldResult(outcome.effectiveToolName, outcome.result)
      : { yielded: false };
    return {
      index: _index,
      toolCallId: toolCall.id,
      toolMessage: outcome.toolMessage,
      yieldedMessage: yieldResult.yielded
        ? yieldResult.message || 'Waiting for background agent results.'
        : undefined,
      forceFinalText: yieldResult.forceFinalText,
      yieldCompletionNoteMessage: yieldResult.message,
    };
  };

  return executeToolExecutionBatch({
    executableToolCalls: params.executableToolCalls,
    executeBatchInParallel: shouldExecuteToolBatchInParallel(
      params.executableToolCalls,
      params.controlGraphGoals,
      params.groundedRequestScopedTools,
    ),
    executePendingToolCall: (toolCall, index, context) =>
      executePendingToolCall(toolCall, index, context),
    getCompletedToolName: (outcome) =>
      outcome.toolMessage.toolCalls?.[0]?.name?.trim() || undefined,
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
    getYieldedMessage: (outcome) => outcome.yieldedMessage,
    initialCompletedToolNames: params.completedWorkflowToolNames,
  });
}
