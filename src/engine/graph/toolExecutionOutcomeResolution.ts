import type { LivingMemoryBridgeOutput } from '../../services/memory/livingMemoryBridge';
import type { AgentRunControlGraphState } from '../../types/agentRun';
import type { Message } from '../../types/message';
import type { ToolEffectReceipt } from '../../types/toolEffectReceipt';
import type { ToolDefinition } from '../../types/tool';
import { buildAssistantMessageMetadata } from '../../utils/assistantMessageMetadata';
import { type TrackedAsyncOperation } from '../pendingAsyncOperations';
import { type OrchestratorCompactionEvent } from '../orchestratorCompaction';
import type { ToolCallRecord } from '../loopDetection';
import { resolveToolEffectPolicy } from '../durability/toolEffectPolicy';
import { type AgentTurnCompactionEngine } from './agentTurnRequestBudget';
import type { AgentControlGraphEvent, AgentControlTurnDirectives } from './agentControlGraph';
import { agentControlGraphToolMessageShowsSuccessfulAsyncTerminalResolution } from './asyncTerminalResolution';
import { finalizeAgentControlGraphToolExecutionOutcomes } from './toolExecutionOutcomePostProcessing';
import type { AgentControlGraphWorkflowToolResultProgress } from './workflowToolResultProgress';
import { normalizeToolName, resolveRegisteredToolName } from '../tools/toolNameNormalization';
import { buildToolGoalEvidenceStrings } from '../goals/toolEvidence';
import { routeToolEvidenceToActiveGoals } from '../goals/evidenceRouting';
import { buildToolEffectReceiptEvidence } from '../goals/effectCompletionEvidence';
import { isBlockingGoal } from '../goals/types';
import { buildDelegationToolTerminalGraphEvents } from './delegationToolTerminalGraphEffects';
import {
  buildDelegationEvidenceAutoCompleteEvent,
  buildEvidenceSatisfiedGoalAutoCompleteEvent,
  findEvidenceSatisfiedGoals,
} from './completionGateGoalAutoComplete';
import {
  DISCOVERY_ACTIVATION_TOOL_NAMES,
  extractActivatedToolNamesFromDiscoveryToolResult,
} from './discoveryToolActivation';
import {
  canonicalizeToolExecutionOutcome,
  type CanonicalToolExecutionOutcome,
} from './toolExecutionOutcomeCanonicalization';
import type { CodeOwnedCurrentUserMessage } from '../tools/toolExecutionContext';
import {
  buildToolMessageOutcome,
  type ToolMessageOutcome,
} from '../toolExecution/toolMessageOutcome';
import {
  parseRequestClarificationToolResult,
  REQUEST_CLARIFICATION_TOOL_NAME,
  type RequestClarificationToolResult,
} from '../../services/agents/requestClarification';
import {
  buildAppliedUnverifiedEffectGoalBlockEvent,
  buildClarificationRequestUnderstanding,
  buildDeferredAfterGraphMutationOutcome,
  buildTerminalFailedEffectGuardRemovalEvent,
  collectCompletedBlockingGoalIds,
  hasNewlyCompletedBlockingGoal,
  updateToolCallHistoryResult,
} from './toolExecutionOutcomeResolutionSupport';
import {
  isTerminalToolEffectDispatchObservation,
  type ToolEffectDispatchObservation,
} from '../../services/executionJournal/toolEffectDispatchLifecycle';
import type { PersistedMobileControllerHandoff } from '../../services/executionJournal/mobileControllerHandoffStore';
import { buildAgentRunMobileControllerAsyncOperation } from '../../services/agents/mobileControllerAsyncOperation';
import { MOBILE_UI_ACTION_TOOL_NAME } from '../mobileController/contracts';
import { didSessionToolStartBackgroundWork } from './sessionBackgroundHandoff';

