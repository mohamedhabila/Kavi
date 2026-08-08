// ---------------------------------------------------------------------------
// Kavi — Goal completion refusal messaging
// ---------------------------------------------------------------------------
// A validation refusal is a prompt the model reads. Refusing a completion with
// only "structural evidence requirements are met" gave the model nothing to act
// on, so a goal whose work was already done but whose evidence did not match
// produced repeated update_goals calls until loop detection ended the run.
//
// These messages name which criteria are unmet and the action that records each,
// matching the convention every other refusal in this package already follows.
// ---------------------------------------------------------------------------

import {
  describeCriterionSatisfactionAction,
  isSuccessCriterionMet,
  resolveGatingSuccessCriteria,
} from './completionEvidence';
import { createGoal, type AgentGoal } from './types';

const NO_CRITERIA_MESSAGE =
  'Cannot complete a goal before structural evidence requirements are met. This goal has no successCriteria and no recorded evidence; record a tool result for the work, or add a specific criterion with update_goals.';

const GENERIC_MESSAGE = 'Cannot complete a goal before structural evidence requirements are met.';

/**
 * Success criteria of `goal` that the supplied evidence does not satisfy and that
 * actually hold completion.
 *
 * Only gating criteria belong here. A bare count names no action that satisfies it —
 * `describeCriterionSatisfactionAction` returns null — so listing one fell through to
 * "Record a tool result that satisfies it before completing", which is an instruction to
 * run more tools with nothing to say about which. That is how a goal whose real work was
 * finished came to rewrite its artifact and invent a second one to raise a number.
 */
export function findUnmetCompletionCriteria(
  goal: Pick<AgentGoal, 'id' | 'title' | 'evidence' | 'successCriteria'>,
  extraEvidence: ReadonlyArray<string> = [],
): string[] {
  const criteria = resolveGatingSuccessCriteria(goal.successCriteria ?? []);
  if (criteria.length === 0) return [];

  const evidence = extraEvidence.length
    ? Array.from(new Set([...goal.evidence, ...extraEvidence]))
    : goal.evidence;
  const hypothetical = createGoal({
    id: goal.id,
    title: goal.title,
    status: 'completed',
    evidence,
    successCriteria: [...criteria],
  });
  return criteria.filter((criterion) => !isSuccessCriterionMet(hypothetical, criterion));
}

/**
 * Builds the refusal shown when a goal cannot be completed yet, naming the unmet
 * criteria and the concrete action that records each.
 */
export function buildUnmetCompletionRequirementMessage(
  goal: Pick<AgentGoal, 'id' | 'title' | 'evidence' | 'successCriteria'>,
  extraEvidence: ReadonlyArray<string> = [],
): string {
  if ((goal.successCriteria ?? []).length === 0) {
    return NO_CRITERIA_MESSAGE;
  }

  const unmet = findUnmetCompletionCriteria(goal, extraEvidence);
  if (unmet.length === 0) {
    return GENERIC_MESSAGE;
  }

  const actions = Array.from(
    new Set(
      unmet
        .map((criterion) => describeCriterionSatisfactionAction(criterion))
        .filter((action): action is string => Boolean(action)),
    ),
  );
  const actionSentence =
    actions.length > 0
      ? ` To record it: ${actions.join('; ')}.`
      : ' Record a tool result that satisfies it before completing.';

  return `Cannot complete this goal yet. Unmet criteria: ${unmet.join(', ')}.${actionSentence} Repeating update_goals does not record evidence.`;
}
