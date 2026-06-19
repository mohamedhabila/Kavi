import {
  evaluateWorkflowPlanContinuation,
  evaluateWorkflowSpawnGate,
} from '../../src/services/agents/lifecycle/workflowSchedulingExecution';
import { getWorkflowExecutionStates } from '../../src/services/agents/lifecycle/workflowExecutionState';
import {
  inferWorkflowWorkstreamId,
  normalizeWorkflowWorkstreams,
  resolveWorkflowWorkstreamReference,
} from '../../src/services/agents/workflowSchedulingReferences';

describe('workflowScheduling', () => {
  it('canonicalizes dependency references to stable workstream ids', () => {
    const workstreams = normalizeWorkflowWorkstreams([
      {
        id: 'workstream-1',
        title: 'Architecture',
      },
      {
        id: 'workstream-2',
        title: 'Implementation',
        dependencies: ['Architecture'],
      },
    ]);

    expect(workstreams).toEqual([
      expect.objectContaining({ id: 'workstream-1', title: 'Architecture' }),
      expect.objectContaining({
        id: 'workstream-2',
        title: 'Implementation',
        dependencies: ['workstream-1'],
      }),
    ]);
  });

  it('preserves expected output contracts while normalizing workstreams', () => {
    const workstreams = normalizeWorkflowWorkstreams([
      {
        id: 'workstream-1',
        title: 'Delegated answer',
        expectedOutput: 'C212W',
      },
    ]);

    expect(workstreams[0]).toEqual(
      expect.objectContaining({
        id: 'workstream-1',
        expectedOutput: 'C212W',
      }),
    );
  });

  it('treats unmatched ad hoc dependency text as a blocking dependency', () => {
    const result = evaluateWorkflowSpawnGate({
      workers: [],
      dependsOnWorkstreams: ['none.'],
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'blocked',
        dependencyIds: ['none.'],
        unmetDependencyIds: ['none.'],
        blockingDependencies: [
          expect.objectContaining({
            workstreamId: 'none.',
            status: 'not-started',
          }),
        ],
      }),
    );
  });

  it('resolves workstream references by id or title', () => {
    const workstreams = normalizeWorkflowWorkstreams([
      { id: 'workstream-1', title: 'Architecture' },
      { id: 'workstream-2', title: 'Implementation' },
    ]);

    expect(resolveWorkflowWorkstreamReference(workstreams, 'workstream-1')).toBe('workstream-1');
    expect(resolveWorkflowWorkstreamReference(workstreams, 'Implementation')).toBe('workstream-2');
  });

  it('resolves only exact workstream ids or exact normalized titles', () => {
    const workstreams = normalizeWorkflowWorkstreams([
      { id: 'workstream-1', title: '**Anthropic Research**' },
      { id: 'workstream-2', title: '**OpenAI Research**' },
      { id: 'workstream-3', title: '**Google Gemini Research**' },
    ]);

    expect(resolveWorkflowWorkstreamReference(workstreams, 'workstreams 1')).toBeUndefined();
    expect(resolveWorkflowWorkstreamReference(workstreams, 'Anthropic Research')).toBeUndefined();
    expect(resolveWorkflowWorkstreamReference(workstreams, '**Anthropic Research**')).toBe(
      'workstream-1',
    );
  });

  it('does not infer a sole plan workstream without an explicit binding', () => {
    const workstreams = normalizeWorkflowWorkstreams([
      { id: 'workstream-1', title: 'Architecture' },
    ]);

    expect(
      inferWorkflowWorkstreamId(workstreams, { prompt: 'Do the architecture work' }),
    ).toBeUndefined();
  });

  it('requires an exact explicit workstream binding', () => {
    const workstreams = normalizeWorkflowWorkstreams([
      { id: 'execution-unit-1', title: 'Delegated worker answer' },
    ]);

    expect(
      inferWorkflowWorkstreamId(workstreams, { prompt: 'Run an unrelated Python check.' }),
    ).toBeUndefined();
    expect(
      inferWorkflowWorkstreamId(workstreams, {
        workstreamId: 'execution-unit-2',
        prompt: 'Run an unrelated Python check.',
      }),
    ).toBeUndefined();
    expect(
      inferWorkflowWorkstreamId(workstreams, {
        workstreamId: 'execution-unit-1',
        prompt: 'Run the delegated worker answer.',
      }),
    ).toBe('execution-unit-1');
  });

  it('does not infer a workstream from descriptive worker-name overlap alone', () => {
    const workstreams = normalizeWorkflowWorkstreams([
      { id: 'workstream-1', title: '**Anthropic Research**' },
      { id: 'workstream-2', title: '**OpenAI Research**' },
      { id: 'workstream-3', title: '**Google Gemini Research**' },
    ]);

    expect(
      inferWorkflowWorkstreamId(workstreams, {
        name: 'Anthropic Research Agent',
        prompt: 'Research Anthropic official docs, tool behavior, and orchestration guidance.',
      }),
    ).toBeUndefined();
  });

  it('summarizes execution state per workstream id', () => {
    const states = getWorkflowExecutionStates(
      normalizeWorkflowWorkstreams([
        { id: 'workstream-1', title: 'Architecture' },
        { id: 'workstream-2', title: 'Implementation' },
      ]),
      [
        { sessionId: 'sub-1', workstreamId: 'workstream-1', status: 'completed' },
        { sessionId: 'sub-2', workstreamId: 'workstream-2', status: 'running' },
      ],
    );

    expect(states['workstream-1']).toEqual(
      expect.objectContaining({
        status: 'completed',
        completedSessionIds: ['sub-1'],
      }),
    );
    expect(states['workstream-2']).toEqual(
      expect.objectContaining({
        status: 'running',
        runningSessionIds: ['sub-2'],
      }),
    );
  });

  it('treats completed workers with mismatched expected output as failed workstream attempts', () => {
    const states = getWorkflowExecutionStates(
      normalizeWorkflowWorkstreams([
        {
          id: 'workstream-1',
          title: 'Worker answer',
          expectedOutput: 'C212W',
        },
      ]),
      [
        {
          sessionId: 'sub-1',
          workstreamId: 'workstream-1',
          status: 'completed',
          output: 'KAVIASYNCOK',
        },
      ],
    );

    expect(states['workstream-1']).toEqual(
      expect.objectContaining({
        status: 'failed',
        completedSessionIds: [],
        failedSessionIds: ['sub-1'],
      }),
    );
  });

  it('allows a new spawn after a completed worker missed its expected output contract', () => {
    const result = evaluateWorkflowSpawnGate({
      plan: {
        workstreams: normalizeWorkflowWorkstreams([
          {
            id: 'workstream-1',
            title: 'Worker answer',
            expectedOutput: 'C212W',
          },
        ]),
      },
      workers: [
        {
          sessionId: 'sub-1',
          workstreamId: 'workstream-1',
          status: 'completed',
          output: 'KAVIASYNCOK',
        },
      ],
      workstreamId: 'workstream-1',
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'ready',
        duplicateCompletedSessionIds: [],
      }),
    );
  });

  it('canonicalizes worker workstream ids back to the plan ids when summarizing execution state', () => {
    const states = getWorkflowExecutionStates(
      normalizeWorkflowWorkstreams([
        { id: 'workstream-1', title: 'Architecture' },
        { id: 'workstream-2', title: 'Implementation' },
      ]),
      [{ sessionId: 'sub-1', workstreamId: 'Architecture', status: 'completed' }],
    );

    expect(states['workstream-1']).toEqual(
      expect.objectContaining({
        status: 'completed',
        completedSessionIds: ['sub-1'],
      }),
    );
  });

  it('blocks a spawn when prerequisite workstreams are not complete', () => {
    const plan = {
      objective: 'Build the feature',
      successCriteria: ['Ship it'],
      stopConditions: ['Blocked'],
      workstreams: normalizeWorkflowWorkstreams([
        { id: 'workstream-1', title: 'Architecture' },
        { id: 'workstream-2', title: 'Implementation', dependencies: ['workstream-1'] },
      ]),
      updatedAt: 1,
    };

    const result = evaluateWorkflowSpawnGate({
      plan,
      workers: [{ sessionId: 'sub-1', workstreamId: 'workstream-1', status: 'running' }],
      workstreamId: 'workstream-2',
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'blocked',
        workstreamId: 'workstream-2',
        unmetDependencyIds: ['workstream-1'],
        blockingDependencies: [
          expect.objectContaining({
            workstreamId: 'workstream-1',
            status: 'running',
            sessionIds: ['sub-1'],
          }),
        ],
      }),
    );
  });

  it('blocks duplicate concurrent workers for the same workstream', () => {
    const result = evaluateWorkflowSpawnGate({
      workers: [{ sessionId: 'sub-1', workstreamId: 'workstream-2', status: 'running' }],
      workstreamId: 'workstream-2',
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'blocked',
        duplicateRunningSessionIds: ['sub-1'],
      }),
    );
  });

  it('blocks re-spawning a workstream that already has a completed worker', () => {
    const result = evaluateWorkflowSpawnGate({
      workers: [{ sessionId: 'sub-1', workstreamId: 'workstream-2', status: 'completed' }],
      workstreamId: 'workstream-2',
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'blocked',
        duplicateCompletedSessionIds: ['sub-1'],
      }),
    );
  });

  it('uses graph-completed workstreams to satisfy dependencies without worker sessions', () => {
    const plan = {
      objective: 'Build the feature',
      successCriteria: ['Ship it'],
      stopConditions: ['Blocked'],
      workstreams: normalizeWorkflowWorkstreams([
        { id: 'execution-unit-1', title: 'Create file' },
        {
          id: 'execution-unit-2',
          title: 'Launch worker',
          dependencies: ['execution-unit-1'],
        },
      ]),
      updatedAt: 1,
    };

    const result = evaluateWorkflowSpawnGate({
      plan,
      workers: [],
      workstreamId: 'execution-unit-2',
      completedWorkstreamIds: ['execution-unit-1'],
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'ready',
        workstreamId: 'execution-unit-2',
        unmetDependencyIds: [],
        blockingDependencies: [],
      }),
    );
  });

  it('blocks re-spawning a graph-completed workstream even without a worker session id', () => {
    const result = evaluateWorkflowSpawnGate({
      workers: [],
      workstreamId: 'execution-unit-1',
      completedWorkstreamIds: ['execution-unit-1'],
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'blocked',
        duplicateCompletedWorkstreamIds: ['execution-unit-1'],
      }),
    );
  });

  it('allows dependent work when a prerequisite already has a completed worker, even if another worker is still running', () => {
    const plan = {
      objective: 'Build the feature',
      successCriteria: ['Ship it'],
      stopConditions: ['Blocked'],
      workstreams: normalizeWorkflowWorkstreams([
        { id: 'workstream-1', title: 'Architecture' },
        { id: 'workstream-2', title: 'Implementation', dependencies: ['Architecture'] },
      ]),
      updatedAt: 1,
    };

    const result = evaluateWorkflowSpawnGate({
      plan,
      workers: [
        { sessionId: 'sub-arch-1', workstreamId: 'Architecture', status: 'completed' },
        { sessionId: 'sub-arch-2', workstreamId: 'workstream-1', status: 'running' },
      ],
      workstreamId: 'workstream-2',
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'ready',
        workstreamId: 'workstream-2',
        unmetDependencyIds: [],
        blockingDependencies: [],
      }),
    );
  });

  it('continues the run while ready or blocked structured work remains', () => {
    const plan = {
      objective: 'Build the feature',
      successCriteria: ['Ship it'],
      stopConditions: ['Blocked'],
      workstreams: normalizeWorkflowWorkstreams([
        { id: 'workstream-1', title: 'Architecture' },
        { id: 'workstream-2', title: 'Implementation', dependencies: ['Architecture'] },
        { id: 'workstream-3', title: 'Verification', dependencies: ['Implementation'] },
      ]),
      updatedAt: 1,
    };

    const result = evaluateWorkflowPlanContinuation({
      plan,
      workers: [
        { sessionId: 'sub-1', workstreamId: 'workstream-1', status: 'completed' },
        { sessionId: 'sub-2', workstreamId: 'workstream-2', status: 'error' },
      ],
    });

    expect(result.status).toBe('continue');
    expect(result.completedWorkstreams).toEqual([
      expect.objectContaining({ workstreamId: 'workstream-1', status: 'completed' }),
    ]);
    expect(result.readyWorkstreams).toEqual([
      expect.objectContaining({
        workstreamId: 'workstream-2',
        status: 'failed',
        unmetDependencyIds: [],
      }),
    ]);
    expect(result.blockedWorkstreams).toEqual([
      expect.objectContaining({
        workstreamId: 'workstream-3',
        unmetDependencyIds: ['workstream-2'],
      }),
    ]);
    expect(result.summary).toContain('Structured plan still has remaining work');
    expect(result.summary).toContain('failed and ready for repair');
  });

  it('marks the run ready for pilot when all structured workstreams are complete', () => {
    const plan = {
      objective: 'Build the feature',
      successCriteria: ['Ship it'],
      stopConditions: ['Blocked'],
      workstreams: normalizeWorkflowWorkstreams([
        { id: 'workstream-1', title: 'Architecture' },
        { id: 'workstream-2', title: 'Implementation', dependencies: ['Architecture'] },
      ]),
      updatedAt: 1,
    };

    const result = evaluateWorkflowPlanContinuation({
      plan,
      workers: [
        { sessionId: 'sub-1', workstreamId: 'workstream-1', status: 'completed' },
        { sessionId: 'sub-2', workstreamId: 'workstream-2', status: 'completed' },
      ],
    });

    expect(result.status).toBe('ready-for-pilot');
    expect(result.readyWorkstreams).toHaveLength(0);
    expect(result.blockedWorkstreams).toHaveLength(0);
    expect(result.summary).toBe(
      'All 2 structured workstreams are complete. Ready for Pilot review.',
    );
  });
});
