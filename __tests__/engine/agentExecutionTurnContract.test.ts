import { resolveAgentExecutionTurnContract } from '../../src/engine/graph/agentExecutionTurnContract';

describe('resolveAgentExecutionTurnContract', () => {
  it('does not enable session coordination without a grounded session tool', () => {
    const contract = resolveAgentExecutionTurnContract({
      groundedToolNames: ['update_goals', 'read_file'],
    });

    expect(contract.allowSessionCoordinationTools).toBe(false);
  });

  it('does not classify the local elapsed-time wait as session coordination', () => {
    const contract = resolveAgentExecutionTurnContract({
      groundedToolNames: ['wait'],
    });

    expect(contract.allowSessionCoordinationTools).toBe(false);
  });

  it('enables session coordination when the grounded surface contains a session tool', () => {
    const contract = resolveAgentExecutionTurnContract({
      groundedToolNames: ['sessions_spawn', 'update_goals'],
    });

    expect(contract.allowSessionCoordinationTools).toBe(true);
  });

  it('admits a structurally activated follow-up tool without prompt-language hints', () => {
    const contract = resolveAgentExecutionTurnContract({
      groundedToolNames: ['web_search', 'sessions_send'],
    });

    expect(contract.allowSessionCoordinationTools).toBe(true);
  });
});
