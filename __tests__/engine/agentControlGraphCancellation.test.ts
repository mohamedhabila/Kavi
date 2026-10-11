import {
  createInitialAgentControlGraphSnapshot,
  reduceAgentControlGraph,
} from '../../src/engine/graph/agentControlGraph';

describe('agent control graph cancellation', () => {
  it('releases the active task when cancellation settles the intention', () => {
    const graph = createInitialAgentControlGraphSnapshot({
      activeTaskId: 'active',
      plan: [{ step: 'Send the message', status: 'in_progress' }],
    });

    const cancelled = reduceAgentControlGraph(graph, [
      { type: 'CANCELLED', reason: 'user_approval_denied', timestamp: 3 },
    ]);

    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.activeTaskId).toBeUndefined();
    expect(cancelled.plan).toEqual([{ step: 'Send the message', status: 'in_progress' }]);
  });
});
