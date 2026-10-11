import type { AgentGoal } from '../../src/engine/goals/types';
import {
  materializeMobileControllerGoal,
  MOBILE_CONTROLLER_GOAL_OWNER,
} from '../../src/engine/mobileController/goalAdmission';

describe('materializeMobileControllerGoal', () => {
  it('opens a code-owned goal from the first mobile_ui_action call itself', () => {
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
  });

  it('is a no-op when the batch has no mobile_ui_action call', () => {
    const result = materializeMobileControllerGoal({
      toolCalls: [{ name: 'web_search', arguments: '{}' }],
      goals: [],
    });

    expect(result).toEqual({ status: 'unchanged', goals: [] });
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
