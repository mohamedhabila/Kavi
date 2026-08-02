import {
  executeSessionWait,
  installBuiltinExecutorWrapperReset,
  mockGetSubAgentsByParent,
  mockGetSubAgent,
  mockWaitForSubAgentCompletion,
} from '../helpers/builtinExecutorWrappersHarness';

function parseCompletedOutcome(outcome: { status: string; content: string }) {
  expect(outcome.status).toBe('completed');
  return JSON.parse(outcome.content);
}

describe('sessions_wait identity and semantic completion', () => {
  installBuiltinExecutorWrapperReset();

  it('uses the single code-tracked worker when a generated wait id is missing', async () => {
    mockGetSubAgent.mockImplementation((sessionId: string) =>
      sessionId === 'actual-session'
        ? {
            sessionId,
            status: 'error',
            startedAt: 1000,
            updatedAt: 2000,
            depth: 1,
          }
        : undefined,
    );
    mockWaitForSubAgentCompletion.mockResolvedValueOnce({
      sessionId: 'actual-session',
      status: 'error',
      terminationCause: 'tool_failure',
      completionState: 'blocked',
      output: 'The worker hit a recoverable tool timeout.',
      error: 'tool timeout',
      toolsUsed: ['python'],
      iterations: 2,
      depth: 1,
      artifacts: [],
    });

    const parsed = parseCompletedOutcome(
      await executeSessionWait({ sessionId: 'invented-session' }, 'conv-1', undefined, [
        'actual-session',
      ]),
    );

    expect(mockWaitForSubAgentCompletion).toHaveBeenCalledWith('actual-session', 180000);
    expect(parsed).toEqual(
      expect.objectContaining({
        status: 'completed',
        sessionIds: ['actual-session'],
        requestedSessionIds: ['invented-session'],
        identityResolution: {
          kind: 'single_pending_session',
          requestedSessionId: 'invented-session',
          resolvedSessionId: 'actual-session',
        },
      }),
    );
    expect(parsed.sessions[0]).toEqual(
      expect.objectContaining({
        sessionId: 'actual-session',
        status: 'error',
        error: 'tool timeout',
      }),
    );
  });

  it('reports semantic blockage instead of presenting a completed model loop as success', async () => {
    mockGetSubAgent.mockReturnValue({
      sessionId: 'blocked-session',
      status: 'completed',
      startedAt: 1000,
      updatedAt: 2000,
      depth: 1,
    });
    mockWaitForSubAgentCompletion.mockResolvedValueOnce({
      sessionId: 'blocked-session',
      status: 'completed',
      terminationCause: 'completed',
      completionState: 'blocked',
      output: 'The required source could not be verified.',
      toolsUsed: ['read_file'],
      iterations: 3,
      depth: 1,
      artifacts: [],
    });

    const parsed = parseCompletedOutcome(
      await executeSessionWait({ sessionId: 'blocked-session' }, 'conv-1'),
    );

    expect(parsed.status).toBe('completed');
    expect(parsed.sessions[0]).toEqual(
      expect.objectContaining({
        sessionId: 'blocked-session',
        status: 'blocked',
        completionState: 'blocked',
      }),
    );
  });

  it('waits on tracked joined workers when ids are omitted, including terminal workers', async () => {
    mockGetSubAgent.mockReturnValue({
      sessionId: 'joined-terminal',
      status: 'completed',
      startedAt: 1000,
      updatedAt: 2000,
      depth: 1,
    });
    mockWaitForSubAgentCompletion.mockResolvedValueOnce({
      sessionId: 'joined-terminal',
      status: 'completed',
      terminationCause: 'completed',
      completionState: 'verified_success',
      output: 'verified deliverable',
      toolsUsed: ['read_file'],
      iterations: 2,
      depth: 1,
      artifacts: [],
    });

    const parsed = parseCompletedOutcome(
      await executeSessionWait({}, 'conv-1', undefined, ['joined-terminal']),
    );

    expect(mockGetSubAgentsByParent).not.toHaveBeenCalled();
    expect(parsed).toEqual(
      expect.objectContaining({
        status: 'completed',
        sessionIds: ['joined-terminal'],
        selectedTrackedSessions: true,
        waitedForConversationSessions: true,
      }),
    );
    expect(parsed.sessions[0].output).toBe('verified deliverable');
  });

  it('rejects an ambiguous missing wait id and returns exact tracked alternatives', async () => {
    mockGetSubAgent.mockReturnValue(undefined);

    const outcome = await executeSessionWait(
      { sessionId: 'invented-session' },
      'conv-1',
      undefined,
      ['joined-a', 'joined-b'],
    );

    expect(outcome.status).toBe('failed');
    expect(JSON.parse(outcome.content)).toEqual(
      expect.objectContaining({
        status: 'error',
        code: 'session_not_found',
        missingSessionIds: ['invented-session'],
        availablePendingSessionIds: ['joined-a', 'joined-b'],
      }),
    );
    expect(mockWaitForSubAgentCompletion).not.toHaveBeenCalled();
  });
});
