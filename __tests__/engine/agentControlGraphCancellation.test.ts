import {
  createInitialAgentControlGraphSnapshot,
  reduceAgentControlGraph,
} from '../../src/engine/graph/agentControlGraph';

describe('agent control graph cancellation', () => {
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
