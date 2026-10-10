import {
  executeSessionWait,
  installBuiltinExecutorWrapperReset,
  mockGetSubAgent,
  mockWaitForSubAgentCompletion,
} from '../helpers/builtinExecutorWrappersHarness';

// Live on delegation-worker-finalize, a worker refused a spawn for its own goal took the
// returned session id — its own — as another worker and waited on itself for two full
// 180 s windows, until the supervisor's turn timed out. A wait on the caller's own
// session, or on a supervisor above it, can never complete and is now refused at once.

const SESSIONS: Record<string, { sessionId: string; parentSessionId?: string }> = {
  supervisor: { sessionId: 'supervisor' },
  worker: { sessionId: 'worker', parentSessionId: 'supervisor' },
  child: { sessionId: 'child', parentSessionId: 'worker' },
};

function parse(outcome: { status: string; content: string }) {
  return { status: outcome.status, body: JSON.parse(outcome.content) };
}

describe('sessions_wait on the caller’s own lineage', () => {
  installBuiltinExecutorWrapperReset();

  beforeEach(() => {
    mockGetSubAgent.mockImplementation((sessionId: string) =>
      SESSIONS[sessionId]
        ? { ...SESSIONS[sessionId], status: 'running', startedAt: 1, updatedAt: 1, depth: 1 }
        : undefined,
    );
  });

  it('refuses a worker waiting on itself without waiting', async () => {
    const { status, body } = parse(await executeSessionWait({ sessionId: 'worker' }, 'worker'));

    expect(status).toBe('failed');
    expect(body).toMatchObject({ code: 'cannot_wait_on_own_session', sessionIds: ['worker'] });
    expect(mockWaitForSubAgentCompletion).not.toHaveBeenCalled();
  });

  it('refuses a worker waiting on its supervisor', async () => {
    const { body } = parse(await executeSessionWait({ sessionId: 'supervisor' }, 'worker'));

    expect(body).toMatchObject({ code: 'cannot_wait_on_own_session', sessionIds: ['supervisor'] });
    expect(mockWaitForSubAgentCompletion).not.toHaveBeenCalled();
  });

  it('still waits for a worker’s own child', async () => {
    mockWaitForSubAgentCompletion.mockResolvedValueOnce({
      sessionId: 'child',
      status: 'completed',
      terminationCause: 'completed',
      completionState: 'verified_success',
      output: 'done',
      toolsUsed: [],
      iterations: 1,
      depth: 2,
      artifacts: [],
    });

    const { status } = parse(await executeSessionWait({ sessionId: 'child' }, 'worker'));

    expect(status).toBe('completed');
    expect(mockWaitForSubAgentCompletion).toHaveBeenCalledWith('child', 180000);
  });

  it('lets the supervising conversation wait for its worker', async () => {
    mockWaitForSubAgentCompletion.mockResolvedValueOnce({
      sessionId: 'worker',
      status: 'completed',
      terminationCause: 'completed',
      completionState: 'verified_success',
      output: 'done',
      toolsUsed: [],
      iterations: 1,
      depth: 1,
      artifacts: [],
    });

    const { status } = parse(await executeSessionWait({ sessionId: 'worker' }, 'conversation-1'));

    expect(status).toBe('completed');
  });
});
