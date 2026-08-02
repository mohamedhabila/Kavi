import type { AgentGoal } from '../../types/agentRun';
import type { AssistantCompletionMetadata } from '../../types/message';
import type { TrackedAsyncOperation } from '../pendingAsyncOperations';
import type { AgentControlTurnDirectives } from './agentControlGraph';
import { buildAgentControlGraphPendingAsyncFinalizationCommand } from './asyncPendingFinalization';
import {
  evaluateDeliveryIncompleteHold,
  evaluateGoalEvidenceIncompleteHold,
  evaluateGoalsIncompleteHold,
  evaluateIncompleteToolContinuationHold,
} from './completionGateHolds';
import {
  evaluateGraphMutationErrorHold,
  evaluateNoToolProgressRetry,
  evaluateToolErrorRepairHold,
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
  completion?: AssistantCompletionMetadata;
  nextFinalizationMaxTokens: number;
  requiresAgenticProgressValidation?: boolean;
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

  const incompleteToolContinuationHold = evaluateIncompleteToolContinuationHold({
    toolingEnabledForProvider: params.toolingEnabledForProvider,
    selectedToolCount: params.selectedToolCount,
    selectedToolNames: params.selectedToolNames,
    forceTextThisTurn: params.forceTextThisTurn,
    toolCallHistory: params.toolCallHistory,
  });
  if (incompleteToolContinuationHold) {
    return incompleteToolContinuationHold;
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

  const noToolProgressRetry = evaluateNoToolProgressRetry({
    consecutiveNoToolTurns: params.consecutivePendingAsyncNoToolTurns,
    goals: params.goals,
    toolingEnabledForProvider: params.toolingEnabledForProvider,
    selectedToolCount: params.selectedToolCount,
    selectedToolNames: params.selectedToolNames,
    forceTextThisTurn: params.forceTextThisTurn,
    toolCallHistory: params.toolCallHistory,
    requiresAgenticProgressValidation: params.requiresAgenticProgressValidation,
    candidateCompletionIsComplete: params.completion?.completionStatus === 'complete',
  });
  if (noToolProgressRetry) {
    return noToolProgressRetry;
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
