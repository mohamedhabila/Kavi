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
});
