import type { AssistantCompletionMetadata } from '../../types/message';
import type { TrackedAsyncOperation } from '../pendingAsyncOperations';
import type { AgentControlTurnDirectives } from './agentControlGraph';
import { buildAgentControlGraphPendingAsyncFinalizationCommand } from './asyncPendingFinalization';
import {
  evaluateDeliveryIncompleteHold,
  evaluateIncompleteToolContinuationHold,
} from './completionGateHolds';
import { evaluateToolErrorRepairHold } from './completionGateRecoveryHolds';
import type { CompletionGateDecision } from './completionGateTypes';
import type { ToolCallRecord } from '../loopDetection';

export type { CompletionGateDecision, CompletionGateHoldReason } from './completionGateTypes';

/**
 * Whether a text-only model turn may finalize the run. Goals never gate it: the model ends
 * a request by answering, as in any agent loop. What can hold the answer is work still in
 * flight or a delivery that is visibly incomplete — pending background work, a partial
 * file read, a retryable tool error, a truncated answer.
 */
export function evaluateCompletionGate(params: {
  trackedOperations: ReadonlyMap<string, TrackedAsyncOperation>;
  pendingOperations: ReadonlyArray<TrackedAsyncOperation>;
  consecutivePendingAsyncNoToolTurns: number;
  hasDraftContent: boolean;
  toolingEnabledForProvider: boolean;
  selectedToolCount: number;
  selectedToolNames?: ReadonlySet<string>;
  forceTextThisTurn: boolean;
  fullContent: string;
  recoveryDirectives: AgentControlTurnDirectives;
  toolCallHistory?: ReadonlyArray<ToolCallRecord>;
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
