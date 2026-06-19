import {
  executeSessionCancel,
  executeSessionHistory,
  executeSessionOutput,
  executeSessionStatus,
  executeSessionSurfaceOutput,
  executeSessionWait,
  executeSessionYield,
  executeWait,
  installBuiltinExecutorWrapperReset,
  mockCancelSubAgent,
  mockGetSubAgentsByParent,
  mockGetSubAgent,
  mockPruneStaleCommandPolls,
  mockRecordCommandPoll,
  mockResetCommandPollCount,
  mockWaitForSubAgentCompletion,
} from '../helpers/builtinExecutorWrappersHarness';

describe('builtin-executor wrapper coverage', () => {
  installBuiltinExecutorWrapperReset();

  it('returns session history with truncated output and recent activity entries', async () => {
    mockGetSubAgent.mockReturnValue({
      sessionId: 'session-1',
      status: 'completed',
      startedAt: 1000,
      currentActivity: 'done',
      output: 'x'.repeat(5000),
      activityLog: [
        { kind: 'tool', text: 'Checked files', timestamp: 1 },
        { kind: 'message', text: 'Found issue', timestamp: 2 },
      ],
    });

    const parsed = JSON.parse(
      await executeSessionHistory({ sessionId: 'session-1', maxMessages: 1 }),
    );
    expect(parsed.status).toBe('completed');
    expect(parsed.activityLog).toEqual([{ kind: 'message', text: 'Found issue', timestamp: 2 }]);
    expect(parsed.messages).toEqual([
      { role: 'assistant', content: 'Found issue', timestamp: 2 },
      { role: 'assistant', content: 'x'.repeat(4000) },
    ]);
  });

  it('returns a missing-session error for session history', async () => {
    mockGetSubAgent.mockReturnValue(undefined);
    await expect(executeSessionHistory({ sessionId: 'missing' })).resolves.toBe(
      'Error: session not found: missing',
    );
  });

  it('returns full terminal output without transcript history for sessions_output', async () => {
    mockGetSubAgent.mockReturnValue({
      sessionId: 'session-1',
      status: 'completed',
      startedAt: 1000,
      currentActivity: 'done',
      output: 'final worker deliverable',
      activityLog: [{ kind: 'tool', text: 'Checked files', timestamp: 1 }],
    });

    const parsed = JSON.parse(await executeSessionOutput({ sessionId: 'session-1' }));
    expect(parsed).toEqual({
      sessionId: 'session-1',
      status: 'completed',
      hasOutput: true,
      output: 'final worker deliverable',
      recentActivity: [{ kind: 'tool', text: 'Checked files', timestamp: 1 }],
      guidance:
        'This session is complete. Use sessions_output to recall its final output later, or sessions_history if you need the transcript.',
    });
  });

  it('returns running guidance instead of transcript history for sessions_output', async () => {
    mockGetSubAgent.mockReturnValue({
      sessionId: 'session-2',
      status: 'running',
      startedAt: 1000,
      currentActivity: 'working',
      output: undefined,
      activityLog: [],
    });

    const parsed = JSON.parse(await executeSessionOutput({ sessionId: 'session-2' }));
    expect(parsed).toEqual({
      sessionId: 'session-2',
      status: 'running',
      hasOutput: false,
      guidance:
        'Final output is not available yet because the worker is still running. Call sessions_wait if you need to block until it finishes, or continue with other non-overlapping work until it does.',
    });
  });

  it('returns surfaced worker output with supervisor wrapping for sessions_surface_output', async () => {
    mockGetSubAgent.mockReturnValue({
      sessionId: 'session-surface',
      status: 'completed',
      startedAt: 1000,
      currentActivity: 'done',
      output: 'Header\n<answer>Exact worker deliverable</answer>\nFooter',
      activityLog: [],
    });

    const parsed = JSON.parse(
      await executeSessionSurfaceOutput({
        sessionId: 'session-surface',
        prefix: 'Preface:\n',
        suffix: '\nPostface.',
        startMarker: '<answer>',
        endMarker: '</answer>',
      }),
    );

    expect(parsed).toEqual(
      expect.objectContaining({
        status: 'surfaced',
        sessionId: 'session-surface',
        output: 'Preface:\nExact worker deliverable\nPostface.',
        selectionApplied: true,
        usedFullOutput: false,
      }),
    );
  });

  it('returns running guidance for sessions_surface_output while the worker is still active', async () => {
    mockGetSubAgent.mockReturnValue({
      sessionId: 'session-running-surface',
      status: 'running',
      startedAt: 1000,
      currentActivity: 'working',
      output: undefined,
      activityLog: [],
    });

    const parsed = JSON.parse(
      await executeSessionSurfaceOutput({ sessionId: 'session-running-surface' }),
    );

    expect(parsed).toEqual({
      sessionId: 'session-running-surface',
      status: 'running',
      hasOutput: false,
      guidance:
        'Worker output cannot be surfaced yet because the worker is still running. Call sessions_wait if you need to block until it finishes, or continue with other non-overlapping work until it does.',
    });
  });

  it('reports running session status with polling guidance and terminal status with reset behavior', async () => {
    const now = Date.now();
    mockPruneStaleCommandPolls.mockReturnValue(undefined);
    mockRecordCommandPoll.mockReturnValue(2500);
    mockGetSubAgent
      .mockReturnValueOnce({
        sessionId: 'run-1',
        status: 'running',
        startedAt: now - 5000,
        updatedAt: now - 1000,
        depth: 2,
        sandboxPolicy: 'safe-only',
        output: 'partial',
        currentActivity: 'Reading files',
        activeToolName: 'read_file',
        activeToolStartedAt: now - 400,
        lastToolResultPreview: 'README.md',
        activityLog: [{ text: 'Did work' }],
        toolsUsed: ['read_file'],
        iterations: 2,
      })
      .mockReturnValueOnce({
        sessionId: 'done-1',
        status: 'completed',
        startedAt: now - 9000,
        updatedAt: now - 100,
        depth: 1,
        sandboxPolicy: 'safe-only',
        output: 'final answer',
        activityLog: [],
        toolsUsed: [],
        iterations: 1,
      });

    const running = JSON.parse(await executeSessionStatus({ sessionId: 'run-1' }));
    expect(running.status).toBe('running');
    expect(running.hasNewActivity).toBe(true);
    expect(running.canCancel).toBe(true);
    expect(running.recommendedWaitMs).toBe(2500);
    expect(running.currentActivity).toBe('Reading files');
    expect(mockPruneStaleCommandPolls).toHaveBeenCalled();
    expect(mockRecordCommandPoll).toHaveBeenCalled();

    const terminal = JSON.parse(await executeSessionStatus({ sessionId: 'done-1' }));
    expect(terminal.status).toBe('completed');
    expect(terminal.recommendedWaitMs).toBeUndefined();
    expect(terminal.canCancel).toBe(false);
    expect(mockResetCommandPollCount).toHaveBeenCalled();
  });

  it('uses a bounded default wait window and returns full output plus preview metadata for large session results', async () => {
    mockGetSubAgent.mockReturnValue({
      sessionId: 'session-1',
      status: 'running',
      startedAt: 1000,
      updatedAt: 2000,
      depth: 1,
    });
    mockWaitForSubAgentCompletion.mockResolvedValueOnce({
      sessionId: 'session-1',
      status: 'completed',
      output: 'x'.repeat(5000),
      toolsUsed: ['read_file'],
      iterations: 2,
      depth: 1,
      artifacts: [],
    });

    const parsed = JSON.parse(await executeSessionWait({ sessionId: 'session-1' }, 'conv-1'));

    expect(mockWaitForSubAgentCompletion).toHaveBeenCalledWith('session-1', 180000);
    expect(parsed.status).toBe('completed');
    expect(parsed.completedCount).toBe(1);
    expect(parsed.pendingCount).toBe(0);
    expect(parsed.guidance).toContain(
      'Completed session entries already include the final worker outputs.',
    );
    expect(parsed.sessions[0]).toEqual(
      expect.objectContaining({
        sessionId: 'session-1',
        status: 'completed',
        hasOutput: true,
        output: 'x'.repeat(5000),
        outputPreview: 'x'.repeat(600),
        outputChars: 5000,
      }),
    );
    expect(parsed.sessions[0].guidance).toBeUndefined();
  });

  it('returns full outputs for every completed session when waiting on multiple workers together', async () => {
    mockGetSubAgent.mockImplementation((sessionId: string) => ({
      sessionId,
      status: 'running',
      startedAt: 1000,
      updatedAt: 2000,
      depth: 1,
    }));
    mockWaitForSubAgentCompletion
      .mockResolvedValueOnce({
        sessionId: 'session-1',
        status: 'completed',
        output: 'first worker deliverable',
        toolsUsed: ['read_file'],
        iterations: 2,
        depth: 1,
        artifacts: [],
      })
      .mockResolvedValueOnce({
        sessionId: 'session-2',
        status: 'completed',
        output: 'y'.repeat(1400),
        toolsUsed: ['glob_search'],
        iterations: 3,
        depth: 1,
        artifacts: [],
      });

    const parsed = JSON.parse(
      await executeSessionWait({ sessionIds: ['session-1', 'session-2'] }, 'conv-1'),
    );

    expect(mockWaitForSubAgentCompletion).toHaveBeenNthCalledWith(1, 'session-1', 180000);
    expect(mockWaitForSubAgentCompletion).toHaveBeenNthCalledWith(2, 'session-2', 180000);
    expect(parsed.status).toBe('completed');
    expect(parsed.sessionIds).toEqual(['session-1', 'session-2']);
    expect(parsed.completedCount).toBe(2);
    expect(parsed.pendingCount).toBe(0);
    expect(parsed.guidance).toContain(
      'Completed session entries already include the final worker outputs.',
    );
    expect(parsed.sessions).toEqual([
      expect.objectContaining({
        sessionId: 'session-1',
        status: 'completed',
        hasOutput: true,
        output: 'first worker deliverable',
        outputChars: 'first worker deliverable'.length,
      }),
      expect.objectContaining({
        sessionId: 'session-2',
        status: 'completed',
        hasOutput: true,
        output: 'y'.repeat(1400),
        outputPreview: 'y'.repeat(600),
        outputChars: 1400,
      }),
    ]);
  });

  it('includes terminal workstream ids in sessions_wait entries', async () => {
    mockGetSubAgent.mockReturnValue({
      sessionId: 'session-graph-1',
      status: 'running',
      startedAt: 1000,
      updatedAt: 2000,
      depth: 1,
      workstreamId: 'worker-answer',
    });
    mockWaitForSubAgentCompletion.mockResolvedValueOnce({
      sessionId: 'session-graph-1',
      status: 'completed',
      output: 'worker deliverable',
      toolsUsed: [],
      iterations: 1,
      depth: 1,
      artifacts: [],
    });

    const parsed = JSON.parse(
      await executeSessionWait({ sessionId: 'session-graph-1' }, 'conv-1'),
    );

    expect(parsed.sessions[0]).toEqual(
      expect.objectContaining({
        sessionId: 'session-graph-1',
        status: 'completed',
        workstreamId: 'worker-answer',
      }),
    );
  });

  it('surfaces default wait-window expiry when sessions remain running', async () => {
    const now = Date.now();
    mockGetSubAgent.mockReturnValue({
      sessionId: 'session-2',
      status: 'running',
      startedAt: now - 20_000,
      updatedAt: now - 1_000,
      depth: 1,
      currentActivity: 'Still working',
    });
    mockWaitForSubAgentCompletion.mockResolvedValueOnce(null);

    const parsed = JSON.parse(await executeSessionWait({ sessionId: 'session-2' }, 'conv-1'));

    expect(mockWaitForSubAgentCompletion).toHaveBeenCalledWith('session-2', 180000);
    expect(parsed.status).toBe('running');
    expect(parsed.waitTimedOut).toBe(true);
    expect(parsed.waitTimeoutMs).toBe(180000);
    expect(parsed.usedDefaultWaitTimeout).toBe(true);
    expect(parsed.pendingCount).toBe(1);
    expect(parsed.guidance).toContain('The wait window ended');
  });

  it('honors explicit waitTimeoutMs overrides for sessions_wait', async () => {
    const now = Date.now();
    mockGetSubAgent.mockReturnValue({
      sessionId: 'session-3',
      status: 'running',
      startedAt: now - 20_000,
      updatedAt: now - 1_000,
      depth: 1,
      currentActivity: 'Still working',
    });
    mockWaitForSubAgentCompletion.mockResolvedValueOnce(null);

    const parsed = JSON.parse(
      await executeSessionWait({ sessionId: 'session-3', waitTimeoutMs: 5000 }, 'conv-1'),
    );

    expect(mockWaitForSubAgentCompletion).toHaveBeenCalledWith('session-3', 5000);
    expect(parsed.status).toBe('running');
    expect(parsed.waitTimedOut).toBe(true);
    expect(parsed.waitTimeoutMs).toBe(5000);
    expect(parsed.usedDefaultWaitTimeout).toBeUndefined();
  });

  it('uses launchState and lastProgressAt when diagnosing queued workers', async () => {
    const now = Date.now();
    mockPruneStaleCommandPolls.mockReturnValue(undefined);
    mockRecordCommandPoll.mockReturnValue(2500);
    mockGetSubAgent.mockReturnValue({
      sessionId: 'queued-1',
      status: 'running',
      startedAt: now - 70_000,
      updatedAt: now - 1_000,
      lastProgressAt: now - 60_000,
      depth: 1,
      sandboxPolicy: 'safe-only',
      launchState: 'queued',
      currentActivity: 'Still starting worker runtime',
      activityLog: [],
      toolsUsed: [],
      iterations: 0,
    });

    const parsed = JSON.parse(await executeSessionStatus({ sessionId: 'queued-1' }));
    expect(parsed.launchState).toBe('queued');
    expect(parsed.lastProgressAt).toBe(now - 60_000);
    expect(parsed.idleMs).toBeGreaterThanOrEqual(59_000);
    expect(parsed.liveness).toBe('stalled');
    expect(parsed.recommendedWaitMs).toBe(5000);
    expect(parsed.guidance).toContain('still bootstrapping');
  });

  it('keeps long initial model-response waits diagnosable without marking the worker stalled', async () => {
    const now = Date.now();
    mockPruneStaleCommandPolls.mockReturnValue(undefined);
    mockRecordCommandPoll.mockReturnValue(2500);
    mockGetSubAgent.mockReturnValue({
      sessionId: 'responding-1',
      status: 'running',
      startedAt: now - 70_000,
      updatedAt: now - 1_000,
      lastProgressAt: now - 60_000,
      modelResponsePendingSince: now - 60_000,
      depth: 1,
      sandboxPolicy: 'safe-only',
      launchState: 'active',
      currentActivity: 'Preparing initial response',
      activityLog: [],
      toolsUsed: [],
      iterations: 0,
    });

    const parsed = JSON.parse(await executeSessionStatus({ sessionId: 'responding-1' }));
    expect(parsed.awaitingModelResponse).toBe(true);
    expect(parsed.modelResponsePendingSince).toBe(now - 60_000);
    expect(parsed.modelResponseWaitMs).toBeGreaterThanOrEqual(59_000);
    expect(parsed.liveness).toBe('quiet');
    expect(parsed.guidance).toContain("waiting for the model's response");
  });

  it('returns running wait snapshots that preserve pending-model-response state', async () => {
    const now = Date.now();
    mockGetSubAgent.mockReturnValue({
      sessionId: 'responding-2',
      status: 'running',
      startedAt: now - 70_000,
      updatedAt: now - 1_000,
      lastProgressAt: now - 60_000,
      modelResponsePendingSince: now - 60_000,
      depth: 1,
      currentActivity: 'Preparing initial response',
    });
    mockWaitForSubAgentCompletion.mockResolvedValueOnce(null);

    const parsed = JSON.parse(await executeSessionWait({ sessionId: 'responding-2' }, 'conv-1'));

    expect(parsed.status).toBe('running');
    expect(parsed.pendingSessions).toHaveLength(1);
    expect(parsed.pendingSessions[0]).toEqual(
      expect.objectContaining({
        sessionId: 'responding-2',
        status: 'running',
        awaitingModelResponse: true,
        modelResponsePendingSince: now - 60_000,
        liveness: 'quiet',
        currentActivity: 'Preparing initial response',
      }),
    );
  });

  it('cancels running sessions and returns terminal or missing-session responses when appropriate', async () => {
    mockGetSubAgent
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce({ sessionId: 'done-1', status: 'completed', output: 'done' })
      .mockReturnValueOnce({ sessionId: 'run-1', status: 'running', currentActivity: 'Working' });
    mockCancelSubAgent.mockReturnValue({ currentActivity: 'Stopping now' });

    await expect(executeSessionCancel({ sessionId: 'missing' })).resolves.toBe(
      'Error: session not found: missing',
    );

    const terminal = JSON.parse(await executeSessionCancel({ sessionId: 'done-1' }));
    expect(terminal.message).toContain('already in a terminal state');

    const running = JSON.parse(
      await executeSessionCancel({ sessionId: 'run-1', reason: 'Wrong task' }),
    );
    expect(running.status).toBe('cancel_requested');
    expect(running.currentActivity).toBe('Stopping now');
    expect(mockCancelSubAgent).toHaveBeenCalledWith('run-1', 'Wrong task');
  });

  it('returns checkpoint information for yielded sessions and a terminal finalize signal when no workers are running', async () => {
    mockGetSubAgentsByParent.mockReturnValueOnce([]).mockReturnValueOnce([
      {
        sessionId: 'run-1',
        status: 'running',
        startedAt: 1,
        currentActivity: 'Inspecting',
        activeToolName: 'read_file',
      },
      { sessionId: 'done-1', status: 'completed', startedAt: 2 },
    ]);

    const empty = JSON.parse(await executeSessionYield({}, 'conv-1'));
    expect(empty).toEqual({
      status: 'completed',
      message: 'Supervisor checkpoint recorded.',
      finalizeSupervisor: true,
      pendingSessions: [],
      guidance:
        'No running sub-agent sessions remain for this conversation. Finalize the supervisor response instead of waiting again.',
    });

    const yielded = JSON.parse(
      await executeSessionYield({ message: '  Checkpoint now  ' }, 'conv-1'),
    );
    expect(yielded.status).toBe('checkpointed');
    expect(yielded.message).toBe('Checkpoint now');
    expect(yielded.finalizeSupervisor).toBe(false);
    expect(yielded.pendingSessions).toHaveLength(1);
    expect(yielded.pendingSessions[0]).toEqual(
      expect.objectContaining({
        sessionId: 'run-1',
        status: 'running',
        currentActivity: 'Inspecting',
        activeToolName: 'read_file',
        hasOutput: false,
      }),
    );
    expect(typeof yielded.pendingSessions[0].idleMs).toBe('number');
    expect(yielded.pendingSessions[0].idleMs).toBeGreaterThanOrEqual(0);
  });

  it('clamps wait durations to the supported range', async () => {
    jest.useFakeTimers();
    try {
      const shortWait = executeWait({ ms: 1, reason: 'short' });
      jest.advanceTimersByTime(100);
      await expect(shortWait).resolves.toBe(
        JSON.stringify({ status: 'waited', waitedMs: 100, reason: 'short' }),
      );

      const longWait = executeWait({ ms: 999999 });
      jest.advanceTimersByTime(60000);
      await expect(longWait).resolves.toBe(JSON.stringify({ status: 'waited', waitedMs: 60000 }));
    } finally {
      jest.useRealTimers();
    }
  });
});
