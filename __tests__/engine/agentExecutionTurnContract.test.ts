import { resolveAgentExecutionTurnContract } from '../../src/engine/graph/agentExecutionTurnContract';
import type { AgentGoal } from '../../src/engine/goals/types';

const tools = [
  { name: 'web_search', description: 'Search', contract: { capabilities: ['discover'] } },
  { name: 'sessions_spawn', description: 'Spawn', contract: { capabilities: ['coordinate'] } },
  { name: 'update_goals', description: 'Goals', contract: { capabilities: ['coordinate'] } },
];

describe('resolveAgentExecutionTurnContract', () => {
  it('does not enable session coordination for bootstrap surfaces without session tools', () => {
    const contract = resolveAgentExecutionTurnContract({
      goals: [],
      tools,
      groundedToolNames: ['update_goals', 'read_file'],
    });

    expect(contract.allowSessionCoordinationTools).toBe(false);
  });

  it('does not enable session coordination for non-session goal capabilities', () => {
    const goals: AgentGoal[] = [
      {
        id: 'goal-1',
        title: 'Research',
        status: 'active',
        dependencies: [],
        evidence: [],
        createdAt: 1,
        updatedAt: 1,
        requiredCapabilities: ['discover'],
      },
    ];

    const contract = resolveAgentExecutionTurnContract({
      goals,
      tools,
      groundedToolNames: ['web_search', 'read_file'],
    });

    expect(contract.allowSessionCoordinationTools).toBe(false);
  });

  it('enables session coordination when a graph-selected surface contains session tools', () => {
    const goals: AgentGoal[] = [
      {
        id: 'goal-1',
        title: 'Delegate',
        status: 'active',
        dependencies: [],
        evidence: [],
        createdAt: 1,
        updatedAt: 1,
        requiredCapabilities: ['coordinate'],
      },
    ];

    const contract = resolveAgentExecutionTurnContract({
      goals,
      tools,
      groundedToolNames: ['sessions_spawn', 'update_goals'],
    });

    expect(contract.allowSessionCoordinationTools).toBe(true);
  });
});
