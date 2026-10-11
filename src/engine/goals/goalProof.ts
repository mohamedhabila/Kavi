import type { AgentGoal } from '../../types/agentRun';
import { areBlockingGoalsStructurallyComplete } from './completionEvidence';
import { isBlockingGoal } from './types';

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
