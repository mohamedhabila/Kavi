import type { AgentGoal } from '../goals/types';
import { isBlockingGoal } from '../goals/types';
import { arePersistedAgentGoalUserConstraintsCanonical } from '../goals/userConstraints';
import {
  isCountOnlySuccessCriterion,
  isRecognizedSuccessCriterionForm,
} from '../goals/completionEvidence';
import { MOBILE_UI_ACTION_TOOL_NAME } from './contracts';

function hasSpecificStructuralSuccessCondition(goal: AgentGoal): boolean {
  const criteria = goal.successCriteria ?? [];
  return (
    criteria.length > 0 &&
    criteria.every(isRecognizedSuccessCriterionForm) &&
    criteria.some((criterion) => !isCountOnlySuccessCriterion(criterion))
  );
}

export function hasGraphAnchoredMobileControllerGoal(
  goals: ReadonlyArray<AgentGoal> | undefined,
): boolean {
  return (goals ?? []).some(
    (goal) =>
      goal.status === 'active' &&
      isBlockingGoal(goal) &&
      hasSpecificStructuralSuccessCondition(goal) &&
      goal.userConstraintIntegrity !== 'conflict' &&
      arePersistedAgentGoalUserConstraintsCanonical(goal.userConstraints),
  );
}

export function buildMobileControllerGoalAdmissionBlock(
  goals: ReadonlyArray<AgentGoal> | undefined,
): string | undefined {
  if (hasGraphAnchoredMobileControllerGoal(goals)) return undefined;

  return JSON.stringify({
    status: 'error',
    code: 'mobile_controller_goal_required',
    tool: MOBILE_UI_ACTION_TOOL_NAME,
    repair: {
      retryable: true,
      code: 'mobile_controller_goal_required',
      tool: 'update_goals',
      requiredGoal: {
        status: 'active',
        completionPolicy: 'blocking',
        retainCurrentUserConstraint: true,
        minimumSuccessCriteria: 1,
        specificStructuralCriterionRequired: true,
      },
    },
    message:
      'Before using mobile_ui_action, call update_goals in a separate turn to create or update an active blocking goal with at least one recognized, non-count-only structural success criterion and retainCurrentUserConstraint:true.',
  });
}
