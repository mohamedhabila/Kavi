import { applyGoalMutation } from '../goals/graphState';
import {
  areGoalSuccessCriteriaSatisfied,
  isSuccessCriterionMet,
} from '../goals/completionEvidence';
import { isBlockingGoal, type AgentGoal } from '../goals/types';
import type { AgentControlGraphEvent } from './agentControlGraph';

export const DELEGATION_WORKER_EVIDENCE_PREFIX_CRITERION = 'evidence.prefix:worker';

export function findDelegationEvidenceSatisfiedGoals(
  goals: ReadonlyArray<AgentGoal>,
): ReadonlyArray<AgentGoal> {
  return goals.filter((goal) => {
    if (!isBlockingGoal(goal)) {
      return false;
    }
    if (goal.status !== 'active' && goal.status !== 'blocked') {
      return false;
    }
    if (!(goal.successCriteria ?? []).includes(DELEGATION_WORKER_EVIDENCE_PREFIX_CRITERION)) {
      return false;
    }
    if (!areGoalSuccessCriteriaSatisfied(goal)) {
      return false;
    }
    return isSuccessCriterionMet(goal, DELEGATION_WORKER_EVIDENCE_PREFIX_CRITERION);
  });
}

export function findEvidenceSatisfiedGoals(
  goals: ReadonlyArray<AgentGoal>,
): ReadonlyArray<AgentGoal> {
  return goals.filter(
    (goal) =>
      isBlockingGoal(goal) &&
      (goal.status === 'active' || goal.status === 'blocked') &&
      (goal.successCriteria?.length ?? 0) > 0 &&
      areGoalSuccessCriteriaSatisfied(goal),
  );
}

export function buildEvidenceSatisfiedGoalAutoCompleteEvent(params: {
  goals: ReadonlyArray<AgentGoal>;
  goalIds: ReadonlyArray<string>;
  now?: number;
}): AgentControlGraphEvent | null {
  const timestamp = params.now ?? Date.now();
  const { goals: nextGoals, errors } = applyGoalMutation(
    params.goals,
    {
      action: 'complete',
      goals: params.goalIds.map((id) => ({ id })),
    },
    timestamp,
  );
  if (errors.length > 0) {
    return null;
  }

  return {
    type: 'GOALS_UPDATED',
    goals: nextGoals,
    reason: 'completion_gate:auto_complete',
    timestamp,
  };
}

export function buildDelegationEvidenceAutoCompleteEvent(params: {
  goals: ReadonlyArray<AgentGoal>;
  now?: number;
}): AgentControlGraphEvent | null {
  const delegationGoals = findDelegationEvidenceSatisfiedGoals(params.goals);
  if (delegationGoals.length === 0) {
    return null;
  }

  return buildEvidenceSatisfiedGoalAutoCompleteEvent({
    goals: params.goals,
    goalIds: delegationGoals.map((goal) => goal.id),
    now: params.now,
  });
}
