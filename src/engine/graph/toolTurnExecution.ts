import type { LivingMemoryBridgeOutput } from '../../services/memory/livingMemoryBridge';
import type { AgentRunControlGraphState } from '../../types/agentRun';
import type {
  AssistantCompletionMetadata,
  AssistantMessageMetadata,
  Message,
  MessageProviderReplay,
  ToolCall,
} from '../../types/message';
import type { LlmProviderConfig } from '../../types/provider';
import type { OrchestratorState } from '../../types/conversation';
import type { ToolDefinition } from '../../types/tool';
import { buildAssistantMessageMetadata } from '../../utils/assistantMessageMetadata';
import {
  buildGoalProgressFingerprint,
  buildToolMultisetKey,
  recordIterationProgressSignature,
  type IterationProgressSignature,
  type ToolCallRecord,
} from '../loopDetection';
import { getActiveGoalId } from '../goals/types';
import type { OrchestratorCompactionEvent } from '../orchestratorCompaction';
import { type TrackedAsyncOperation } from '../pendingAsyncOperations';
import type { RuntimeToolAvailabilityContext } from '../tools/runtimeAvailability';
import type { AgentTurnCompactionEngine } from './agentTurnRequestBudget';
import type {
  AgentControlGraphEvent,
  AgentControlPerformance,
  AgentControlTurnDirectives,
} from './agentControlGraph';
import type { PendingAgentToolCall } from './modelTurnExecutionTypes';
import { resolveAgentControlGraphToolExecutionOutcomes } from './toolExecutionOutcomeResolution';
import { executeAgentControlGraphToolBatch } from './toolTurnBatchExecution';
import { prepareAgentControlGraphToolTurn } from './toolTurnPreparation';
import {
  buildGraphObservabilityRecordedEvent,
  buildToolBatchIncompleteObservabilityDetail,
  GRAPH_OBSERVABILITY_AUDIT_TYPES,
} from './graphObservability';
import type { AgentControlGraphWorkflowToolResultProgress } from './workflowToolResultProgress';

type TerminalGraphEvent = Extract<
  AgentControlGraphEvent,
  { type: 'BLOCKED' } | { type: 'FINALIZED' } | { type: 'YIELDED' }
>;

type ToolTurnCallbacks = {
  onAssistantMessage: (
    content: string,
    toolCalls?: ToolCall[],
    providerReplay?: MessageProviderReplay,
    assistantCompletion?: AssistantMessageMetadata,
  ) => void;
  onToolCallStart: (toolCall: ToolCall) => void;
  onToolCallComplete: (toolCall: ToolCall) => void;
  onToolMessage: (toolCallId: string, result: string) => void | Promise<void>;
  onStateChange: (state: OrchestratorState) => void;
};

type ToolTurnExecutionResult =
  | {
      status: 'continued';
      lastPendingAsyncSignature: string;
      warningInjectedThisRound: boolean;
      workingMessages: Message[];
    }
  | {
      status: 'finalized';
      lastPendingAsyncSignature: string;
      warningInjectedThisRound: boolean;
      workingMessages: Message[];
    };

export interface ExecuteAgentControlGraphToolTurnParams {
  iteration: number;
  maxToolIterations: number;
  conversationId: string;
  activeProvider: LlmProviderConfig;
  allProviders?: LlmProviderConfig[];
  activeModel: string;
  workspaceConversationId?: string;
  workspaceReadFallbackConversationId?: string;
  availableToolNames: ReadonlySet<string>;
  runtimeToolAvailability: RuntimeToolAvailabilityContext;
  toolCallHistory: ToolCallRecord[];
  stagnationSignatures: IterationProgressSignature[];
  trackedAsyncOperations: Map<string, TrackedAsyncOperation>;
  signal?: AbortController;
  callbacks: ToolTurnCallbacks;
  toolFilter?: (toolName: string) => boolean;
  pendingAsyncMonitorToolNames: ReadonlySet<string>;
  groundedRequestScopedTools: ToolDefinition[];
  getGraphSnapshot: () => AgentRunControlGraphState;
  completedWorkflowToolNames: Set<string>;
  lastPendingAsyncSignature: string;
  contextWindow: number;
  compactionEngine: AgentTurnCompactionEngine;
  livingMemory?: LivingMemoryBridgeOutput | null;
  onCompaction?: (event: OrchestratorCompactionEvent) => void;
  warn: (message: string, error: unknown) => void;
  yieldToUiFrame: () => Promise<void>;
  applyGraphEvents: (events: ReadonlyArray<AgentControlGraphEvent>) => void;
  publishWorkflowToolResultProgress: (params: {
    toolMessage: Message;
    tools: ToolDefinition[];
    reason: string;
  }) => AgentControlGraphWorkflowToolResultProgress;
  syncPendingAsyncOperationsToGraph: () => void;
  recordTurnDirectives: (
    directives: Partial<AgentControlTurnDirectives>,
    reason: string,
  ) => unknown;
  recordPostToolFinalTextDirective: (params: {
    pendingAsyncCount: number;
    hasBackgroundLaunchWithoutWait?: boolean;
    hasAsyncTerminalResolution?: boolean;
    hasActivePersistentGoal?: boolean;
    hasCompletedBlockingGoal?: boolean;
    hasIncompleteBlockingGoal?: boolean;
  }) => boolean;
  getModelTurnBlocker: () => string | undefined;
  finishWithGraphTerminalEvent: (params: {
    graphEvent: TerminalGraphEvent;
    content: string;
    providerReplay?: MessageProviderReplay;
    assistantMetadata: ReturnType<typeof buildAssistantMessageMetadata>;
    sessionEndReason?: string;
  }) => Promise<void>;
  recordPerformanceMetrics: (metrics: Partial<AgentControlPerformance>, bucket: string) => void;
  emitPendingAsyncOperationsChange?: () => void;
  agentRunId?: string;
  warningInjectedThisRound: boolean;
  turnAssistantContent: string;
  reasoning: string;
  providerReplay?: MessageProviderReplay;
  completion?: AssistantCompletionMetadata;
  pendingToolCalls: ReadonlyArray<PendingAgentToolCall>;
  workingMessages: Message[];
}

