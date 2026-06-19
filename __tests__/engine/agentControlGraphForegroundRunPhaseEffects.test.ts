import {
  buildForegroundAgentRunCompletionEffect,
  buildForegroundAgentRunReviewPhaseEffect,
  buildForegroundAgentRunSummaryPatch,
  buildForegroundAgentRunWorkPhaseEffect,
} from '../../src/engine/graph/foregroundRunPhaseEffects';

describe('agent control graph foreground run phase effects', () => {
  const counters = {
    assistantTurns: 2,
    startedTools: 3,
    completedTools: 2,
    failedTools: 1,
    spawnedSubAgents: 1,
    runStartedAt: 1000,
  };

  it('builds a graph-owned work phase effect with a single initial checkpoint', () => {
    expect(
      buildForegroundAgentRunWorkPhaseEffect({
        detail: 'Launching delegated work',
        checkpointTitle: 'Delegated work launch started',
        hasEnteredPhase: false,
      }),
    ).toEqual({
      phase: 'work',
      latestSummary: 'Launching delegated work',
      params: {
        status: 'active',
        detail: 'Launching delegated work',
        checkpointTitle: 'Delegated work launch started',
        checkpointDetail: 'Launching delegated work',
        allowRegression: true,
      },
    });

    expect(
      buildForegroundAgentRunWorkPhaseEffect({
        detail: 'Monitoring delegated work',
        checkpointTitle: 'Delegated work monitoring active',
        hasEnteredPhase: true,
      }).params.checkpointTitle,
    ).toBeUndefined();
  });

  it('builds summary and completion patches from runtime counters', () => {
    expect(buildForegroundAgentRunSummaryPatch(counters, 'Monitoring delegated work')).toEqual({
      assistantTurns: 2,
      startedTools: 3,
      completedTools: 2,
      failedTools: 1,
      spawnedSubAgents: 1,
      latestSummary: 'Monitoring delegated work',
    });

    expect(
      buildForegroundAgentRunReviewPhaseEffect({
        detail: 'Reviewing workflow evidence',
        hasEnteredPhase: false,
      }),
    ).toEqual({
      phase: 'review',
      latestSummary: 'Reviewing workflow evidence',
      params: {
        status: 'active',
        detail: 'Reviewing workflow evidence',
        checkpointTitle: 'Review started',
        checkpointDetail: 'Reviewing workflow evidence',
      },
    });

    expect(
      buildForegroundAgentRunCompletionEffect({
        checkpointDetail: 'Final response delivered',
        checkpointTitle: 'Turn completed',
        counters,
        latestSummary: 'Done',
        now: 2500,
        status: 'completed',
      }),
    ).toEqual({
      params: {
        status: 'completed',
        latestSummary: 'Done',
        checkpointTitle: 'Turn completed',
        checkpointDetail: 'Final response delivered',
        summary: {
          assistantTurns: 2,
          startedTools: 3,
          completedTools: 2,
          failedTools: 1,
          spawnedSubAgents: 1,
          durationMs: 1500,
        },
      },
    });
  });
});
