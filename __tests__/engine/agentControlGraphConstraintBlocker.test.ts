import {
  createInitialAgentControlGraphSnapshot,
  getAgentControlGraphModelTurnBlocker,
  selectAgentControlGraphRuntimeCommand,
} from '../../src/engine/graph/agentControlGraph';
import { createGoal } from '../../src/engine/goals/types';

describe('agent control graph constraint integrity barrier', () => {
  const conflictedGoal = {
    ...createGoal({
      id: 'local-report',
      title: 'Create local report',
      status: 'active',
      completionPolicy: 'blocking',
      successCriteria: ['evidence.tool:read_file'],
      now: 1,
    }),
    userConstraintIntegrity: 'conflict' as const,
  };

  it('blocks live constraint conflicts before model or tool execution', () => {
    const snapshot = createInitialAgentControlGraphSnapshot({ goals: [conflictedGoal] });

    expect(getAgentControlGraphModelTurnBlocker(snapshot)).toContain(
      'conflicted user constraint state',
    );
    expect(selectAgentControlGraphRuntimeCommand(snapshot)).toMatchObject({
      type: 'blocked',
      reason: expect.stringContaining('local-report'),
    });
  });

  it('blocks delivery-pending completed conflicts but ignores acknowledged completed goals', () => {
    const deliveryPending = createInitialAgentControlGraphSnapshot({
      goals: [
        {
          ...conflictedGoal,
          status: 'completed',
          userConstraintDeliveryPending: true,
        },
      ],
    });
    expect(getAgentControlGraphModelTurnBlocker(deliveryPending)).toContain(
      'conflicted user constraint state',
    );

    const settled = createInitialAgentControlGraphSnapshot({
      goals: [
        createGoal({
          id: 'settled-report',
          title: 'Settled report',
          status: 'completed',
          completionPolicy: 'blocking',
          successCriteria: ['evidence.tool:read_file'],
          now: 2,
        }),
      ],
    });
    expect(getAgentControlGraphModelTurnBlocker(settled)).toBeUndefined();
    expect(selectAgentControlGraphRuntimeCommand(settled).type).toBe('start_model_turn');
  });
});
