import type { AgentRunControlGraphState } from '../../types/agentRun';
import type {
  AssistantCompletionMetadata,
  AssistantMessageMetadata,
  Message,
  MessageProviderReplay,
  ToolCall,
} from '../../types/message';
import type { LlmProviderConfig } from '../../types/provider';
import { resolveProviderFamily } from '../../services/llm/catalog/providerFamilies';
import type { OrchestratorState } from '../../types/conversation';
import type { ToolDefinition } from '../../types/tool';
import { buildAssistantMessageMetadata } from '../../utils/assistantMessageMetadata';
import {
  countRunEffectReceipts,
  buildIterationSemanticProgressFingerprint,
  buildToolMultisetKey,
  recordIterationProgressSignature,
  type IterationProgressSignature,
  type ToolCallRecord,
} from '../loopDetection';
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
import type { CodeOwnedCurrentUserMessage } from '../tools/toolExecutionContext';
import type { ToolMessageOutcome } from '../toolExecution/toolMessageOutcome';
import type { MobileControllerExecutionBinding } from '../mobileController/runtimeBinding';
import type { PersistedMobileControllerHandoff } from '../../services/executionJournal/mobileControllerHandoffStore';
import { resolveMobileControllerRecoveryPreflight } from './mobileControllerRecoveryPolicy';
import { MOBILE_UI_ACTION_TOOL_NAME } from '../mobileController/contracts';
import { resolveRegisteredToolName } from '../tools/toolNameNormalization';

