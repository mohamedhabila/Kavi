import type { AgentGoal } from '../../types/agentRun';
import type { AssistantCompletionMetadata } from '../../types/message';
import {
  buildIncompleteTextContinuationNote,
  shouldResumeIncompleteFinalTextTurn,
} from '../../services/llm/support/completionRecovery';
import {
  buildMissingRequiredEvidenceLabels,
  evaluateGoalEvidenceGaps,
  type GoalEvidenceGap,
} from '../goals/completionEvidence';
import { isBlockingGoal } from '../goals/types';
import type { ToolCallRecord } from '../loopDetection';
import type { AgentControlTurnDirectives } from './agentControlGraph';
import {
  buildDelegationEvidenceAutoCompleteEvent,
  buildEvidenceSatisfiedGoalAutoCompleteEvent,
  findEvidenceSatisfiedGoals,
} from './completionGateGoalAutoComplete';
import type { CompletionGateDecision } from './completionGateTypes';
import { renderGoalFocusLines, renderPendingGoalFocusLines } from './goalFocusPrompt';
import { extractRecentToolRepairHints } from './toolRepairHints';

function hasIncompleteGoals(goals: ReadonlyArray<AgentGoal>): boolean {
  return goals.some(
    (goal) => isBlockingGoal(goal) && (goal.status === 'active' || goal.status === 'pending'),
  );
}

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
  if (
    !params.toolingEnabledForProvider ||
    params.selectedToolCount <= 0 ||
    params.forceTextThisTurn
  ) {
    return null;
  }

  const gaps = evaluateGoalEvidenceGaps(params.goals.filter(isBlockingGoal));
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

  if (
    !params.toolingEnabledForProvider ||
    params.selectedToolCount <= 0 ||
    params.forceTextThisTurn ||
    !hasIncompleteGoals(params.goals)
  ) {
    return null;
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
