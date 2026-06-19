import { agentControlGraphToolMessageShowsAsyncTerminalResolution } from '../../src/engine/graph/asyncTerminalResolution';
import { buildAgentControlGraphBackgroundWorkerWaitSummary, buildAgentControlGraphInterruptedOpenWorkRecovery, buildAgentControlGraphOpenWorkCloseoutDecision, buildAgentControlGraphOpenWorkPhasePresentation, getAgentControlGraphWaitingBackgroundWorkerCount } from '../../src/engine/graph/asyncOpenWork';
import { buildAgentControlGraphAsyncFinalizationHoldNote, buildAgentControlGraphPendingAsyncFinalizationCommand, buildAgentControlGraphPendingAsyncNoToolCorrectionNote } from '../../src/engine/graph/asyncPendingFinalization';
import type { TrackedAsyncOperation } from '../../src/engine/pendingAsyncOperations';

function createPendingOperation(
  overrides: Partial<TrackedAsyncOperation> = {},
): TrackedAsyncOperation {
  return {
    key: 'session:worker-1',
    kind: 'session',
    resourceId: 'worker-1',
    displayName: 'Worker 1',
    status: 'running',
    lastUpdatedByTool: 'sessions_spawn',
    updatedAt: 1000,
    monitorToolNames: ['sessions_wait'],
    waitToolName: 'sessions_wait',
    waitArgs: { sessionId: 'worker-1' },
    ...overrides,
  };
}

