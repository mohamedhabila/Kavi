import { isBlockingGoal, type AgentGoal } from '../../engine/goals/types';
import {
  arePersistedAgentGoalUserConstraintsCanonical,
  MAX_AGENT_GOAL_USER_CONSTRAINTS,
} from '../../engine/goals/userConstraints';
import type {
  RequestUnderstandingBoundedList,
  RequestUnderstandingConflict,
  RequestUnderstandingField,
  RequestUnderstandingUserConstraint,
} from '../../types/requestUnderstanding';

function liveGoals(goals: ReadonlyArray<AgentGoal>): AgentGoal[] {
  const priority: Record<'active' | 'blocked' | 'pending', number> = {
    active: 0,
    blocked: 1,
    pending: 2,
  };
  return goals
    .map((goal, index) => ({ goal, index }))
    .filter(
      (
        entry,
      ): entry is {
        goal: AgentGoal & { status: 'active' | 'blocked' | 'completed' | 'pending' };
        index: number;
      } =>
        entry.goal.status === 'active' ||
        entry.goal.status === 'blocked' ||
        entry.goal.status === 'pending' ||
        (entry.goal.status === 'completed' && entry.goal.userConstraintDeliveryPending === true),
    )
    .sort(
      (left, right) =>
        (left.goal.status === 'completed' ? 3 : priority[left.goal.status]) -
          (right.goal.status === 'completed' ? 3 : priority[right.goal.status]) ||
        left.index - right.index,
    )
    .map((entry) => entry.goal);
}

export function projectRequestUnderstandingUserConstraints(
  goals: ReadonlyArray<AgentGoal> | undefined,
  goalConflict: RequestUnderstandingConflict | undefined,
): RequestUnderstandingField<RequestUnderstandingBoundedList<RequestUnderstandingUserConstraint>> {
  if (goalConflict) return goalConflict;
  if (!goals) return { status: 'unknown', reason: 'goal_state_unavailable' };
  const live = liveGoals(goals);
  if (live.length === 0) return { status: 'unknown', reason: 'no_declared_goal' };

  const constraints: RequestUnderstandingUserConstraint[] = [];
  const seen = new Set<string>();
  for (const goal of live) {
    if (goal.userConstraintIntegrity === 'conflict') {
      return { status: 'conflict', reason: 'user_constraint_state_conflict' };
    }
    const stored = (goal as AgentGoal & { userConstraints?: unknown }).userConstraints;
    if (stored === undefined) continue;
    if (!isBlockingGoal(goal) || !arePersistedAgentGoalUserConstraintsCanonical(stored)) {
      return { status: 'conflict', reason: 'user_constraint_state_conflict' };
    }
    for (const candidate of stored) {
      const key = JSON.stringify([goal.id, candidate.text]);
      if (seen.has(key)) {
        return { status: 'conflict', reason: 'user_constraint_state_conflict' };
      }
      seen.add(key);
      constraints.push({ goalId: goal.id, text: candidate.text });
    }
  }
  if (constraints.length > MAX_AGENT_GOAL_USER_CONSTRAINTS) {
    return { status: 'conflict', reason: 'user_constraint_state_conflict' };
  }
  if (constraints.length === 0) return { status: 'unknown', reason: 'not_structured' };
  return {
    status: 'known',
    source: 'graph_goal',
    value: {
      items: constraints.slice(0, MAX_AGENT_GOAL_USER_CONSTRAINTS),
      omittedCount: Math.max(0, constraints.length - MAX_AGENT_GOAL_USER_CONSTRAINTS),
    },
  };
}
