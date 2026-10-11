import {
  normalizeAgentRunControlGraphState,
  normalizeAgentRunControlGraphToolResultRefs,
} from '../../../src/services/agents/agentControlGraphState';
import type { AgentRunControlGraphState } from '../../../src/types/agentRun';

describe('a run persisted while the graph still kept goals', () => {
  it('loads with its goals and goal evidence dropped and everything else kept', () => {
    const persisted = {
      status: 'awaiting_tool_results',
      iteration: 3,
      activeTaskId: 'research',
      plan: [{ step: 'Read the report', status: 'in_progress' }],
      goals: [
        {
          id: 'effect-write',
          title: 'Verify write_file effect',
          status: 'active',
          completionPolicy: 'blocking',
          successCriteria: ['evidence.effect:artifact.write'],
          dependencies: [],
          evidence: ['effect_receipt_v2:abc'],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      observedToolResults: [
        { id: 'tc-1', name: 'write_file', evidence: ['effect_receipt_v2:abc'], failed: true },
      ],
      audit: [{ type: 'GOALS_UPDATED', timestamp: 5, detail: 'effect_completion_contract' }],
      updatedAt: 9,
    } as unknown as Partial<AgentRunControlGraphState>;

    const state = normalizeAgentRunControlGraphState(persisted);

    expect(state).not.toHaveProperty('goals');
    expect(state).toMatchObject({
      status: 'awaiting_tool_results',
      iteration: 3,
      activeTaskId: 'research',
      plan: [{ step: 'Read the report', status: 'in_progress' }],
      observedToolResults: [{ id: 'tc-1', name: 'write_file', failed: true }],
      updatedAt: 9,
    });
    expect(state?.observedToolResults[0]).not.toHaveProperty('evidence');
  });
});

describe('normalizeAgentRunControlGraphToolResultRefs', () => {
  it('preserves canonicalization trace flags on observed tool results', () => {
    const results = normalizeAgentRunControlGraphToolResultRefs([
      {
        id: 'tc-plan',
        name: 'update_plan',
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
        id: 'tc-plan',
        name: 'update_plan',
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
