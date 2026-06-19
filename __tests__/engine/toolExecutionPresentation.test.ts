import {
  buildToolExecutionCompletionEffect,
  buildToolExecutionStartEffect,
  buildToolExecutionWorkPhasePresentation,
  toolCallStartedDelegatedSession,
} from '../../src/engine/toolExecution/toolExecutionPresentation';

describe('toolExecutionPresentation', () => {
  it('presents delegated worker launch from session-start descriptors', () => {
    expect(buildToolExecutionWorkPhasePresentation('sessions_spawn')).toEqual({
      title: 'Launching delegated work',
      checkpointTitle: 'Delegated work launch started',
    });

    expect(
      toolCallStartedDelegatedSession({
        toolName: 'sessions_spawn',
        result: JSON.stringify({
          status: 'completed',
          sessionId: 'sub-1',
          output: 'done',
        }),
      }),
    ).toBe(true);
  });

  it('does not count non-started session results as delegated launches', () => {
    expect(buildToolExecutionWorkPhasePresentation('sessions_wait')).toEqual({
      title: 'Monitoring delegated work',
      checkpointTitle: 'Delegated work monitoring active',
    });

    expect(
      toolCallStartedDelegatedSession({
        toolName: 'sessions_wait',
        result: JSON.stringify({
          status: 'completed',
          sessionId: 'sub-1',
          output: 'done',
        }),
      }),
    ).toBe(false);
  });

  it('treats non-session wait tools as async monitoring instead of worker launch', () => {
    expect(buildToolExecutionWorkPhasePresentation('expo_eas_workflow_wait')).toEqual({
      title: 'Monitoring asynchronous work',
      checkpointTitle: 'Async monitoring active',
    });
  });

  it('falls back to generic work titles for ordinary tools', () => {
    expect(buildToolExecutionWorkPhasePresentation('read_file')).toEqual({
      title: 'Using read_file',
      checkpointTitle: 'Work started',
    });

    expect(
      toolCallStartedDelegatedSession({
        toolName: 'read_file',
        result: JSON.stringify({ sessionId: 'sub-1' }),
      }),
    ).toBe(false);
  });

  it('builds graph-owned tool lifecycle effects for checkpoints and work phase updates', () => {
    expect(
      buildToolExecutionStartEffect({
        toolName: 'sessions_spawn',
        argumentSummary: 'spawn worker',
        timestamp: 10,
      }),
    ).toEqual({
      checkpoint: {
        kind: 'sub-agent',
        title: 'Tool started: sessions_spawn',
        detail: 'spawn worker',
        timestamp: 10,
      },
      workPhase: {
        title: 'Launching delegated work',
        checkpointTitle: 'Delegated work launch started',
      },
      logEntry: {
        kind: 'tool',
        title: 'Tool started: sessions_spawn',
        detail: 'spawn worker',
        timestamp: 10,
      },
    });

    expect(
      buildToolExecutionCompletionEffect({
        toolName: 'sessions_spawn',
        status: 'completed',
        result: JSON.stringify({ sessionId: 'sub-1' }),
        resultSummary: 'Spawned sub-agent',
        completedAt: 20,
        updatedAt: 20,
        elapsedLabel: '10s',
      }),
    ).toEqual({
      checkpoint: {
        kind: 'sub-agent',
        title: 'Tool completed: sessions_spawn',
        detail: 'Spawned sub-agent',
        timestamp: 20,
      },
      workPhaseDetail: 'Spawned sub-agent',
      logEntry: {
        kind: 'tool',
        level: 'success',
        title: 'Tool completed: sessions_spawn (10s)',
        detail: 'Spawned sub-agent',
        timestamp: 20,
      },
      startedDelegatedSession: true,
    });
  });
});
