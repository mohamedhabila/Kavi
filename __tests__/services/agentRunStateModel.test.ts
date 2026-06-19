import {
  createDefaultAgentRunPlan,
  createInitialAgentRunPhases,
  mergeAgentRunSummary,
  skipRemainingAgentRunPhases,
  transitionAgentRunPhases,
} from '../../src/services/agents/agentRunStateModel';

describe('agentRunStateModel', () => {
  it('creates default plans with stable success criteria and stop conditions', () => {
    expect(createDefaultAgentRunPlan('  Ship the feature  ', 10, '  raw plan  ')).toEqual({
      objective: 'Ship the feature',
      successCriteria: [
        'Produce the requested deliverable.',
        'Verify the result before finalizing.',
      ],
      stopConditions: [
        'Stop when the deliverable is complete and the success criteria are satisfied.',
        'Stop early if a concrete blocker, missing permission, or dependency prevents further progress.',
      ],
      workstreams: [],
      rawPlan: 'raw plan',
      updatedAt: 10,
    });
  });

  it('merges run summary patches onto stable defaults', () => {
    expect(mergeAgentRunSummary(undefined, { startedTools: 2, failedTools: 1 })).toEqual({
      assistantTurns: 0,
      startedTools: 2,
      completedTools: 0,
      failedTools: 1,
      spawnedSubAgents: 0,
      durationMs: undefined,
    });
  });

  it('transitions phases forward and optionally allows work regression', () => {
    const initialPhases = createInitialAgentRunPhases(1);
    const reviewPhases = transitionAgentRunPhases(
      initialPhases,
      'review',
      'active',
      2,
      'Reviewing output',
    );

    expect(reviewPhases.find((phase) => phase.key === 'assess')?.status).toBe('completed');
    expect(reviewPhases.find((phase) => phase.key === 'plan')?.status).toBe('completed');
    expect(reviewPhases.find((phase) => phase.key === 'work')?.status).toBe('completed');
    expect(reviewPhases.find((phase) => phase.key === 'review')).toEqual(
      expect.objectContaining({
        status: 'active',
        detail: 'Reviewing output',
      }),
    );

    const regressedPhases = transitionAgentRunPhases(
      reviewPhases,
      'work',
      'active',
      3,
      'Resumed execution',
      { allowRegression: true },
    );

    expect(regressedPhases.find((phase) => phase.key === 'work')).toEqual(
      expect.objectContaining({
        status: 'active',
        detail: 'Resumed execution',
      }),
    );
    expect(regressedPhases.find((phase) => phase.key === 'review')?.status).toBe('completed');
  });

  it('skips later pending phases after terminalization', () => {
    const initialPhases = createInitialAgentRunPhases(1);
    const reviewPhases = transitionAgentRunPhases(
      initialPhases,
      'review',
      'active',
      2,
      'Reviewing output',
    );
    const skipped = skipRemainingAgentRunPhases(reviewPhases, 'review', 3);

    expect(skipped.find((phase) => phase.key === 'deliver')?.status).toBe('skipped');
    expect(skipped.find((phase) => phase.key === 'pilot')?.status).toBe('skipped');
  });
});
