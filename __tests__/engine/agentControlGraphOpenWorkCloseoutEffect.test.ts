import { buildAgentControlGraphOpenWorkCloseoutEffect } from '../../src/engine/graph/openWorkCloseoutEffect';

describe('agent control graph open-work closeout effect', () => {
  it('returns none when only detached background workers remain', () => {
    expect(
      buildAgentControlGraphOpenWorkCloseoutEffect({
        currentAssistantMessage: {
          role: 'assistant',
          content: 'Draft answer already shown to the user.',
          toolCalls: [],
        },
        decision: { type: 'none' },
        turnSummary: 'Turn summary',
      }),
    ).toEqual({ type: 'none' });
  });

  it('builds a graph-owned work-phase effect for pending async monitoring', () => {
    expect(
      buildAgentControlGraphOpenWorkCloseoutEffect({
        currentAssistantMessage: undefined,
        decision: {
          type: 'async-operations',
          pendingOperations: [],
          latestSummary: 'Waiting for Deploy run to finish.',
          checkpointTitle: 'Async monitoring active',
          checkpointDetail: 'Waiting for Deploy run to finish.',
          logLevel: 'warning',
          logTitle: 'Async monitoring still active',
        },
        turnSummary: 'Turn summary',
      }),
    ).toEqual({
      type: 'async-operations',
      phasePresentation: {
        detail: 'Waiting for Deploy run to finish.',
        checkpointTitle: 'Async monitoring active',
        checkpointDetail: 'Waiting for Deploy run to finish.',
        latestSummary: 'Waiting for Deploy run to finish.',
        allowRegression: true,
      },
      logEntry: {
        kind: 'state',
        level: 'warning',
        title: 'Async monitoring still active',
        detail: 'Turn summary · Waiting for Deploy run to finish.',
      },
    });
  });
});
