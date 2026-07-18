import { createGoal } from '../../src/engine/goals/types';
import {
  buildMobileControllerGoalAdmissionBlock,
  hasGraphAnchoredMobileControllerGoal,
} from '../../src/engine/mobileController/goalAdmission';

function anchoredGoal() {
  return createGoal({
    id: 'mobile-goal',
    title: 'Complete the requested device task',
    status: 'active',
    completionPolicy: 'blocking',
    successCriteria: ['evidence.tool:mobile_ui_action'],
    userConstraints: [
      {
        text: 'Update the device according to my request.',
        sourceMessageId: 'user-message-1',
      },
    ],
    now: 100,
  });
}

describe('mobile controller goal admission', () => {
  it('admits an active blocking goal anchored to user evidence and a success condition', () => {
    expect(hasGraphAnchoredMobileControllerGoal([anchoredGoal()])).toBe(true);
    expect(buildMobileControllerGoalAdmissionBlock([anchoredGoal()])).toBeUndefined();
  });

  it.each([
    ['no goal', []],
    ['pending goal', [{ ...anchoredGoal(), status: 'pending' as const }]],
    [
      'persistent goal',
      [{ ...anchoredGoal(), completionPolicy: 'persistent' as const, successCriteria: undefined }],
    ],
    ['missing success condition', [{ ...anchoredGoal(), successCriteria: undefined }]],
    ['unstructured success condition', [{ ...anchoredGoal(), successCriteria: ['Looks done'] }]],
    ['count-only success condition', [{ ...anchoredGoal(), successCriteria: ['evidence.min:1'] }]],
    ['missing user constraint', [{ ...anchoredGoal(), userConstraints: undefined }]],
    [
      'conflicting user constraint',
      [{ ...anchoredGoal(), userConstraintIntegrity: 'conflict' as const }],
    ],
  ])('rejects %s', (_label, goals) => {
    expect(hasGraphAnchoredMobileControllerGoal(goals)).toBe(false);
    expect(JSON.parse(buildMobileControllerGoalAdmissionBlock(goals) ?? '{}')).toMatchObject({
      status: 'error',
      code: 'mobile_controller_goal_required',
      tool: 'mobile_ui_action',
      repair: {
        retryable: true,
        tool: 'update_goals',
        requiredGoal: {
          status: 'active',
          completionPolicy: 'blocking',
          retainCurrentUserConstraint: true,
          minimumSuccessCriteria: 1,
          specificStructuralCriterionRequired: true,
        },
      },
    });
  });
});