describe('agent control graph async finalization', () => {
  it('builds the graph-owned async finalization hold note', () => {
    expect(buildAgentControlGraphAsyncFinalizationHoldNote()).toBe(
      [
        '[SYSTEM ASYNC HOLD]',
        'pending_async_state: active',
        'finalization_ready: false',
      ].join('\n'),
    );
  });

  it('builds a compact correction note for stalled pending async work', () => {
    expect(
      buildAgentControlGraphPendingAsyncNoToolCorrectionNote(
        [
          createPendingOperation({ displayName: 'Build session' }),
          createPendingOperation({
            key: 'external:deploy-1',
            kind: 'external_run',
            resourceId: 'deploy-1',
            displayName: 'Deploy run',
          }),
          createPendingOperation({
            key: 'session:worker-3',
            resourceId: 'worker-3',
            displayName: 'Worker 3',
          }),
        ],
      ),
    ).toBe(
      [
        '[SYSTEM ASYNC MONITOR REQUIRED]',
        'pending_async_operations: Build session, Deploy run, and 1 more pending operation.',
        'next_action: monitor_or_wait',
      ].join('\n'),
    );
  });

  it('builds a graph command for pending async finalization holds', () => {
    const pendingOperation = createPendingOperation({ displayName: 'Build session' });
    const trackedOperations = new Map([[pendingOperation.key, pendingOperation]]);

    const command = buildAgentControlGraphPendingAsyncFinalizationCommand({
      trackedOperations,
      pendingOperations: [pendingOperation],
      previousNoToolTurnCount: 1,
      hasDraftContent: true,
    });

    expect(command).toEqual(
      expect.objectContaining({
        type: 'hold',
        reason: 'async_waiting_finalization_hold',
        nextNoToolTurnCount: 2,
        graphEvent: {
          type: 'ASYNC_WAITING',
          pendingAsyncCount: 1,
          pendingOperations: [pendingOperation],
        },
      }),
    );
    expect(command.type === 'hold' ? command.systemPrompts : []).toEqual([
      buildAgentControlGraphAsyncFinalizationHoldNote(),
      buildAgentControlGraphPendingAsyncNoToolCorrectionNote([pendingOperation]),
      expect.stringContaining('[SYSTEM WORKFLOW JOIN REQUIRED]'),
    ]);
  });

  it('keeps pending async finalization ready when there is no pending work', () => {
    expect(
      buildAgentControlGraphPendingAsyncFinalizationCommand({
        trackedOperations: new Map(),
        pendingOperations: [],
        previousNoToolTurnCount: 3,
        hasDraftContent: true,
      }),
    ).toEqual({ type: 'ready' });
  });

  it('ignores detached background worker counts when deciding foreground open work', () => {
    expect(
      getAgentControlGraphWaitingBackgroundWorkerCount({
        runningLiveCount: 1.8,
        orphanedRunningCount: 3,
        outstandingSpawnedCount: -2,
      }),
    ).toBe(3);
    expect(buildAgentControlGraphBackgroundWorkerWaitSummary(1)).toBe(
      'Waiting for 1 background worker to finish.',
    );

    expect(
      buildAgentControlGraphOpenWorkCloseoutDecision({
        backgroundWorkers: {
          runningLiveCount: 0,
          orphanedRunningCount: 2,
          outstandingSpawnedCount: 1,
        },
        pendingOperations: [],
      }),
    ).toEqual({ type: 'none' });
  });

  it('builds graph-owned pending async closeout decisions', () => {
    expect(
      buildAgentControlGraphOpenWorkCloseoutDecision({
        backgroundWorkers: {
          runningLiveCount: 0,
          orphanedRunningCount: 0,
          outstandingSpawnedCount: 0,
        },
        pendingOperations: [
          createPendingOperation({ displayName: 'Deploy run' }),
          createPendingOperation({
            key: 'ssh:job-1',
            kind: 'ssh-background-job',
            resourceId: 'job-1',
            displayName: 'SSH job',
            monitorToolNames: ['ssh_status'],
          }),
        ],
      }),
    ).toEqual({
      type: 'async-operations',
      pendingOperations: [
        createPendingOperation({ displayName: 'Deploy run' }),
        createPendingOperation({
          key: 'ssh:job-1',
          kind: 'ssh-background-job',
          resourceId: 'job-1',
          displayName: 'SSH job',
          monitorToolNames: ['ssh_status'],
        }),
      ],
      latestSummary: 'Waiting for 2 asynchronous operations to finish (Deploy run, SSH job).',
      checkpointTitle: 'Async monitoring active',
      checkpointDetail: 'Waiting for 2 asynchronous operations to finish (Deploy run, SSH job).',
      logLevel: 'warning',
      logTitle: 'Async monitoring still active',
    });

    expect(
      buildAgentControlGraphOpenWorkCloseoutDecision({
        backgroundWorkers: {},
        pendingOperations: [],
      }),
    ).toEqual({ type: 'none' });
  });

  it('builds work-phase presentation directly from graph-owned open-work decisions', () => {
    expect(
      buildAgentControlGraphOpenWorkPhasePresentation({
        type: 'async-operations',
        pendingOperations: [createPendingOperation({ displayName: 'Deploy run' })],
        latestSummary: 'Waiting for Deploy run to finish.',
        checkpointTitle: 'Async monitoring active',
        checkpointDetail: 'Waiting for Deploy run to finish.',
        logLevel: 'warning',
        logTitle: 'Async monitoring still active',
      }),
    ).toEqual({
      detail: 'Waiting for Deploy run to finish.',
      checkpointTitle: 'Async monitoring active',
      checkpointDetail: 'Waiting for Deploy run to finish.',
      latestSummary: 'Waiting for Deploy run to finish.',
      allowRegression: true,
    });

    expect(buildAgentControlGraphOpenWorkPhasePresentation({ type: 'none' })).toBeUndefined();
  });

  it('builds interrupted open-work recovery decisions from graph-owned summaries', () => {
    expect(
      buildAgentControlGraphInterruptedOpenWorkRecovery({
        runningBackgroundWorkerCount: 1,
        pendingOperations: [createPendingOperation({ displayName: 'Deploy run' })],
      }),
    ).toEqual({
      keepRunOpen: 'async-operations',
      checkpointTitle: 'Async monitoring active',
      checkpointDetail:
        'Waiting for Deploy run to finish. The supervisor response was interrupted before monitoring could continue.',
    });

    expect(
      buildAgentControlGraphInterruptedOpenWorkRecovery({
        runningBackgroundWorkerCount: 0,
        pendingOperations: [createPendingOperation({ displayName: 'Deploy run' })],
      }),
    ).toEqual({
      keepRunOpen: 'async-operations',
      checkpointTitle: 'Async monitoring active',
      checkpointDetail:
        'Waiting for Deploy run to finish. The supervisor response was interrupted before monitoring could continue.',
    });
  });

  it.each(['completed', 'complete', 'success', 'succeeded', 'failed', 'error', 'cancelled'])(
    'detects terminal async status %s from graph tool messages',
    (status) => {
      expect(
        agentControlGraphToolMessageShowsAsyncTerminalResolution({
          content: JSON.stringify({ status }),
        }),
      ).toBe(true);
    },
  );

  it('detects terminal async aggregate counts without status text', () => {
    expect(
      agentControlGraphToolMessageShowsAsyncTerminalResolution({
        content: JSON.stringify({ pendingCount: 0, completedCount: 1 }),
      }),
    ).toBe(true);
    expect(
      agentControlGraphToolMessageShowsAsyncTerminalResolution({
        content: JSON.stringify({ pendingCount: 0, failedCount: 1 }),
      }),
    ).toBe(true);
  });

  it('does not treat errors, pending counts, or non-json output as terminal async evidence', () => {
    expect(
      agentControlGraphToolMessageShowsAsyncTerminalResolution({
        content: JSON.stringify({ status: 'completed' }),
        isError: true,
      }),
    ).toBe(false);
    expect(
      agentControlGraphToolMessageShowsAsyncTerminalResolution({
        content: JSON.stringify({ pendingCount: 1, completedCount: 1 }),
      }),
    ).toBe(false);
    expect(
      agentControlGraphToolMessageShowsAsyncTerminalResolution({
        content: 'completed',
      }),
    ).toBe(false);
  });
});
