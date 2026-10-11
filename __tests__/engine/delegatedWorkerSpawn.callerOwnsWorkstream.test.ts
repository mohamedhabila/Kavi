import { resolveDelegatedWorkerSpawnPlan } from '../../src/engine/graph/delegatedWorkerSpawn';
import { buildDelegationFixtureAgentRun } from '../../src/acceptance/acceptanceMetrics/delegationGraphFixtures';
import type { Conversation } from '../../src/types/conversation';
import type { SubAgentSnapshot } from '../../src/types/subAgent';

// Live, a worker asked to delegate its own task was told "A worker for this workstream is
// already running" with its own session id, took that as another worker, and waited on
// itself until the supervisor's turn timed out.

const run = buildDelegationFixtureAgentRun('run-1');
const conversation: Conversation = {
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

const runningWorker = {
  sessionId: 'sub-worker',
  parentConversationId: 'conv-1',
  agentRunId: 'run-1',
  workstreamId: 'worker-task',
  status: 'running',
  depth: 1,
  startedAt: 1,
  updatedAt: 1,
} as SubAgentSnapshot;

function plan(callerSessionId?: string) {
  return resolveDelegatedWorkerSpawnPlan({
    request: { prompt: 'Return the exact output.', workstreamId: 'worker-task', depth: 2 },
    conversation,
    parentConversationId: 'conv-1',
    agentRunId: 'run-1',
    liveWorkers: [runningWorker],
    callerSessionId,
  });
}

describe('a spawn for a workstream whose worker is already running', () => {
  it('tells the running worker that it is the worker and should answer', () => {
    const result = plan('sub-worker');

    expect(result.status).toBe('blocked');
    expect(result.response).toMatchObject({
      status: 'blocked',
      code: 'caller_owns_workstream',
      sessionId: 'sub-worker',
    });
  });

  it('tells anyone else which worker already owns it', () => {
    const result = plan(undefined);

    expect(result.response).toEqual({
      status: 'blocked',
      error: 'A worker for this workstream is already running.',
      sessionId: 'sub-worker',
    });
  });
});
