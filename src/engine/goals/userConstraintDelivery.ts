import type { AgentGoal } from './types';
import { arePersistedAgentGoalUserConstraintsCanonical } from './userConstraints';

export function acknowledgeGoalUserConstraintDelivery(
  goals: ReadonlyArray<AgentGoal> | undefined,
): AgentGoal[] | undefined {
  if (!goals) return undefined;
  return goals.map((goal) => {
    if (
      goal.userConstraintDeliveryPending !== true ||
      goal.userConstraintIntegrity === 'conflict' ||
      !arePersistedAgentGoalUserConstraintsCanonical(goal.userConstraints)
    ) {
      return goal;
    }
    const acknowledged = { ...goal };
    delete acknowledged.userConstraintDeliveryPending;
    delete acknowledged.userConstraints;
    return acknowledged;
  });
}

export function abandonGoalUserConstraintDelivery(
  goals: ReadonlyArray<AgentGoal> | undefined,
): AgentGoal[] | undefined {
  if (!goals) return undefined;
  return goals.map((goal) => {
    const abandoned = { ...goal };
    delete abandoned.userConstraintDeliveryPending;
    delete abandoned.userConstraints;
    delete abandoned.userConstraintIntegrity;
    return abandoned;
  });
}
