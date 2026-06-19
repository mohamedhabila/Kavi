import {
  applyTrackedAsyncToolResult,
  buildPendingAsyncOperationJoinNote,
  getPendingTrackedAsyncOperationToolNames,
  getPendingTrackedAsyncOperations,
  type TrackedAsyncOperation,
} from '../../src/engine/pendingAsyncOperations';

describe('pendingAsyncOperations', () => {
  let trackedOperations: Map<string, TrackedAsyncOperation>;

  beforeEach(() => {
    trackedOperations = new Map<string, TrackedAsyncOperation>();
  });

  it('tracks session workers until they reach a terminal state', () => {
    applyTrackedAsyncToolResult(
      trackedOperations,
      'sessions_spawn',
      '{"prompt":"research","waitForCompletion":true}',
      JSON.stringify({ status: 'running', sessionId: 'sub-1' }),
    );

    expect(getPendingTrackedAsyncOperations(trackedOperations)).toHaveLength(1);
    expect(getPendingTrackedAsyncOperationToolNames(trackedOperations).sort()).toEqual([
      'sessions_cancel',
      'sessions_wait',
    ]);
    expect(buildPendingAsyncOperationJoinNote(trackedOperations)).toContain(
      'Primary wait step: sessions_wait with {"sessionId":"sub-1"}.',
    );

    applyTrackedAsyncToolResult(
      trackedOperations,
      'sessions_status',
      '{"sessionId":"sub-1"}',
      JSON.stringify({ status: 'completed', sessionId: 'sub-1' }),
    );

    expect(getPendingTrackedAsyncOperations(trackedOperations)).toHaveLength(0);
  });

  it('preserves session workstream identity across spawn, status, and wait actions', () => {
    applyTrackedAsyncToolResult(
      trackedOperations,
      'sessions_spawn',
      '{"prompt":"research","workstreamId":"wait-worker-session"}',
      JSON.stringify({ status: 'running', sessionId: 'sub-workstream-1' }),
    );

    applyTrackedAsyncToolResult(
      trackedOperations,
      'sessions_status',
      '{"sessionId":"sub-workstream-1","workstreamId":"wait-worker-session"}',
      JSON.stringify({ status: 'running', sessionId: 'sub-workstream-1' }),
    );
  });

  it('starts tracking from sessions_status when no prior spawn event was seen', () => {
    applyTrackedAsyncToolResult(
      trackedOperations,
      'sessions_status',
      '{"sessionId":"sub-status-first"}',
      JSON.stringify({ status: 'running', sessionId: 'sub-status-first' }),
    );

    expect(getPendingTrackedAsyncOperations(trackedOperations)).toEqual([
      expect.objectContaining({
        kind: 'session',
        resourceId: 'sub-status-first',
        status: 'running',
      }),
    ]);
  });

  it('starts tracking running sessions surfaced by sessions_list without prior entries', () => {
    applyTrackedAsyncToolResult(
      trackedOperations,
      'sessions_list',
      '{}',
      JSON.stringify({
        sessions: [
          { sessionId: 'sub-list-running', status: 'running' },
          { sessionId: 'sub-list-complete', status: 'completed' },
        ],
      }),
    );

    expect(getPendingTrackedAsyncOperations(trackedOperations)).toEqual([
      expect.objectContaining({
        kind: 'session',
        resourceId: 'sub-list-running',
        status: 'running',
      }),
    ]);
  });

  it('clears stale tracked session workers when sessions_yield confirms none remain', () => {
    applyTrackedAsyncToolResult(
      trackedOperations,
      'sessions_spawn',
      '{"prompt":"research","waitForCompletion":true}',
      JSON.stringify({ status: 'running', sessionId: 'sub-1' }),
    );

    expect(getPendingTrackedAsyncOperations(trackedOperations)).toHaveLength(1);

    applyTrackedAsyncToolResult(
      trackedOperations,
      'sessions_yield',
      '{"message":"checkpoint"}',
      JSON.stringify({
        status: 'completed',
        message: 'checkpoint',
        finalizeSupervisor: true,
        pendingSessions: [],
      }),
    );

    expect(getPendingTrackedAsyncOperations(trackedOperations)).toHaveLength(0);
  });

  it('does not treat detached background sessions as pending foreground async work', () => {
    applyTrackedAsyncToolResult(
      trackedOperations,
      'sessions_spawn',
      '{"prompt":"research"}',
      JSON.stringify({ status: 'running', sessionId: 'sub-detached-1' }),
    );

    expect(getPendingTrackedAsyncOperations(trackedOperations)).toHaveLength(0);
    expect(getPendingTrackedAsyncOperationToolNames(trackedOperations)).toEqual([]);
    expect(buildPendingAsyncOperationJoinNote(trackedOperations)).toBeUndefined();
  });

  it('tracks expo workflows by run id once a run is known', () => {
    applyTrackedAsyncToolResult(
      trackedOperations,
      'expo_eas_build',
      '{"projectId":"proj-1"}',
      JSON.stringify({
        projectId: 'proj-1',
        projectName: 'Kavi',
        mode: 'github-workflow',
        workflowRun: {
          id: 123,
          status: 'queued',
          conclusion: null,
        },
      }),
    );

    expect(getPendingTrackedAsyncOperationToolNames(trackedOperations).sort()).toEqual([
      'expo_eas_workflow_status',
      'expo_eas_workflow_wait',
    ]);
    expect(buildPendingAsyncOperationJoinNote(trackedOperations)).toContain('expo workflow 123');

    applyTrackedAsyncToolResult(
      trackedOperations,
      'expo_eas_workflow_wait',
      '{"projectId":"proj-1","workflowRunId":"123"}',
      JSON.stringify({
        projectId: 'proj-1',
        projectName: 'Kavi',
        mode: 'github-workflow',
        workflowRun: {
          id: 123,
          status: 'completed',
          conclusion: 'success',
        },
      }),
    );

    expect(getPendingTrackedAsyncOperations(trackedOperations)).toHaveLength(0);
  });

  it('prefers the newest active expo workflow from runs payloads', () => {
    applyTrackedAsyncToolResult(
      trackedOperations,
      'expo_eas_workflow_runs',
      '{"projectId":"proj-1"}',
      JSON.stringify({
        projectId: 'proj-1',
        projectName: 'Kavi',
        mode: 'github-workflow',
        runs: [
          {
            id: 122,
            status: 'completed',
            conclusion: 'success',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
          {
            id: 123,
            status: 'queued',
            conclusion: null,
            updatedAt: '2026-01-02T00:00:00.000Z',
          },
        ],
      }),
    );

    expect(getPendingTrackedAsyncOperations(trackedOperations)).toEqual([
      expect.objectContaining({
        kind: 'expo-workflow',
        resourceId: '123',
        status: 'running',
      }),
    ]);
    expect(buildPendingAsyncOperationJoinNote(trackedOperations)).toContain('expo workflow 123');
  });

  it('tracks SSH background jobs until they complete', () => {
    applyTrackedAsyncToolResult(
      trackedOperations,
      'ssh_exec',
      '{"command":"npm run build","background":true}',
      JSON.stringify({ status: 'started', jobId: 'bg-1' }),
    );

    expect(getPendingTrackedAsyncOperationToolNames(trackedOperations).sort()).toEqual([
      'ssh_background_job_status',
      'ssh_background_job_wait',
    ]);
    expect(buildPendingAsyncOperationJoinNote(trackedOperations)).toContain(
      'ssh background job bg-1',
    );

    applyTrackedAsyncToolResult(
      trackedOperations,
      'ssh_background_job_status',
      '{"jobId":"bg-1"}',
      JSON.stringify({ status: 'completed', jobId: 'bg-1' }),
    );

    expect(getPendingTrackedAsyncOperations(trackedOperations)).toHaveLength(0);
  });
});
