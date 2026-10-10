import { resolveDelegatedWorkerSpawnPlan } from '../../src/engine/graph/delegatedWorkerSpawn';
import {
  DELEGATED_WORKER_EVIDENCE_CRITERION,
  DELEGATED_WORKER_GOAL_OWNER,
  DELEGATED_WORKER_MIN_EVIDENCE_CRITERION,
} from '../../src/engine/goals/delegation';
import { buildDelegationFixtureAgentRun } from '../../src/acceptance/acceptanceMetrics/delegationGraphFixtures';
import type { AgentGoal } from '../../src/types/agentRun';
import type { Conversation } from '../../src/types/conversation';
import type { SubAgentSnapshot } from '../../src/types/subAgent';

// Live, a worker asked to delegate its own goal was told "A worker for this goal is
// already running" with its own session id, took that as another worker, and waited on
// itself until the supervisor's turn timed out.

const goal: AgentGoal = {
  id: 'worker-task',
  title: 'Delegated work',
  status: 'active',
  completionPolicy: 'blocking',
  owner: DELEGATED_WORKER_GOAL_OWNER,
  dependencies: [],
  evidence: [],
  requiredCapabilities: ['coordinate'],
  successCriteria: [DELEGATED_WORKER_EVIDENCE_CRITERION, DELEGATED_WORKER_MIN_EVIDENCE_CRITERION],
  createdAt: 1,
  updatedAt: 1,
};

const run = buildDelegationFixtureAgentRun([goal], 'run-1');
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

describe('a spawn for a goal whose worker is already running', () => {
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
      error: 'A worker for this goal is already running.',
      sessionId: 'sub-worker',
    });
  });
});