type TerminalGraphEvent = Extract<
  AgentControlGraphEvent,
  { type: 'BLOCKED' } | { type: 'FINALIZED' } | { type: 'YIELDED' } | { type: 'CANCELLED' }
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
  onToolMessage: (outcome: ToolMessageOutcome) => void | Promise<void>;
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
    }
  | {
      status: 'waiting';
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
  currentUserMessage?: CodeOwnedCurrentUserMessage;
  memoryConversationId: string;
  workspaceConversationId?: string;
  workspaceReadFallbackConversationId?: string;
  availableToolNames: ReadonlySet<string>;
  catalogVisibleToolNames?: ReadonlySet<string>;
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
  }) => boolean;
  getModelTurnBlocker: () => string | undefined;
  finishWithGraphTerminalEvent: (params: {
    graphEvent: TerminalGraphEvent;
    content: string;
    providerReplay?: MessageProviderReplay;
    assistantMetadata: ReturnType<typeof buildAssistantMessageMetadata>;
    sessionEndReason?: string;
  }) => Promise<void>;
  finishWaitingForUserInput: (params: {
    graphEvent: Extract<AgentControlGraphEvent, { type: 'USER_INPUT_REQUIRED' }>;
    content: string;
    assistantMetadata: ReturnType<typeof buildAssistantMessageMetadata>;
    sessionEndReason?: string;
  }) => Promise<void>;
  recordPerformanceMetrics: (metrics: Partial<AgentControlPerformance>, bucket: string) => void;
  emitPendingAsyncOperationsChange?: () => void;
  agentRunId?: string;
  executionRunId: string;
  beforeEffectDispatch?: (toolName: string) => Promise<void>;
  mobileController?: MobileControllerExecutionBinding;
  publishMobileControllerHandoff?: (handoff: PersistedMobileControllerHandoff) => Promise<void>;
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
  const toolTurnPreparation = prepareAgentControlGraphToolTurn({
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
    plan: params.getGraphSnapshot().plan,
    workingMessages: params.workingMessages,
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
    // The loop diagnostic is retained here, on the observability channel, because it
    // is the only place that carries the repeat count and the offending tool. It is
    // deliberately not the terminal content: the conversation gets a plain-language
    // message instead.
    params.applyGraphEvents([
      buildGraphObservabilityRecordedEvent({
        observabilityType: GRAPH_OBSERVABILITY_AUDIT_TYPES.LOOP_DETECTED,
        iteration: params.iteration,
        detail: toolTurnPreparation.blockDetails,
      }),
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
      content: toolTurnPreparation.blockedUserMessage,
      assistantMetadata: buildAssistantMessageMetadata('final', {
        completionStatus: 'complete',
        finishReason: 'loop_detected',
      }),
      sessionEndReason: 'loop_detected',
    });
    return {
      status: 'finalized',
      lastPendingAsyncSignature: params.lastPendingAsyncSignature,
      warningInjectedThisRound: toolTurnPreparation.warningInjectedThisRound,
      workingMessages: toolTurnPreparation.workingMessages,
    };
  }
  const executableToolCalls = params.pendingToolCalls;
  let workingMessages = toolTurnPreparation.workingMessages;
  const warningInjectedThisRound = toolTurnPreparation.warningInjectedThisRound;

  const isMobileControllerTurn =
    executableToolCalls.length === 1 &&
    resolveRegisteredToolName(executableToolCalls[0]!.name) === MOBILE_UI_ACTION_TOOL_NAME;
  const mobileControllerRecoveryDecision = isMobileControllerTurn
    ? resolveMobileControllerRecoveryPreflight({
        toolCall: executableToolCalls[0]!,
        binding: params.mobileController,
        directives: params.getGraphSnapshot().turnDirectives,
      })
    : { kind: 'not_applicable' as const };
  const toolCallBlockers = new Map<string, string>();
  if (mobileControllerRecoveryDecision.kind === 'block') {
    toolCallBlockers.set(executableToolCalls[0]!.id, mobileControllerRecoveryDecision.blocker);
  }

  const toolExecutionOutcomes = await executeAgentControlGraphToolBatch({
    executableToolCalls,
    iteration: params.iteration,
    conversationId: params.conversationId,
    activeProvider: params.activeProvider,
    allProviders: params.allProviders,
    activeModel: params.activeModel,
    currentUserMessage: params.currentUserMessage,
    memoryConversationId: params.memoryConversationId,
    workspaceConversationId: params.workspaceConversationId,
    workspaceReadFallbackConversationId: params.workspaceReadFallbackConversationId,
    availableToolNames: params.availableToolNames,
    catalogVisibleToolNames: params.catalogVisibleToolNames,
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
    activeTaskId: params.getGraphSnapshot().activeTaskId,
    ...(toolCallBlockers.size > 0 ? { toolCallBlockers } : {}),
    agentRunId: params.agentRunId,
    executionRunId: params.executionRunId,
    beforeEffectDispatch: params.beforeEffectDispatch,
    ...(params.mobileController ? { mobileController: params.mobileController } : {}),
    onBatchCommitted: () => {
      if (mobileControllerRecoveryDecision.kind !== 'not_applicable') {
        params.recordTurnDirectives(
          mobileControllerRecoveryDecision.directives,
          mobileControllerRecoveryDecision.reason,
        );
      }
      params.callbacks.onAssistantMessage(
        toolTurnPreparation.assistantToolTurnContent,
        toolTurnPreparation.toolCallObjects,
        params.providerReplay,
        toolTurnPreparation.assistantMetadata,
      );
      const graphEvents: AgentControlGraphEvent[] = [];
      graphEvents.push({
        type: 'MODEL_TURN_COMPLETED',
        iteration: params.iteration,
        toolCalls: executableToolCalls.map((toolCall) => ({
          id: toolCall.id,
          name: toolCall.name,
        })),
      });
      params.applyGraphEvents(graphEvents);
    },
  });

  const batchYieldedEarly = toolExecutionOutcomes.some(
    (outcome) =>
      'deferredHandoff' in outcome ||
      ('yieldedMessage' in outcome && Boolean(outcome.yieldedMessage)),
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
      assistantMetadata: buildAssistantMessageMetadata('final', {
        completionStatus: 'complete',
        finishReason: 'tool_batch_incomplete',
      }),
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
    lastPendingAsyncSignature: params.lastPendingAsyncSignature,
    contextWindow: params.contextWindow,
    conversationId: params.conversationId,
    currentUserMessage: params.currentUserMessage,
    compactionEngine: params.compactionEngine,
    onCompaction: params.onCompaction,
    requestFamily: resolveProviderFamily(params.activeProvider),
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
    finishWaitingForUserInput: params.finishWaitingForUserInput,
    ...(params.publishMobileControllerHandoff
      ? { publishMobileControllerHandoff: params.publishMobileControllerHandoff }
      : {}),
    workingMessages,
  });

  if (executableToolCalls.length > 0 && toolOutcomeResolution.status !== 'waiting') {
    recordIterationProgressSignature(params.stagnationSignatures, {
      toolMultisetKey: buildToolMultisetKey(executableToolCalls.map((toolCall) => toolCall.name)),
      effectReceiptCount: countRunEffectReceipts(
        params.stagnationSignatures,
        toolExecutionOutcomes.map((outcome) =>
          'deferredHandoff' in outcome ? undefined : outcome.effectReceipt,
        ),
      ),
      semanticProgressFingerprint: buildIterationSemanticProgressFingerprint(
        toolExecutionOutcomes.flatMap((outcome) => {
          if ('deferredHandoff' in outcome) return [];
          const toolCall = executableToolCalls[outcome.index];
          if (!toolCall) return [];
          return [
            {
              name: toolCall.name,
              arguments: toolCall.arguments,
              status: outcome.toolMessage.isError === true ? 'failed' : 'completed',
              result: outcome.toolMessage.content,
            } as const,
          ];
        }),
      ),
    });
  }

  return {
    status: toolOutcomeResolution.status,
    lastPendingAsyncSignature: toolOutcomeResolution.lastPendingAsyncSignature,
    warningInjectedThisRound,
    workingMessages: toolOutcomeResolution.workingMessages,
  };
}