export async function executeAgentControlGraphToolTurn(
  params: ExecuteAgentControlGraphToolTurnParams,
): Promise<ToolTurnExecutionResult> {
  const toolTurnPreparation = await prepareAgentControlGraphToolTurn({
    iteration: params.iteration,
    maxToolIterations: params.maxToolIterations,
    toolCallHistory: params.toolCallHistory,
    stagnationSignatures: params.stagnationSignatures,
    warningInjectedThisRound: params.warningInjectedThisRound,
    turnAssistantContent: params.turnAssistantContent,
    reasoning: params.reasoning,
    providerReplay: params.providerReplay,
    completion: params.completion,
    pendingToolCalls: params.pendingToolCalls,
    goals: params.getGraphSnapshot().goals,
    workingMessages: params.workingMessages,
    callbacks: {
      onAssistantMessage: params.callbacks.onAssistantMessage,
    },
    yieldToUiFrame: params.yieldToUiFrame,
  });

  if (toolTurnPreparation.status === 'finalized') {
    return {
      status: 'finalized',
      lastPendingAsyncSignature: params.lastPendingAsyncSignature,
      warningInjectedThisRound: toolTurnPreparation.warningInjectedThisRound,
      workingMessages: toolTurnPreparation.workingMessages,
    };
  }

  if (toolTurnPreparation.loopObservabilityDetail) {
    params.applyGraphEvents([
      buildGraphObservabilityRecordedEvent({
        observabilityType: GRAPH_OBSERVABILITY_AUDIT_TYPES.LOOP_DETECTED,
        iteration: params.iteration,
        detail: toolTurnPreparation.loopObservabilityDetail,
      }),
    ]);
  }

  if (toolTurnPreparation.status === 'blocked') {
    params.applyGraphEvents([
      {
        type: 'BLOCKED',
        reason: 'loop_detected',
      },
    ]);
    await params.finishWithGraphTerminalEvent({
      graphEvent: {
        type: 'BLOCKED',
        reason: 'loop_detected',
      },
      content: toolTurnPreparation.blockDetails,
      assistantMetadata: buildAssistantMessageMetadata('final', params.completion),
      sessionEndReason: 'loop_detected',
    });
    return {
      status: 'finalized',
      lastPendingAsyncSignature: params.lastPendingAsyncSignature,
      warningInjectedThisRound: toolTurnPreparation.warningInjectedThisRound,
      workingMessages: toolTurnPreparation.workingMessages,
    };
  }
  const executableToolCalls = toolTurnPreparation.executableToolCalls;
  let workingMessages = toolTurnPreparation.workingMessages;
  const warningInjectedThisRound = toolTurnPreparation.warningInjectedThisRound;

  const toolExecutionOutcomes = await executeAgentControlGraphToolBatch({
    executableToolCalls,
    iteration: params.iteration,
    conversationId: params.conversationId,
    activeProvider: params.activeProvider,
    allProviders: params.allProviders,
    activeModel: params.activeModel,
    workspaceConversationId: params.workspaceConversationId,
    workspaceReadFallbackConversationId: params.workspaceReadFallbackConversationId,
    availableToolNames: params.availableToolNames,
    runtimeToolAvailability: params.runtimeToolAvailability,
    toolCallHistory: params.toolCallHistory,
    trackedAsyncOperations: params.trackedAsyncOperations,
    signal: params.signal,
    callbacks: {
      onToolCallStart: params.callbacks.onToolCallStart,
      onToolCallComplete: params.callbacks.onToolCallComplete,
    },
    toolFilter: params.toolFilter,
    pendingAsyncMonitorToolNames: params.pendingAsyncMonitorToolNames,
    groundedRequestScopedTools: params.groundedRequestScopedTools,
    completedWorkflowToolNames: params.completedWorkflowToolNames,
    emitPendingAsyncOperationsChange: params.emitPendingAsyncOperationsChange,
    recordPerformanceMetrics: params.recordPerformanceMetrics,
    controlGraphGoals: params.getGraphSnapshot?.().goals,
    agentRunId: params.agentRunId,
  });

  const batchYieldedEarly = toolExecutionOutcomes.some((outcome) =>
    Boolean(outcome.yieldedMessage),
  );
  if (
    !batchYieldedEarly &&
    toolExecutionOutcomes.length > 0 &&
    toolExecutionOutcomes.length < executableToolCalls.length
  ) {
    const unsettledToolCalls = executableToolCalls.slice(toolExecutionOutcomes.length);
    params.applyGraphEvents([
      buildGraphObservabilityRecordedEvent({
        observabilityType: GRAPH_OBSERVABILITY_AUDIT_TYPES.TOOL_BATCH_INCOMPLETE,
        iteration: params.iteration,
        detail: buildToolBatchIncompleteObservabilityDetail({
          expectedCount: executableToolCalls.length,
          settledCount: toolExecutionOutcomes.length,
          unsettledToolCallIds: unsettledToolCalls.map((toolCall) => toolCall.id),
        }),
      }),
      {
        type: 'BLOCKED',
        reason: 'tool_batch_incomplete',
      },
    ]);
    await params.finishWithGraphTerminalEvent({
      graphEvent: {
        type: 'BLOCKED',
        reason: 'tool_batch_incomplete',
      },
      content:
        `Tool batch incomplete: settled ${toolExecutionOutcomes.length} of ` +
        `${executableToolCalls.length} executable tool call(s).`,
      assistantMetadata: buildAssistantMessageMetadata('final', params.completion),
      sessionEndReason: 'tool_batch_incomplete',
    });
    return {
      status: 'finalized',
      lastPendingAsyncSignature: params.lastPendingAsyncSignature,
      warningInjectedThisRound,
      workingMessages,
    };
  }

  const toolOutcomeResolution = await resolveAgentControlGraphToolExecutionOutcomes({
    iteration: params.iteration,
    executableToolCalls,
    toolExecutionOutcomes,
    groundedRequestScopedTools: [...params.groundedRequestScopedTools],
    getGraphSnapshot: params.getGraphSnapshot,
    completedWorkflowToolNames: params.completedWorkflowToolNames,
    trackedAsyncOperations: params.trackedAsyncOperations,
    toolCallHistory: params.toolCallHistory,
    pendingAsyncMonitorToolNames: params.pendingAsyncMonitorToolNames,
    lastPendingAsyncSignature: params.lastPendingAsyncSignature,
    contextWindow: params.contextWindow,
    conversationId: params.conversationId,
    compactionEngine: params.compactionEngine,
    livingMemory: params.livingMemory,
    onCompaction: params.onCompaction,
    warn: params.warn,
    onToolMessage: params.callbacks.onToolMessage,
    onStateChange: params.callbacks.onStateChange,
    yieldToUiFrame: params.yieldToUiFrame,
    applyGraphEvents: params.applyGraphEvents,
    publishWorkflowToolResultProgress: params.publishWorkflowToolResultProgress,
    syncPendingAsyncOperationsToGraph: params.syncPendingAsyncOperationsToGraph,
    recordTurnDirectives: params.recordTurnDirectives,
    recordPostToolFinalTextDirective: params.recordPostToolFinalTextDirective,
    getModelTurnBlocker: params.getModelTurnBlocker,
    finishWithGraphTerminalEvent: params.finishWithGraphTerminalEvent,
    workingMessages,
  });

  if (executableToolCalls.length > 0) {
    const goals = params.getGraphSnapshot().goals ?? [];
    recordIterationProgressSignature(params.stagnationSignatures, {
      toolMultisetKey: buildToolMultisetKey(executableToolCalls.map((toolCall) => toolCall.name)),
      goalProgressFingerprint: buildGoalProgressFingerprint(goals),
      activeGoalId: getActiveGoalId(goals),
    });
  }

  return {
    status: toolOutcomeResolution.status,
    lastPendingAsyncSignature: toolOutcomeResolution.lastPendingAsyncSignature,
    warningInjectedThisRound,
    workingMessages: toolOutcomeResolution.workingMessages,
  };
}
