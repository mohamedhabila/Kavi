import { createGoal, type AgentGoal } from '../../src/engine/goals/types';
import {
  buildMobileControllerGoalAdmissionBlock,
  hasGraphAnchoredMobileControllerGoal,
  materializeMobileControllerGoal,
  MOBILE_CONTROLLER_GOAL_OWNER,
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

describe('materializeMobileControllerGoal', () => {
  it('admits the first mobile_ui_action call by opening a code-owned goal from the call itself', () => {
    const result = materializeMobileControllerGoal({
      toolCalls: [
        {
          name: 'mobile_ui_action',
          arguments: JSON.stringify({ kind: 'open_app', appId: 'com.example.calendar' }),
        },
      ],
      goals: [],
    });

    expect(result.status).toBe('materialized');
    const goal = result.goals.find((entry) => entry.owner === MOBILE_CONTROLLER_GOAL_OWNER);
    expect(goal).toBeDefined();
    expect(goal?.status).toBe('active');
    expect(goal?.completionPolicy).toBe('blocking');
    expect(goal?.successCriteria).toEqual(['evidence.tool:mobile_ui_action']);
    expect(goal?.title).toContain('com.example.calendar');

    // The call is admitted on the strength of the goal this materialized, with no
    // rejection and no model-authored `update_goals` round trip.
    expect(hasGraphAnchoredMobileControllerGoal(result.goals)).toBe(true);
    expect(buildMobileControllerGoalAdmissionBlock(result.goals)).toBeUndefined();
  });

  it('is a no-op when the batch has no mobile_ui_action call', () => {
    const result = materializeMobileControllerGoal({
      toolCalls: [{ name: 'web_search', arguments: '{}' }],
      goals: [],
    });

    expect(result).toEqual({ status: 'unchanged', goals: [] });
  });

  it('is a no-op when a goal already admits the call', () => {
    const goals: AgentGoal[] = [anchoredGoal()];

    const result = materializeMobileControllerGoal({
      toolCalls: [{ name: 'mobile_ui_action', arguments: JSON.stringify({ kind: 'back' }) }],
      goals,
    });

    expect(result.status).toBe('unchanged');
    expect(result.goals).toHaveLength(1);
  });

  it('does not open a second code-owned goal for a later call in the same run', () => {
    const first = materializeMobileControllerGoal({
      toolCalls: [{ name: 'mobile_ui_action', arguments: JSON.stringify({ kind: 'back' }) }],
      goals: [],
    });

    const second = materializeMobileControllerGoal({
      toolCalls: [{ name: 'mobile_ui_action', arguments: JSON.stringify({ kind: 'home' }) }],
      goals: first.goals,
    });

    expect(second.status).toBe('unchanged');
    expect(second.goals.filter((goal) => goal.owner === MOBILE_CONTROLLER_GOAL_OWNER)).toHaveLength(
      1,
    );
  });

  it('never touches a goal the model owns', () => {
    const modelGoal: AgentGoal = {
      id: 'user-goal',
      title: 'Book the flight the user asked for',
      status: 'active',
      dependencies: [],
      evidence: [],
      createdAt: 1,
      updatedAt: 1,
      completionPolicy: 'blocking',
      successCriteria: ['evidence.tool:web_fetch'],
    };

    const result = materializeMobileControllerGoal({
      toolCalls: [{ name: 'mobile_ui_action', arguments: JSON.stringify({ kind: 'back' }) }],
      goals: [modelGoal],
    });

    expect(result.status).toBe('materialized');
    expect(result.goals.find((goal) => goal.id === 'user-goal')).toEqual(modelGoal);
  });
});
