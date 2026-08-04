import type { AgentGoal } from '../../types/agentRun';
import type { AssistantCompletionMetadata } from '../../types/message';
import {
  buildIncompleteTextContinuationNote,
  shouldResumeIncompleteFinalTextTurn,
} from '../../services/llm/support/completionRecovery';
import {
  buildCriterionSatisfactionActions,
  buildMissingRequiredEvidenceLabels,
  evaluateGoalEvidenceGaps,
  evaluateRequiredEffectEvidenceGaps,
  type GoalEvidenceGap,
} from '../goals/completionEvidence';
import { hasResumableBlockingGoals, isBlockingGoal } from '../goals/types';
import type { ToolCallRecord } from '../loopDetection';
import { normalizeToolName } from '../tools/toolNameNormalization';
import {
  parseReadFileContinuationResult,
  READ_FILE_CONTINUATION_TOOL,
} from '../../utils/readFileContinuation';
import type { AgentControlTurnDirectives } from './agentControlGraph';
import {
  buildDelegationEvidenceAutoCompleteEvent,
  buildEvidenceSatisfiedGoalAutoCompleteEvent,
  findEvidenceSatisfiedGoals,
} from './completionGateGoalAutoComplete';
import type { CompletionGateDecision } from './completionGateTypes';
import { renderGoalFocusLines, renderPendingGoalFocusLines } from './goalFocusPrompt';
import { extractRecentToolRepairHints } from './toolRepairHints';

function buildGoalHoldPrompt(goals: ReadonlyArray<AgentGoal>): string {
  const blockingGoals = goals.filter(isBlockingGoal);
  const active = blockingGoals.filter((goal) => goal.status === 'active');
  const pending = blockingGoals.filter((goal) => goal.status === 'pending');
  const lines: string[] = ['[SYSTEM HOLD]'];

  if (active.length > 0) {
    lines.push('Active goals:');
    lines.push(...renderGoalFocusLines(active));
  }
  if (pending.length > 0) {
    lines.push('Pending goals:');
    lines.push(...renderPendingGoalFocusLines(pending));
  }
  lines.push('Do not finalize. Continue executing the active goal or activate a pending goal.');

  return lines.join('\n');
}

export function evaluateIncompleteToolContinuationHold(params: {
  toolingEnabledForProvider: boolean;
  selectedToolCount: number;
  selectedToolNames?: ReadonlySet<string>;
  forceTextThisTurn: boolean;
  toolCallHistory?: ReadonlyArray<ToolCallRecord>;
}): CompletionGateDecision | null {
  if (
    !params.toolingEnabledForProvider ||
    params.selectedToolCount <= 0 ||
    params.forceTextThisTurn ||
    (params.selectedToolNames && !params.selectedToolNames.has(READ_FILE_CONTINUATION_TOOL))
  ) {
    return null;
  }

  const latest = params.toolCallHistory?.at(-1);
  if (
    !latest ||
    latest.status !== 'completed' ||
    normalizeToolName(latest.name) !== READ_FILE_CONTINUATION_TOOL ||
    typeof latest.result !== 'string'
  ) {
    return null;
  }

  const continuation = parseReadFileContinuationResult(latest.result);
  if (!continuation) return null;
  const requiredOffset = continuation.rereadOffset ?? continuation.nextOffset;
  if (
    continuation.rereadOffset === undefined &&
    (continuation.complete || requiredOffset === null)
  ) {
    return null;
  }

  return {
    type: 'hold',
    reason: 'incomplete_tool_continuation',
    graphEvent: {
      type: 'FINALIZATION_HELD',
      reason: 'incomplete_tool_continuation',
    },
    systemPrompts: [
      [
        '[SYSTEM TOOL CONTINUATION HOLD]',
        continuation.rereadOffset !== undefined
          ? 'The latest durable read_file checkpoint omitted the chunk body.'
          : 'The latest successful read_file result is a code-owned partial chunk.',
        `Continue with read_file using path ${JSON.stringify(continuation.path)} and offset ${requiredOffset}.`,
        continuation.rereadOffset !== undefined
          ? 'Do not finalize from checkpoint metadata alone. Reread the omitted chunk before relying on it or advancing.'
          : 'Do not finalize from a partial chunk. Continue until read_file returns complete:true or a concrete non-recoverable tool error occurs.',
      ].join('\n'),
    ],
    missingRequiredEvidenceLabels: [],
  };
}

function buildGoalEvidenceHoldPrompt(
  goals: ReadonlyArray<AgentGoal>,
  gaps: ReadonlyArray<GoalEvidenceGap>,
  repairHints: ReadonlyArray<string>,
): string {
  const active = goals.filter((goal) => isBlockingGoal(goal) && goal.status === 'active');
  const missingLabels = buildMissingRequiredEvidenceLabels(gaps);
  const lines: string[] = ['[SYSTEM HOLD]'];

  if (active.length > 0) {
    lines.push('Active goals:');
    lines.push(...renderGoalFocusLines(active));
  }
  lines.push(`Missing evidence criteria: ${missingLabels.join(', ')}.`);
  // Naming the criterion alone leaves the model to infer which action records it,
  // which surfaces as repeated goal bookkeeping rather than progress.
  const evidenceActions = buildCriterionSatisfactionActions(active);
  if (evidenceActions.length > 0) {
    lines.push(`To record it: ${evidenceActions.join('; ')}.`);
  }
  if (repairHints.length > 0) {
    lines.push(`Recent tool repair hints: ${repairHints.join('; ')}.`);
    lines.push(
      'Retry failed tools using repair.expectedShape and valid top-level JSON arguments from the user request, graph goals, or prior tool outputs.',
    );
  }
  lines.push(
    'Do not finalize or mark the goal blocked only because evidence is missing. Continue executing until required goal evidence is recorded.',
  );

  return lines.join('\n');
}

