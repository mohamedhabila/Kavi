import {
  normalizeAgentRunControlGraphGoals,
  normalizeAgentRunControlGraphToolResultRefs,
} from '../../../src/services/agents/agentControlGraphState';

describe('normalizeAgentRunControlGraphGoals', () => {
  it('preserves success criteria and blocked reason on graph-owned goals', () => {
    const goals = normalizeAgentRunControlGraphGoals([
      {
        id: 'g1',
        title: 'Verify calendar',
        status: 'active',
        dependencies: [],
        evidence: ['calendar_list:[{"allowsModifications":true}]'],
        successCriteria: ['evidence.json_field:allowsModifications:true'],
        blockedReason: 'gate:g1:evidence.min:1',
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    expect(goals).toEqual([
      expect.objectContaining({
        id: 'g1',
        successCriteria: ['evidence.json_field:allowsModifications:true'],
        blockedReason: 'gate:g1:evidence.min:1',
      }),
    ]);
  });
});

describe('a run persisted before user constraints were removed', () => {
  it('loads its goals with the constraint fields dropped', () => {
    const [goal] = normalizeAgentRunControlGraphGoals([
      {
        id: 'done',
        title: 'Completed constrained goal',
        status: 'completed',
        completionPolicy: 'blocking',
        dependencies: [],
        evidence: [],
        successCriteria: ['evidence.tool:read_file'],
        userConstraints: [{ text: 'Reply in Dutch.', sourceMessageId: 'user-1' }],
        userConstraintIntegrity: 'conflict',
        userConstraintDeliveryPending: true,
        createdAt: 1,
        updatedAt: 1,
      } as never,
    ]);

    expect(goal).toMatchObject({ id: 'done', status: 'completed' });
    expect(goal).not.toHaveProperty('userConstraints');
    expect(goal).not.toHaveProperty('userConstraintIntegrity');
    expect(goal).not.toHaveProperty('userConstraintDeliveryPending');
  });
});

describe('normalizeAgentRunControlGraphToolResultRefs', () => {
  it('preserves canonicalization trace flags on observed tool results', () => {
    const results = normalizeAgentRunControlGraphToolResultRefs([
      {
        id: 'tc-goals',
        name: 'update_goals',
        canonicalized: true,
        graphApplied: true,
      },
      {
        id: 'tc-raw',
        name: 'read_file',
        canonicalized: false,
        graphApplied: false,
      },
    ]);

    expect(results).toEqual([
      {
        id: 'tc-goals',
        name: 'update_goals',
        canonicalized: true,
        graphApplied: true,
      },
      {
        id: 'tc-raw',
        name: 'read_file',
      },
    ]);
  });
});
