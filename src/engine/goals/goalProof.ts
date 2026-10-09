import type { AgentGoal } from '../../types/agentRun';
import {
  areBlockingGoalsStructurallyComplete,
  describeCriterionSatisfactionAction,
  isSuccessCriterionMet,
  resolveGatingSuccessCriteria,
} from './completionEvidence';
import { isBlockingGoal } from './types';

export type UnmetGoalCriterion = { criterion: string; satisfyBy?: string };

/** The gating criteria a goal's evidence does not meet, each with the action that would. */
export function describeUnmetGatingCriteria(goal: AgentGoal): UnmetGoalCriterion[] {
  const criteria = goal.successCriteria ?? [];
  return (criteria.length > 0 ? resolveGatingSuccessCriteria(criteria) : [])
    .filter((criterion) => !isSuccessCriterionMet(goal, criterion))
    .map((criterion) => {
      const action = describeCriterionSatisfactionAction(criterion);
      return action ? { criterion, satisfyBy: action } : { criterion };
    });
}

/**
 * A blocking goal the model closed that its own success criteria do not prove.
 *
 * Closing a goal is the model's bookkeeping and is never refused, but only proven goals
 * let a run finish as completed; this is the one predicate finalization applies.
 */
export function isBlockingGoalClosedWithoutProof(goal: AgentGoal): boolean {
  return (
    isBlockingGoal(goal) &&
    goal.status === 'completed' &&
    !areBlockingGoalsStructurallyComplete([goal])
  );
}
