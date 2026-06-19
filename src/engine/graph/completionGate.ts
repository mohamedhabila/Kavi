import type { AgentGoal } from '../../types/agentRun';
import type { AssistantCompletionMetadata } from '../../types/message';
import type { TrackedAsyncOperation } from '../pendingAsyncOperations';
import type { AgentControlTurnDirectives } from './agentControlGraph';
import { buildAgentControlGraphPendingAsyncFinalizationCommand } from './asyncPendingFinalization';
import {
  evaluateDeliveryIncompleteHold,
  evaluateGoalEvidenceIncompleteHold,
  evaluateGoalsIncompleteHold,
} from './completionGateHolds';
import {
  evaluateGraphMutationErrorHold,
  evaluateGraphStateReconciliationHold,
  evaluateNoToolProgressRetry,
  evaluateToolErrorRepairHold,
  evaluateWorkflowContinuationHold,
} from './completionGateRecoveryHolds';
import type { CompletionGateDecision } from './completionGateTypes';
import type { ToolCallRecord } from '../loopDetection';

export type { CompletionGateDecision, CompletionGateHoldReason } from './completionGateTypes';

export function evaluateCompletionGate(params: {
  trackedOperations: ReadonlyMap<string, TrackedAsyncOperation>;
  pendingOperations: ReadonlyArray<TrackedAsyncOperation>;
  consecutivePendingAsyncNoToolTurns: number;
  hasDraftContent: boolean;
  goals: ReadonlyArray<AgentGoal>;
  toolingEnabledForProvider: boolean;
  selectedToolCount: number;
  selectedToolNames?: ReadonlySet<string>;
  forceTextThisTurn: boolean;
  fullContent: string;
  recoveryDirectives: AgentControlTurnDirectives;
  toolCallHistory?: ReadonlyArray<ToolCallRecord>;
  pendingWorkflowContinuationToolNames?: ReadonlyArray<string>;
  completion?: AssistantCompletionMetadata;
  nextFinalizationMaxTokens: number;
}): CompletionGateDecision {
  const asyncCommand = buildAgentControlGraphPendingAsyncFinalizationCommand({
    trackedOperations: params.trackedOperations,
    pendingOperations: params.pendingOperations,
    previousNoToolTurnCount: params.consecutivePendingAsyncNoToolTurns,
    hasDraftContent: params.hasDraftContent,
  });
  if (asyncCommand.type === 'hold') {
    return {
      type: 'hold',
      reason: asyncCommand.reason,
      graphEvent: asyncCommand.graphEvent,
      systemPrompts: asyncCommand.systemPrompts,
      missingRequiredEvidenceLabels: [],
      nextConsecutivePendingAsyncNoToolTurns: asyncCommand.nextNoToolTurnCount,
    };
  }

  const evidenceHold = evaluateGoalEvidenceIncompleteHold({
    goals: params.goals,
    toolingEnabledForProvider: params.toolingEnabledForProvider,
    selectedToolCount: params.selectedToolCount,
    forceTextThisTurn: params.forceTextThisTurn,
    toolCallHistory: params.toolCallHistory,
  });
  if (evidenceHold) {
    return evidenceHold;
  }

  const graphMutationErrorHold = evaluateGraphMutationErrorHold({
    toolingEnabledForProvider: params.toolingEnabledForProvider,
    selectedToolCount: params.selectedToolCount,
    forceTextThisTurn: params.forceTextThisTurn,
    toolCallHistory: params.toolCallHistory,
  });
  if (graphMutationErrorHold) {
    return graphMutationErrorHold;
  }

  const toolErrorRepairHold = evaluateToolErrorRepairHold({
    consecutiveNoToolTurns: params.consecutivePendingAsyncNoToolTurns,
    toolingEnabledForProvider: params.toolingEnabledForProvider,
    selectedToolCount: params.selectedToolCount,
    forceTextThisTurn: params.forceTextThisTurn,
    toolCallHistory: params.toolCallHistory,
  });
  if (toolErrorRepairHold) {
    return toolErrorRepairHold;
  }

  const workflowContinuationHold = evaluateWorkflowContinuationHold({
    consecutiveNoToolTurns: params.consecutivePendingAsyncNoToolTurns,
    pendingWorkflowContinuationToolNames: params.pendingWorkflowContinuationToolNames,
    toolingEnabledForProvider: params.toolingEnabledForProvider,
    selectedToolCount: params.selectedToolCount,
    forceTextThisTurn: params.forceTextThisTurn,
  });
  if (workflowContinuationHold) {
    return workflowContinuationHold;
  }

  const noToolProgressRetry = evaluateNoToolProgressRetry({
    consecutiveNoToolTurns: params.consecutivePendingAsyncNoToolTurns,
    fullContent: params.fullContent,
    goals: params.goals,
    toolingEnabledForProvider: params.toolingEnabledForProvider,
    selectedToolCount: params.selectedToolCount,
    selectedToolNames: params.selectedToolNames,
    forceTextThisTurn: params.forceTextThisTurn,
    toolCallHistory: params.toolCallHistory,
  });
  if (noToolProgressRetry) {
    return noToolProgressRetry;
  }

  const graphStateReconciliation = evaluateGraphStateReconciliationHold({
    consecutiveNoToolTurns: params.consecutivePendingAsyncNoToolTurns,
    goals: params.goals,
    toolingEnabledForProvider: params.toolingEnabledForProvider,
    selectedToolCount: params.selectedToolCount,
    selectedToolNames: params.selectedToolNames,
    forceTextThisTurn: params.forceTextThisTurn,
    toolCallHistory: params.toolCallHistory,
  });
  if (graphStateReconciliation) {
    return graphStateReconciliation;
  }

  const goalsHold = evaluateGoalsIncompleteHold({
    goals: params.goals,
    toolingEnabledForProvider: params.toolingEnabledForProvider,
    selectedToolCount: params.selectedToolCount,
    forceTextThisTurn: params.forceTextThisTurn,
  });
  if (goalsHold) {
    return goalsHold;
  }

  const deliveryHold = evaluateDeliveryIncompleteHold({
    fullContent: params.fullContent,
    recoveryDirectives: params.recoveryDirectives,
    completion: params.completion,
    nextFinalizationMaxTokens: params.nextFinalizationMaxTokens,
  });
  if (deliveryHold) {
    return deliveryHold;
  }

  return { type: 'ready' };
}