export function evaluateGoalEvidenceIncompleteHold(params: {
  goals: ReadonlyArray<AgentGoal>;
  toolingEnabledForProvider: boolean;
  selectedToolCount: number;
  forceTextThisTurn: boolean;
  toolCallHistory?: ReadonlyArray<ToolCallRecord>;
}): CompletionGateDecision | null {
  const blockingGoals = params.goals.filter(isBlockingGoal);
  const requiredEffectGaps = evaluateRequiredEffectEvidenceGaps(blockingGoals);
  if (
    requiredEffectGaps.length === 0 &&
    (!params.toolingEnabledForProvider || params.selectedToolCount <= 0 || params.forceTextThisTurn)
  ) {
    return null;
  }

  const gaps =
    requiredEffectGaps.length > 0 ? requiredEffectGaps : evaluateGoalEvidenceGaps(blockingGoals);
  if (gaps.length === 0) {
    return null;
  }

  const missingRequiredEvidenceLabels = buildMissingRequiredEvidenceLabels(gaps);

  return {
    type: 'hold',
    reason: 'goal_evidence_incomplete',
    graphEvent: {
      type: 'FINALIZATION_HELD',
      reason: 'goal_evidence_incomplete',
    },
    systemPrompts: [
      buildGoalEvidenceHoldPrompt(
        params.goals,
        gaps,
        extractRecentToolRepairHints(params.toolCallHistory),
      ),
    ],
    missingRequiredEvidenceLabels,
  };
}

export function evaluateGoalsIncompleteHold(params: {
  goals: ReadonlyArray<AgentGoal>;
  toolingEnabledForProvider: boolean;
  selectedToolCount: number;
  forceTextThisTurn: boolean;
}): CompletionGateDecision | null {
  const delegationAutoCompleteEvent = buildDelegationEvidenceAutoCompleteEvent({
    goals: params.goals,
  });
  if (delegationAutoCompleteEvent?.type === 'GOALS_UPDATED') {
    return {
      type: 'auto_complete_goals',
      reason: 'delegation_evidence_satisfied',
      graphEvent: delegationAutoCompleteEvent,
    };
  }

  const goalsRequiringCompletion = findEvidenceSatisfiedGoals(params.goals);
  if (goalsRequiringCompletion.length > 0) {
    const graphEvent = buildEvidenceSatisfiedGoalAutoCompleteEvent({
      goals: params.goals,
      goalIds: goalsRequiringCompletion.map((goal) => goal.id),
    });
    if (graphEvent?.type === 'GOALS_UPDATED') {
      return {
        type: 'auto_complete_goals',
        reason: 'goal_evidence_satisfied',
        graphEvent,
      };
    }
  }

  if (!hasResumableBlockingGoals(params.goals)) {
    return null;
  }

  if (
    !params.toolingEnabledForProvider ||
    params.selectedToolCount <= 0 ||
    params.forceTextThisTurn
  ) {
    return {
      type: 'block',
      reason: 'goals_incomplete_without_tool_path',
      graphEvent: {
        type: 'BLOCKED',
        reason: 'goals_incomplete_without_tool_path',
      },
      content:
        'I could not complete this request because required work remains but no executable tool path is available. The task stopped without claiming completion.',
    };
  }

  return {
    type: 'hold',
    reason: 'goals_incomplete',
    graphEvent: {
      type: 'FINALIZATION_HELD',
      reason: 'goals_incomplete',
    },
    systemPrompts: [buildGoalHoldPrompt(params.goals)],
    missingRequiredEvidenceLabels: [],
  };
}

export function evaluateDeliveryIncompleteHold(params: {
  fullContent: string;
  recoveryDirectives: AgentControlTurnDirectives;
  completion?: AssistantCompletionMetadata;
  nextFinalizationMaxTokens: number;
}): CompletionGateDecision | null {
  if (
    !shouldResumeIncompleteFinalTextTurn({
      completion: params.completion,
      fullContent: params.fullContent,
      recoveryCount: params.recoveryDirectives.incompleteFinalTextRecoveryCount,
    })
  ) {
    return null;
  }

  return {
    type: 'hold',
    reason: 'incomplete_delivery_continuation',
    graphEvent: {
      type: 'FINALIZATION_HELD',
      reason: 'incomplete_delivery_continuation',
    },
    systemPrompts: [buildIncompleteTextContinuationNote(params.completion?.finishReason)],
    missingRequiredEvidenceLabels: [],
    assistantContent: params.fullContent,
    turnDirectives: {
      forceFinalText: true,
      forcedTextReason: 'incomplete_delivery_continuation',
      maxTokensOverride: params.nextFinalizationMaxTokens,
      incompleteFinalTextRecoveryCount:
        params.recoveryDirectives.incompleteFinalTextRecoveryCount + 1,
      incompleteFinalTextContinuationPrefix: params.fullContent,
    },
  };
}
