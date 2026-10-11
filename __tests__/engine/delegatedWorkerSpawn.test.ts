import { resolveDelegatedWorkerSpawnPlan } from '../../src/engine/graph/delegatedWorkerSpawn';
import { buildDelegationFixtureAgentRun } from '../../src/acceptance/acceptanceMetrics/delegationGraphFixtures';
import type { Conversation } from '../../src/types/conversation';
import type { SubAgentSnapshot } from '../../src/types/subAgent';

function buildConversation(): Conversation {
  const run = buildDelegationFixtureAgentRun('run-1');
  return {
    id: 'conv-1',
    title: 'Spawn fixture',
    providerId: 'gemini',
    systemPrompt: 'system',
    messages: [],
    createdAt: 1,
    updatedAt: 1,
    activeAgentRunId: run.id,
    agentRuns: [run],
  };
}

function worker(overrides: Partial<SubAgentSnapshot> = {}): SubAgentSnapshot {
  return {
    sessionId: 'sub-1',
    parentConversationId: 'conv-1',
    agentRunId: 'run-1',
    workstreamId: 'delegated-workstream',
    depth: 1,
    startedAt: 1,
    updatedAt: 1,
    status: 'completed',
    completionState: 'verified_success',
    sandboxPolicy: 'inherit',
    launchState: 'terminal',
    ...overrides,
  };
}

function plan(
  request: Parameters<typeof resolveDelegatedWorkerSpawnPlan>[0]['request'],
  liveWorkers: SubAgentSnapshot[] = [],
) {
  const conversation = buildConversation();
  return resolveDelegatedWorkerSpawnPlan({
    request,
    conversation,
    parentConversationId: conversation.id,
    agentRunId: conversation.activeAgentRunId,
    liveWorkers,
  });
}

describe('resolveDelegatedWorkerSpawnPlan', () => {
  it('starts new work under a workstream id it assigns', () => {
    expect(plan({ prompt: 'Run delegated research.' })).toMatchObject({
      status: 'ready',
      spawnGate: { status: 'ready', workstreamId: 'delegated-workstream' },
    });
  });

  it('assigns an id the run does not already hold', () => {
    const result = plan({ prompt: 'Draft the summary.' }, [
      worker(),
      worker({ sessionId: 'sub-2', workstreamId: 'delegated-workstream-2' }),
    ]);

    expect(result.spawnGate).toEqual({ status: 'ready', workstreamId: 'delegated-workstream-3' });
  });

  it("counts only this run's workers when assigning an id", () => {
    const result = plan({ prompt: 'Draft the summary.' }, [worker({ agentRunId: 'run-other' })]);

    expect(result.spawnGate).toEqual({ status: 'ready', workstreamId: 'delegated-workstream' });
  });

  it('takes a named workstream as given for new work', () => {
    expect(plan({ prompt: 'Research the market.', workstreamId: 'market-research' })).toMatchObject(
      { status: 'ready', spawnGate: { status: 'ready', workstreamId: 'market-research' } },
    );
  });

  it('returns a repairable error when workstreamId has a malformed runtime shape', () => {
    const result = plan({ prompt: 'Research.', workstreamId: ' padded' });

    expect(result.status).toBe('error');
    expect(result.response).toMatchObject({
      status: 'error',
      code: 'invalid_workstream',
      repair: expect.objectContaining({ retryable: true, invalidFields: ['workstreamId'] }),
    });
  });

  it('resolves dependencies against the workers of this run', () => {
    expect(plan({ prompt: 'Summarize.', dependsOnWorkstreams: ['research'] })).toMatchObject({
      status: 'error',
      response: { code: 'unresolved_dependency', dependsOnWorkstreams: ['research'] },
    });

    const running = worker({ workstreamId: 'research', status: 'running', launchState: 'active' });
    expect(
      plan({ prompt: 'Summarize.', dependsOnWorkstreams: ['research'] }, [running]),
    ).toMatchObject({
      status: 'blocked',
      response: { status: 'blocked', dependsOnWorkstreams: ['research'] },
    });

    const delivered = worker({ workstreamId: 'research' });
    expect(
      plan({ prompt: 'Summarize.', dependsOnWorkstreams: ['research'] }, [delivered]),
    ).toMatchObject({ status: 'ready' });
  });

  it('does not treat a worker that ended without delivering as a met dependency', () => {
    const incomplete = worker({ workstreamId: 'research', completionState: 'incomplete' });

    expect(
      plan({ prompt: 'Summarize.', dependsOnWorkstreams: ['research'] }, [incomplete]),
    ).toMatchObject({ status: 'blocked' });
  });

  it.each(['completed', 'error', 'cancelled'] as const)(
    'does not replace a %s worker that already owns the workstream in this run',
    (status) => {
      const result = plan({ prompt: 'Run it again.', workstreamId: 'delegated-workstream' }, [
        worker({ status }),
      ]);

      expect(result.status).toBe('blocked');
      expect(result.response).toMatchObject({
        code: 'worker_workstream_already_owned',
        sessionId: 'sub-1',
        workerStatus: status,
      });
    },
  );

  it('blocks a second worker for a workstream whose worker is running', () => {
    const result = plan({ prompt: 'Run it again.', workstreamId: 'delegated-workstream' }, [
      worker({ status: 'running', launchState: 'active' }),
    ]);

    expect(result.response).toEqual({
      status: 'blocked',
      error: 'A worker for this workstream is already running.',
      sessionId: 'sub-1',
    });
  });

  it('does not reuse the name of a worker that already finished in this run', () => {
    const result = plan({ prompt: 'Research.', name: 'researcher' }, [
      worker({ name: 'researcher' }),
    ]);

    expect(result.response).toMatchObject({
      code: 'worker_identity_already_owned',
      sessionId: 'sub-1',
    });
  });
});
