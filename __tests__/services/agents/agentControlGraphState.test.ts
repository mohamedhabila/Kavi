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
