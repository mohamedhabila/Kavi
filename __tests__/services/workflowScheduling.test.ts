import {
  evaluateWorkflowPlanContinuation,
  evaluateWorkflowSpawnGate,
  getWorkflowExecutionStates,
  inferWorkflowWorkstreamId,
  normalizeWorkflowWorkstreams,
  resolveWorkflowWorkstreamReference,
} from '../../src/services/agents/workflowScheduling';

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

  it('drops independent dependency sentinels', () => {
    const workstreams = normalizeWorkflowWorkstreams([
      {
        id: 'workstream-1',
        title: 'Architecture',
        dependencies: ['none', 'none.', 'no dependencies.'],
      },
    ]);

    expect(workstreams[0].dependencies).toBeUndefined();
  });

  it('ignores punctuated independent dependency sentinels when gating ad hoc spawns', () => {
    const result = evaluateWorkflowSpawnGate({
      workers: [],
      dependsOnWorkstreams: ['none.'],
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'ready',
        dependencyIds: [],
        unmetDependencyIds: [],
        blockingDependencies: [],
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

  it('resolves noisy numbered references and markdown-decorated titles', () => {
    const workstreams = normalizeWorkflowWorkstreams([
      { id: 'workstream-1', title: '**Anthropic Research**' },
      { id: 'workstream-2', title: '**OpenAI Research**' },
      { id: 'workstream-3', title: '**Google Gemini Research**' },
    ]);

    expect(resolveWorkflowWorkstreamReference(workstreams, 'workstreams 1')).toBe('workstream-1');
    expect(
      resolveWorkflowWorkstreamReference(
        workstreams,
        '3 --- Now spawning the research sub-agents in parallel:',
      ),
    ).toBe('workstream-3');
    expect(resolveWorkflowWorkstreamReference(workstreams, 'Anthropic Research Agent')).toBe(
      'workstream-1',
    );
  });

  it('infers the only plan workstream when no explicit binding is supplied', () => {
    const workstreams = normalizeWorkflowWorkstreams([
      { id: 'workstream-1', title: 'Architecture' },
    ]);

    expect(inferWorkflowWorkstreamId(workstreams, { prompt: 'Do the architecture work' })).toBe(
      'workstream-1',
    );
  });

  it('infers a unique Anthropic-style research worker from the worker name and prompt', () => {
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
    ).toBe('workstream-1');
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
