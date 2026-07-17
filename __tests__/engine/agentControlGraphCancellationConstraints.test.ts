import {
  createInitialAgentControlGraphSnapshot,
  reduceAgentControlGraph,
} from '../../src/engine/graph/agentControlGraph';

describe('agent control graph cancellation constraint cleanup', () => {
  it('abandons retained user constraint text when the user cancels the run', () => {
    const graph = createInitialAgentControlGraphSnapshot({
      goals: [
        {
          id: 'constrained',
          title: 'Constrained work',
          status: 'completed',
          completionPolicy: 'blocking',
          dependencies: [],
          evidence: [],
          successCriteria: ['evidence.tool:read_file'],
          userConstraints: [{ text: 'Reply in Dutch.', sourceMessageId: 'user-1' }],
          userConstraintDeliveryPending: true,
          createdAt: 1,
          updatedAt: 2,
          completedAt: 2,
        },
      ],
    });

    const cancelled = reduceAgentControlGraph(graph, [
      { type: 'CANCELLED', reason: 'cancelled', timestamp: 3 },
    ]);

    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.goals?.[0]).not.toHaveProperty('userConstraintDeliveryPending');
    expect(cancelled.goals?.[0]).not.toHaveProperty('userConstraints');
    expect(cancelled.goals?.[0]).not.toHaveProperty('userConstraintIntegrity');
  });

  it('abandons incomplete run goals when cancellation settles the intention', () => {
    const graph = createInitialAgentControlGraphSnapshot({
      activeTaskId: 'active',
      goals: [
        {
          id: 'active',
          title: 'Send the message',
          status: 'active',
          completionPolicy: 'blocking',
          dependencies: [],
          evidence: [],
          successCriteria: ['evidence.tool:sms_compose'],
          createdAt: 1,
          updatedAt: 2,
        },
        {
          id: 'complete',
          title: 'Collect message details',
          status: 'completed',
          completionPolicy: 'blocking',
          dependencies: [],
          evidence: ['details supplied'],
          successCriteria: ['evidence.detail:message'],
          createdAt: 1,
          updatedAt: 2,
          completedAt: 2,
        },
      ],
    });

    const cancelled = reduceAgentControlGraph(graph, [
      { type: 'CANCELLED', reason: 'user_approval_denied', timestamp: 3 },
    ]);

    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.activeTaskId).toBeUndefined();
    expect(cancelled.goals?.map((goal) => goal.id)).toEqual(['complete']);
  });
});