export interface TerminalToolExecutionOutcome {
  index: number;
  toolCallId: string;
  toolMessage: Message;
  yieldedMessage?: string;
  forceFinalText?: boolean;
  yieldCompletionNoteMessage?: string;
  skipWorkflowProgress?: boolean;
  effectReceipt?: ToolEffectReceipt;
  effectReconciliationRequired?: boolean;
  effectDispatchObservation?: ToolEffectDispatchObservation;
}

export interface DeferredToolExecutionOutcome {
  index: number;
  toolCallId: string;
  deferredHandoff: PersistedMobileControllerHandoff;
  effectDispatchObservation: Extract<ToolEffectDispatchObservation, { kind: 'deferred' }>;
}

export type ToolExecutionOutcome = TerminalToolExecutionOutcome | DeferredToolExecutionOutcome;

export function isDeferredToolExecutionOutcome(
  outcome: ToolExecutionOutcome,
): outcome is DeferredToolExecutionOutcome {
  return 'deferredHandoff' in outcome;
}

export async function resolveAgentControlGraphToolExecutionOutcomes(params: {
  iteration: number;
  executableToolCalls: ReadonlyArray<{ name: string; arguments: string }>;
  toolExecutionOutcomes: ReadonlyArray<ToolExecutionOutcome>;
  groundedRequestScopedTools: ToolDefinition[];
  getGraphSnapshot: () => AgentRunControlGraphState;
  completedWorkflowToolNames: Set<string>;
  trackedAsyncOperations: ReadonlyMap<string, TrackedAsyncOperation>;
  toolCallHistory?: ToolCallRecord[];
  pendingAsyncMonitorToolNames: ReadonlySet<string>;
  lastPendingAsyncSignature: string;
  contextWindow: number;
  conversationId: string;
  currentUserMessage?: CodeOwnedCurrentUserMessage;
  compactionEngine: AgentTurnCompactionEngine;
  livingMemory?: LivingMemoryBridgeOutput | null;
  onCompaction?: (event: OrchestratorCompactionEvent) => void;
  warn: (message: string, error: unknown) => void;
  publishMobileControllerHandoff?: (handoff: PersistedMobileControllerHandoff) => Promise<void>;
  onToolMessage: (outcome: ToolMessageOutcome) => void | Promise<void>;
  onStateChange: (state: 'thinking') => void;
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
    graphEvent: Extract<
      AgentControlGraphEvent,
      { type: 'BLOCKED' } | { type: 'FINALIZED' } | { type: 'YIELDED' } | { type: 'CANCELLED' }
    >;
    content: string;
    assistantMetadata: ReturnType<typeof buildAssistantMessageMetadata>;
    sessionEndReason?: string;
  }) => Promise<void>;
  finishWaitingForUserInput: (params: {
    graphEvent: Extract<AgentControlGraphEvent, { type: 'USER_INPUT_REQUIRED' }>;
    content: string;
    assistantMetadata: ReturnType<typeof buildAssistantMessageMetadata>;
    sessionEndReason?: string;
  }) => Promise<void>;
  workingMessages: Message[];
}): Promise<{
  status: 'continued' | 'finalized' | 'waiting';
  lastPendingAsyncSignature: string;
  workingMessages: Message[];
}> {
  const completedBlockingGoalIdsBeforeTools = collectCompletedBlockingGoalIds(
    params.getGraphSnapshot().goals,
  );
  let yieldedTurnMessage: string | undefined;
  let forceFinalTextFromYieldThisTurn = false;
  let hasBackgroundLaunchWithoutWait = false;
  let yieldCompletionNoteMessage: string | undefined;
  let workingMessages = params.workingMessages;
  const canonicalToolExecutionOutcomes: CanonicalToolExecutionOutcome[] = [];
  let graphMutationBoundaryReached = false;
  let clarificationRequest: RequestClarificationToolResult | undefined;
  let deferredHandoff: PersistedMobileControllerHandoff | undefined;

  for (const outcome of [...params.toolExecutionOutcomes].sort(
    (left, right) => left.index - right.index,
  )) {
    if (isDeferredToolExecutionOutcome(outcome)) {
      if (deferredHandoff) {
        throw new Error('multiple_mobile_controller_handoffs_in_tool_batch');
      }
      const executableToolCall = params.executableToolCalls[outcome.index];
      const handoffRef = outcome.deferredHandoff.handoffRef;
      const graph = params.getGraphSnapshot();
      const ownsExpectedToolCall = graph.expectedToolCalls.some(
        (toolCall) =>
          toolCall.id === outcome.toolCallId &&
          resolveRegisteredToolName(toolCall.name) === MOBILE_UI_ACTION_TOOL_NAME,
      );
      if (
        outcome.toolCallId !== handoffRef.toolCallId ||
        outcome.effectDispatchObservation.handoff !== handoffRef ||
        executableToolCall?.name === undefined ||
        resolveRegisteredToolName(executableToolCall.name) !== MOBILE_UI_ACTION_TOOL_NAME ||
        !ownsExpectedToolCall ||
        graph.observedToolResults.some((result) => result.id === outcome.toolCallId) ||
        graph.asyncWork.pendingOperations.length > 0 ||
        graph.pendingAsyncCount !== 0
      ) {
        throw new Error('mobile_controller_handoff_graph_identity_invalid');
      }
      const operation = buildAgentRunMobileControllerAsyncOperation({
        handoff: handoffRef,
        updatedAt: outcome.deferredHandoff.handle.createdAt,
      });
      if (!operation) {
        throw new Error('mobile_controller_handoff_async_operation_invalid');
      }
      params.applyGraphEvents([
        {
          type: 'ASYNC_WAITING',
          pendingAsyncCount: 1,
          pendingOperations: [operation],
          timestamp: operation.updatedAt,
        },
      ]);
      const waitingGraph = params.getGraphSnapshot();
      if (
        waitingGraph.status !== 'waiting_async' ||
        waitingGraph.pendingAsyncCount !== 1 ||
        waitingGraph.asyncWork.pendingOperations.length !== 1 ||
        waitingGraph.asyncWork.pendingOperations[0]?.key !== operation.key
      ) {
        throw new Error('mobile_controller_handoff_graph_projection_failed');
      }
      deferredHandoff = outcome.deferredHandoff;
      try {
        if (!params.publishMobileControllerHandoff) {
          throw new Error('mobile_controller_handoff_publisher_missing');
        }
        await params.publishMobileControllerHandoff(deferredHandoff);
      } catch (error: unknown) {
        params.warn('Mobile controller handoff publication failed', error);
      }
      continue;
    }
    const rawGraphToolCall = outcome.toolMessage.toolCalls?.[0];
    const executableToolCall = params.executableToolCalls[outcome.index];
    const rawToolName = resolveRegisteredToolName(
      rawGraphToolCall?.name || executableToolCall?.name || outcome.toolCallId,
    );
    let canonicalOutcome: CanonicalToolExecutionOutcome;
    if (graphMutationBoundaryReached && rawToolName === 'update_goals') {
      canonicalOutcome = buildDeferredAfterGraphMutationOutcome({
        ...outcome,
        canonicalized: false,
        graphApplied: false,
      });
    } else {
      canonicalOutcome = canonicalizeToolExecutionOutcome({
        outcome,
        toolName: rawToolName,
        executableToolCalls: params.executableToolCalls,
        toolCallHistory: params.toolCallHistory,
        getGraphSnapshot: params.getGraphSnapshot,
        applyGraphEvents: params.applyGraphEvents,
        conversationId: params.conversationId,
        currentUserMessage: params.currentUserMessage,
        warn: params.warn,
      });
    }
    const toolName = resolveRegisteredToolName(
      canonicalOutcome.toolMessage.toolCalls?.[0]?.name ||
        executableToolCall?.name ||
        canonicalOutcome.toolCallId,
    );
    if (
      didSessionToolStartBackgroundWork({
        toolName,
        toolArguments:
          canonicalOutcome.toolMessage.toolCalls?.[0]?.arguments ?? executableToolCall?.arguments,
        toolResult: canonicalOutcome.toolMessage.content,
        isError: canonicalOutcome.toolMessage.isError,
      })
    ) {
      hasBackgroundLaunchWithoutWait = true;
    }
    if (toolName === REQUEST_CLARIFICATION_TOOL_NAME && !canonicalOutcome.toolMessage.isError) {
      const parsedClarification = parseRequestClarificationToolResult(
        canonicalOutcome.toolMessage.content,
      );
      if (!parsedClarification) {
        throw new Error('request_clarification_result_invalid');
      }
      clarificationRequest ??= parsedClarification;
    }
    const toolResultCanAdvanceWorkflow =
      toolName !== 'update_goals' && toolName !== REQUEST_CLARIFICATION_TOOL_NAME;
    updateToolCallHistoryResult({
      history: params.toolCallHistory,
      toolCallId: canonicalOutcome.toolCallId,
      toolName,
      argumentsText: executableToolCall?.arguments,
      result: canonicalOutcome.toolMessage.content,
      status: canonicalOutcome.toolMessage.isError === true ? 'failed' : 'completed',
    });
    canonicalToolExecutionOutcomes.push(canonicalOutcome);

    workingMessages.push(canonicalOutcome.toolMessage);
    await params.onToolMessage(
      buildToolMessageOutcome({
        toolCallId: canonicalOutcome.toolCallId,
        toolMessage: canonicalOutcome.toolMessage,
      }),
    );

    const graphToolCall = canonicalOutcome.toolMessage.toolCalls?.[0];
    const effectPolicy = resolveToolEffectPolicy(toolName);
    const isCodeOwnedEffectFreeTool =
      effectPolicy.source !== 'unknown' &&
      effectPolicy.effects.every((effect) => effect === 'none');
    const structuralGoalEvidenceStrings =
      !canonicalOutcome.toolMessage.isError &&
      toolResultCanAdvanceWorkflow &&
      (canonicalOutcome.effectReceipt?.effectState === 'none' || isCodeOwnedEffectFreeTool)
        ? buildToolGoalEvidenceStrings({
            toolName,
            content: canonicalOutcome.toolMessage.content,
          })
        : [];
    const effectReceiptEvidenceStrings = canonicalOutcome.effectReceipt
      ? [buildToolEffectReceiptEvidence(canonicalOutcome.effectReceipt)]
      : [];
    const toolGoalEvidenceStrings = [
      ...structuralGoalEvidenceStrings,
      ...effectReceiptEvidenceStrings,
    ];
    params.applyGraphEvents([
      {
        type: 'TOOL_RESULT_RECORDED',
        result: {
          id: canonicalOutcome.toolCallId,
          name: graphToolCall?.name || executableToolCall?.name || canonicalOutcome.toolCallId,
          ...(canonicalOutcome.toolMessage.isError ? { failed: true } : {}),
          ...(canonicalOutcome.canonicalized ? { canonicalized: true } : {}),
          ...(canonicalOutcome.graphApplied ? { graphApplied: true } : {}),
          ...(toolGoalEvidenceStrings.length > 0 ? { evidence: toolGoalEvidenceStrings } : {}),
        },
      },
    ]);

    if (!canonicalOutcome.toolMessage.isError && DISCOVERY_ACTIVATION_TOOL_NAMES.has(toolName)) {
      const discoveryActivatedToolNames = extractActivatedToolNamesFromDiscoveryToolResult(
        toolName,
        canonicalOutcome.toolMessage.content,
      );
      params.applyGraphEvents([
        {
          type: 'SESSION_ACTIVATED_TOOLS_UPDATED',
          toolNames: discoveryActivatedToolNames,
          updateMode: toolName === 'tool_describe' ? 'merge' : 'replace',
          reason: `${toolName}:discovery`,
          timestamp: Date.now(),
        },
      ]);
    }

    // ── Auto-link tool results to active goal evidence ───────────────────
    let delegationEvidenceApplied = false;
    if (!canonicalOutcome.toolMessage.isError && toolResultCanAdvanceWorkflow) {
      const snapshot = params.getGraphSnapshot();
      const delegationTerminal = buildDelegationToolTerminalGraphEvents({
        toolName,
        resultContent: canonicalOutcome.toolMessage.content,
        run: { controlGraph: snapshot },
      });
      if (delegationTerminal.events.length > 0) {
        params.applyGraphEvents(delegationTerminal.events);
        delegationEvidenceApplied = delegationTerminal.applied;
        if (delegationTerminal.applied) {
          const delegationAutoCompleteEvent = buildDelegationEvidenceAutoCompleteEvent({
            goals: params.getGraphSnapshot().goals ?? [],
          });
          if (delegationAutoCompleteEvent) {
            params.applyGraphEvents([delegationAutoCompleteEvent]);
          }
        }
      }
    }

    if (toolResultCanAdvanceWorkflow) {
      const evidenceRoutableGoals = (params.getGraphSnapshot().goals ?? []).filter(
        (goal) => goal.status === 'active' || goal.status === 'blocked',
      );
      const routableEvidenceStrings = delegationEvidenceApplied
        ? effectReceiptEvidenceStrings
        : toolGoalEvidenceStrings;
      if (routableEvidenceStrings.length > 0 && evidenceRoutableGoals.length > 0) {
        const routedEvidence = routeToolEvidenceToActiveGoals({
          toolName,
          toolDefinitions: params.groundedRequestScopedTools,
          goals: evidenceRoutableGoals,
          evidenceStrings: routableEvidenceStrings,
        });
        for (const routed of routedEvidence) {
          params.applyGraphEvents([
            {
              type: 'GOAL_EVIDENCE_ADDED',
              goalId: routed.goalId,
              evidence: routed.evidence,
              timestamp: Date.now(),
            },
          ]);
        }
        const unverifiedEffectBlockEvent = buildAppliedUnverifiedEffectGoalBlockEvent({
          goals: params.getGraphSnapshot().goals ?? [],
          receiptEvidence: effectReceiptEvidenceStrings[0],
        });
        if (unverifiedEffectBlockEvent) {
          params.applyGraphEvents([unverifiedEffectBlockEvent]);
        }
        const terminalFailedEffectGuardRemovalEvent = buildTerminalFailedEffectGuardRemovalEvent({
          goals: params.getGraphSnapshot().goals ?? [],
          receiptEvidence: effectReceiptEvidenceStrings[0],
        });
        if (terminalFailedEffectGuardRemovalEvent) {
          params.applyGraphEvents([terminalFailedEffectGuardRemovalEvent]);
        }
        if (routedEvidence.length > 0) {
          const satisfiedGoals = findEvidenceSatisfiedGoals(params.getGraphSnapshot().goals ?? []);
          if (satisfiedGoals.length > 0) {
            const autoCompleteEvent = buildEvidenceSatisfiedGoalAutoCompleteEvent({
              goals: params.getGraphSnapshot().goals ?? [],
              goalIds: satisfiedGoals.map((goal) => goal.id),
            });
            if (autoCompleteEvent) {
              params.applyGraphEvents([autoCompleteEvent]);
            }
          }
        }
      }
    }

    if (!canonicalOutcome.skipWorkflowProgress && toolName !== REQUEST_CLARIFICATION_TOOL_NAME) {
      params.publishWorkflowToolResultProgress({
        toolMessage: canonicalOutcome.toolMessage,
        tools: params.groundedRequestScopedTools,
        reason: 'tool_result',
      });
    }

    if (!yieldedTurnMessage && canonicalOutcome.yieldedMessage) {
      yieldedTurnMessage = canonicalOutcome.yieldedMessage;
    }
    if (canonicalOutcome.forceFinalText) {
      forceFinalTextFromYieldThisTurn = true;
      yieldCompletionNoteMessage =
        canonicalOutcome.yieldCompletionNoteMessage || yieldCompletionNoteMessage;
    }
    if (toolName === 'update_goals' && canonicalOutcome.graphApplied) {
      graphMutationBoundaryReached = true;
    }
  }

  await params.yieldToUiFrame();

  if (deferredHandoff) {
    return {
      status: 'waiting',
      lastPendingAsyncSignature: params.lastPendingAsyncSignature,
      workingMessages,
    };
  }

  if (clarificationRequest) {
    const requestedAfterUserMessageId = params.currentUserMessage?.id.trim();
    if (!requestedAfterUserMessageId) {
      throw new Error('request_clarification_current_user_message_missing');
    }
    const requestUnderstanding = buildClarificationRequestUnderstanding({
      graphSnapshot: params.getGraphSnapshot(),
      request: clarificationRequest,
    });
    if (requestUnderstanding) {
      params.applyGraphEvents([
        {
          type: 'REQUEST_UNDERSTANDING_PROJECTED',
          projection: requestUnderstanding,
          iteration: params.iteration,
        },
      ]);
    }
    await params.finishWaitingForUserInput({
      graphEvent: {
        type: 'USER_INPUT_REQUIRED',
        requestedAfterUserMessageId,
        requiredInformation: clarificationRequest.requiredInformation.map(
          ({ key, requiredFor, semanticRole, resolution }) => ({
            key,
            requiredFor,
            semanticRole,
            resolution,
          }),
        ),
      },
      content: clarificationRequest.question,
      assistantMetadata: buildAssistantMessageMetadata('final', {
        completionStatus: 'complete',
        finishReason: 'request_clarification',
      }),
      sessionEndReason: 'request_clarification',
    });
    return {
      status: 'waiting',
      lastPendingAsyncSignature: params.lastPendingAsyncSignature,
      workingMessages,
    };
  }

  if (canonicalToolExecutionOutcomes.some((outcome) => outcome.effectReconciliationRequired)) {
    await params.finishWithGraphTerminalEvent({
      graphEvent: {
        type: 'BLOCKED',
        reason: 'tool_effect_reconciliation_required',
      },
      content:
        'A tool may have changed external state, but its outcome could not be verified. ' +
        'This execution is stopped to prevent a duplicate mutation. Reconcile the external state or make a new explicit request before continuing.',
      assistantMetadata: buildAssistantMessageMetadata('final', {
        completionStatus: 'incomplete',
        finishReason: 'tool_effect_reconciliation_required',
      }),
      sessionEndReason: 'tool_effect_reconciliation_required',
    });
    return {
      status: 'finalized',
      lastPendingAsyncSignature: params.lastPendingAsyncSignature,
      workingMessages,
    };
  }

  if (
    canonicalToolExecutionOutcomes.some(
      (outcome) =>
        outcome.effectDispatchObservation?.kind === 'not_claimed' &&
        outcome.effectDispatchObservation.reason === 'user_approval_denied',
    )
  ) {
    await params.finishWithGraphTerminalEvent({
      graphEvent: {
        type: 'CANCELLED',
        reason: 'user_approval_denied',
      },
      content:
        'Okay — I did not perform that action because you rejected the approval request. No effect was dispatched.',
      assistantMetadata: buildAssistantMessageMetadata('final', {
        completionStatus: 'complete',
        finishReason: 'user_approval_denied',
      }),
      sessionEndReason: 'user_approval_denied',
    });
    return {
      status: 'finalized',
      lastPendingAsyncSignature: params.lastPendingAsyncSignature,
      workingMessages,
    };
  }

  if (
    canonicalToolExecutionOutcomes.some(
      (outcome) =>
        outcome.effectDispatchObservation?.kind === 'not_claimed' &&
        outcome.effectDispatchObservation.reason === 'user_takeover_required',
    )
  ) {
    await params.finishWithGraphTerminalEvent({
      graphEvent: {
        type: 'BLOCKED',
        reason: 'user_takeover_required',
      },
      content:
        'I stopped before performing that action because this controller requires you to review and complete the consequential step directly. No effect was dispatched.',
      assistantMetadata: buildAssistantMessageMetadata('final', {
        completionStatus: 'incomplete',
        finishReason: 'tool_effect_not_claimed',
      }),
      sessionEndReason: 'user_takeover_required',
    });
    return {
      status: 'finalized',
      lastPendingAsyncSignature: params.lastPendingAsyncSignature,
      workingMessages,
    };
  }

  if (
    canonicalToolExecutionOutcomes.some((outcome) =>
      isTerminalToolEffectDispatchObservation(outcome.effectDispatchObservation),
    )
  ) {
    await params.finishWithGraphTerminalEvent({
      graphEvent: {
        type: 'BLOCKED',
        reason: 'tool_effect_not_claimed',
      },
      content:
        'The request is incomplete because a required action could not be safely authorized, durably recorded, and verified. ' +
        'That action was not executed or claimed as successful. Any separately verified actions remain reflected in their tool results. ' +
        'Review the relevant permission, or retry after the durable execution service is available.',
      assistantMetadata: buildAssistantMessageMetadata('final', {
        completionStatus: 'incomplete',
        finishReason: 'tool_effect_not_claimed',
      }),
      sessionEndReason: 'tool_effect_not_claimed',
    });
    return {
      status: 'finalized',
      lastPendingAsyncSignature: params.lastPendingAsyncSignature,
      workingMessages,
    };
  }

  const postToolGraphBlocker = params.getModelTurnBlocker();
  if (postToolGraphBlocker) {
    throw new Error(
      `Invariant violation after tool execution ${params.iteration}: ${postToolGraphBlocker}`,
    );
  }

  const latestGoals = params.getGraphSnapshot().goals ?? [];
  const hasActivePersistentGoal = latestGoals.some(
    (goal) => goal.status === 'active' && !isBlockingGoal(goal),
  );
  const hasCompletedBlockingGoal = hasNewlyCompletedBlockingGoal({
    before: completedBlockingGoalIdsBeforeTools,
    after: latestGoals,
  });
  const hasIncompleteBlockingGoal = latestGoals.some(
    (goal) => isBlockingGoal(goal) && (goal.status === 'active' || goal.status === 'pending'),
  );

  return finalizeAgentControlGraphToolExecutionOutcomes({
    iteration: params.iteration,
    trackedAsyncOperations: params.trackedAsyncOperations,
    lastPendingAsyncSignature: params.lastPendingAsyncSignature,
    contextWindow: params.contextWindow,
    conversationId: params.conversationId,
    compactionEngine: params.compactionEngine,
    livingMemory: params.livingMemory,
    onCompaction: params.onCompaction,
    warn: params.warn,
    onStateChange: params.onStateChange,
    applyGraphEvents: params.applyGraphEvents,
    syncPendingAsyncOperationsToGraph: params.syncPendingAsyncOperationsToGraph,
    recordTurnDirectives: params.recordTurnDirectives,
    recordPostToolFinalTextDirective: params.recordPostToolFinalTextDirective,
    finishWithGraphTerminalEvent: params.finishWithGraphTerminalEvent,
    yieldedTurnMessage,
    forceFinalTextFromYieldThisTurn,
    yieldCompletionNoteMessage,
    hasBackgroundLaunchWithoutWait,
    hasAsyncTerminalResolution:
      canonicalToolExecutionOutcomes.some((outcome) =>
        agentControlGraphToolMessageShowsSuccessfulAsyncTerminalResolution(outcome.toolMessage),
      ) &&
      params.executableToolCalls.some((toolCall) =>
        params.pendingAsyncMonitorToolNames.has(normalizeToolName(toolCall.name)),
      ),
    hasActivePersistentGoal,
    hasCompletedBlockingGoal,
    hasIncompleteBlockingGoal,
    workingMessages,
  });
}
