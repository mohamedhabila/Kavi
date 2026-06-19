import {
  buildCancelledRunSummary,
  buildForegroundRunAbortCompletionEffect,
  buildForegroundRunFailureEffect,
  buildForegroundRunSupersededEffect,
  buildForegroundRunUserStopCompletionEffect,
  buildForegroundRunUserStopLogEntry,
  buildStoppedBackgroundWorkerDetail,
  buildSupersededRunSummary,
} from '../../src/engine/graph/foregroundRunTerminalEffects';

describe('foregroundRunTerminalEffects', () => {
  it('builds stopped worker summaries and details consistently', () => {
    expect(buildCancelledRunSummary(0)).toBe('The current run was cancelled.');
    expect(buildCancelledRunSummary(2)).toBe(
      'The current run was cancelled and 2 background workers were stopped.',
    );
    expect(buildSupersededRunSummary(1)).toBe(
      'A new user turn started before the previous run finished and 1 background worker was stopped.',
    );
    expect(buildStoppedBackgroundWorkerDetail(0)).toBeUndefined();
    expect(buildStoppedBackgroundWorkerDetail(2)).toBe('2 background workers were stopped.');
  });

  it('builds user-stop completion and aggregate log effects', () => {
    expect(buildForegroundRunAbortCompletionEffect()).toEqual(
      expect.objectContaining({
        status: 'cancelled',
        checkpointTitle: 'Turn cancelled',
        terminalReason: 'user_cancelled',
      }),
    );

    expect(buildForegroundRunUserStopCompletionEffect(1)).toEqual(
      expect.objectContaining({
        operationReason: 'Cancelled because the supervising turn was stopped by the user.',
        workerReason: 'Cancelled because the supervising turn was stopped by the user.',
        status: 'cancelled',
        checkpointTitle: 'Turn cancelled',
        terminalReason: 'user_cancelled',
      }),
    );

    expect(
      buildForegroundRunUserStopLogEntry({
        cancelledRunCount: 0,
        cancelledWorkerCount: 0,
      }),
    ).toEqual(
      expect.objectContaining({
        title: 'Generation stopped',
        detail: 'The current response was cancelled by the user.',
      }),
    );
  });

  it('builds supersede and failure effects', () => {
    expect(buildForegroundRunSupersededEffect(1)).toEqual(
      expect.objectContaining({
        operationReason: 'Superseded by a new user turn.',
        workerReason: 'Cancelled because a new user turn superseded the active run.',
        completion: expect.objectContaining({
          status: 'cancelled',
          checkpointTitle: 'Run superseded',
          terminalReason: 'user_cancelled',
        }),
        logEntry: expect.objectContaining({
          title: 'Previous run superseded and workers cancelled',
        }),
      }),
    );

    expect(buildForegroundRunFailureEffect('Tool call failed')).toEqual(
      expect.objectContaining({
        chatError: 'Tool call failed',
        completion: expect.objectContaining({
          status: 'failed',
          checkpointTitle: 'Turn failed',
          terminalReason: 'tool_failure',
        }),
        logEntry: expect.objectContaining({
          title: 'Request failed',
          detail: 'Tool call failed',
        }),
      }),
    );
  });
});
