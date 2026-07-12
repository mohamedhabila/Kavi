import type { AgentGoal } from './types';
import { isBlockingGoal } from './types';
import {
  arePersistedAgentGoalUserConstraintsCanonical,
  MAX_AGENT_GOAL_USER_CONSTRAINTS,
} from './userConstraints';

export type PendingGoalUserConstraintDelivery =
  | { state: 'absent' }
  | { state: 'canonical'; entries: Array<{ goalId: string; text: string }> }
  | { state: 'conflict' };

/**
 * Reads only constraints whose completed result still has to be delivered.
 * Source identities are validation-only and never leave this boundary.
 */
export function readPendingGoalUserConstraintDelivery(
  goals: ReadonlyArray<AgentGoal> | undefined,
): PendingGoalUserConstraintDelivery {
  if (!goals?.length) return { state: 'absent' };
  const pendingGoals = goals.filter((goal) => goal.userConstraintDeliveryPending === true);
  if (pendingGoals.length === 0) return { state: 'absent' };

  const entries: Array<{ goalId: string; text: string }> = [];
  const sourceTexts = new Map<string, string>();
  for (const goal of pendingGoals) {
    const stored = (goal as AgentGoal & { userConstraints?: unknown }).userConstraints;
    if (
      goal.userConstraintIntegrity === 'conflict' ||
      goal.status !== 'completed' ||
      !isBlockingGoal(goal) ||
      !arePersistedAgentGoalUserConstraintsCanonical(stored)
    ) {
      return { state: 'conflict' };
    }

    for (const constraint of stored) {
      const existingText = sourceTexts.get(constraint.sourceMessageId);
      if (existingText !== undefined && existingText !== constraint.text) {
        return { state: 'conflict' };
      }
      sourceTexts.set(constraint.sourceMessageId, constraint.text);
      entries.push({ goalId: goal.id, text: constraint.text });
    }
  }

  if (entries.length === 0 || entries.length > MAX_AGENT_GOAL_USER_CONSTRAINTS) {
    return { state: 'conflict' };
  }
  return { state: 'canonical', entries };
}
