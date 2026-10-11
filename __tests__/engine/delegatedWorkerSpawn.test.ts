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

function buildConversation(goals: AgentGoal[]): Conversation {
  const run = buildDelegationFixtureAgentRun(goals, 'run-1');

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

function buildDedicatedWorkerGoal(overrides: Partial<AgentGoal> = {}): AgentGoal {
  return {
    id: 'worker-goal',
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
    ...overrides,
  };
}

describe('resolveDelegatedWorkerSpawnPlan', () => {
  it('launches a worker in a run that holds no goals', () => {
    const conversation = buildConversation([]);

    const plan = resolveDelegatedWorkerSpawnPlan({
      request: { prompt: 'Run delegated research.', name: 'researcher' },
      conversation,
      parentConversationId: conversation.id,
      agentRunId: conversation.activeAgentRunId,
      liveWorkers: [],
    });

    expect(plan.status).toBe('ready');
    expect(plan.spawnGate).toEqual({ status: 'ready', workstreamId: undefined });
  });

  it('uses orchestrator parentGoals when chat store goals are stale', () => {
    const staleConversation = buildConversation([
      {
        id: 'dep-goal',
        title: 'Prerequisite',
        status: 'active',
        dependencies: [],
        evidence: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    const liveGoals: AgentGoal[] = [
      {
        id: 'dep-goal',
        title: 'Prerequisite',
        status: 'completed',
        dependencies: [],
        evidence: [],
        createdAt: 1,
        updatedAt: 1,
      },
      buildDedicatedWorkerGoal({ status: 'pending' }),
    ];

    const plan = resolveDelegatedWorkerSpawnPlan({
      request: {
        prompt: 'Run delegated research.',
        workstreamId: 'worker-goal',
        dependsOnWorkstreams: ['dep-goal'],
      },
      conversation: staleConversation,
      parentConversationId: staleConversation.id,
      agentRunId: staleConversation.activeAgentRunId,
      liveWorkers: [],
      parentGoals: liveGoals,
    });

    expect(plan.status).toBe('ready');
    expect(plan.goals).toEqual(liveGoals);
  });

  it('selects the sole pending dedicated worker goal before the active parent goal', () => {
    const conversation = buildConversation([
      {
        id: 'parent-deliverable',
        title: 'Create the final deliverable',
        status: 'active',
        completionPolicy: 'blocking',
        dependencies: [],
        evidence: [],
        successCriteria: ['evidence.artifact:artifacts/report.md'],
        createdAt: 1,
        updatedAt: 1,
      },
      buildDedicatedWorkerGoal({ status: 'pending' }),
    ]);

    const plan = resolveDelegatedWorkerSpawnPlan({
      request: { prompt: 'Read the assigned sources and return findings.' },
      conversation,
      parentConversationId: conversation.id,
      agentRunId: conversation.activeAgentRunId,
      liveWorkers: [],
    });

    expect(plan.status).toBe('ready');
    expect(plan.spawnGate).toEqual({ status: 'ready', workstreamId: 'worker-goal' });
  });

  it('requires an exact existing workstream when multiple dedicated goals are eligible', () => {
    const conversation = buildConversation([
      buildDedicatedWorkerGoal({ id: 'worker-a', status: 'pending' }),
      buildDedicatedWorkerGoal({ id: 'worker-b', status: 'pending' }),
    ]);

    const plan = resolveDelegatedWorkerSpawnPlan({
      request: { prompt: 'Run delegated research.' },
      conversation,
      parentConversationId: conversation.id,
      agentRunId: conversation.activeAgentRunId,
      liveWorkers: [],
    });

    expect(plan.status).toBe('error');
    expect(plan.response).toMatchObject({
      status: 'error',
      code: 'workstream_id_required',
      eligibleGoalIds: ['worker-a', 'worker-b'],
      repair: {
        retryable: true,
        invalidFields: ['workstreamId'],
      },
    });
  });

  it('runs under the workstream an earlier spawn reported', () => {
    const conversation = buildConversation([
      {
        id: 'parent-deliverable',
        title: 'Create the final deliverable',
        status: 'active',
        completionPolicy: 'blocking',
        dependencies: [],
        evidence: [],
        createdAt: 1,
        updatedAt: 1,
      },
      buildDedicatedWorkerGoal({ status: 'pending' }),
    ]);

    const plan = resolveDelegatedWorkerSpawnPlan({
      request: {
        prompt: 'Read the assigned sources and return findings.',
        workstreamId: 'worker-goal',
      },
      conversation,
      parentConversationId: conversation.id,
      agentRunId: conversation.activeAgentRunId,
      liveWorkers: [],
    });

    expect(plan.status).toBe('ready');
    expect(plan.spawnGate.workstreamId).toBe('worker-goal');
  });

  it('refuses a workstream nothing reported, and says to omit it for new work', () => {
    const conversation = buildConversation([buildDedicatedWorkerGoal()]);

    const plan = resolveDelegatedWorkerSpawnPlan({
      request: { prompt: 'Run delegated research.', workstreamId: 'research-task' },
      conversation,
      parentConversationId: conversation.id,
      agentRunId: conversation.activeAgentRunId,
      liveWorkers: [],
    });

    expect(plan.status).toBe('error');
    expect(plan.response).toMatchObject({
      code: 'invalid_workstream',
      repair: { retryable: true, invalidFields: ['workstreamId'] },
    });
    expect(String(plan.response?.error)).toContain('omit it to start new work');
  });

  it('returns repairable errors for dependency ids that are not in the current goal graph', () => {
    const conversation = buildConversation([buildDedicatedWorkerGoal()]);

    const plan = resolveDelegatedWorkerSpawnPlan({
      request: {
        prompt: 'Run delegated research.',
        workstreamId: 'worker-goal',
        dependsOnWorkstreams: ['missing-goal'],
      },
      conversation,
      parentConversationId: conversation.id,
      agentRunId: conversation.activeAgentRunId,
      liveWorkers: [],
    });

    expect(plan.status).toBe('error');
    expect(plan.response).toMatchObject({
      status: 'error',
      code: 'unresolved_dependency',
      repair: {
        retryable: true,
        invalidFields: ['dependsOnWorkstreams'],
      },
    });
  });

  it('returns a repairable error when workstreamId has a malformed runtime shape', () => {
    const conversation = buildConversation([buildDedicatedWorkerGoal()]);

    const plan = resolveDelegatedWorkerSpawnPlan({
      request: {
        prompt: 'Run delegated research.',
        workstreamId: 7 as unknown as string,
      },
      conversation,
      parentConversationId: conversation.id,
      agentRunId: conversation.activeAgentRunId,
      liveWorkers: [],
    });

    expect(plan.status).toBe('error');
    expect(plan.response).toMatchObject({
      status: 'error',
      code: 'invalid_workstream',
      repair: { retryable: true, invalidFields: ['workstreamId'] },
    });
  });

  it('refuses a workstream that is already complete', () => {
    const conversation = buildConversation([
      buildDedicatedWorkerGoal({ id: 'completed-goal', status: 'completed' }),
    ]);

    const plan = resolveDelegatedWorkerSpawnPlan({
      request: { prompt: 'Run delegated research.', workstreamId: 'completed-goal' },
      conversation,
      parentConversationId: conversation.id,
      agentRunId: conversation.activeAgentRunId,
      liveWorkers: [],
    });

    expect(plan.status).toBe('error');
    expect(plan.response).toMatchObject({
      status: 'error',
      code: 'invalid_workstream',
      repair: { invalidFields: ['workstreamId'] },
    });
  });

  it('accepts a coordinate goal with code-owned terminal worker evidence', () => {
    const conversation = buildConversation([
      {
        id: 'worker-goal',
        title: 'Evidence auditor',
        status: 'active',
        completionPolicy: 'blocking',
        owner: DELEGATED_WORKER_GOAL_OWNER,
        dependencies: [],
        evidence: [],
        requiredCapabilities: ['coordinate'],
        successCriteria: ['evidence.prefix:worker', 'evidence.min:1'],
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    const plan = resolveDelegatedWorkerSpawnPlan({
      request: {
        prompt: 'Read the source and return findings.',
        workstreamId: 'worker-goal',
      },
      conversation,
      parentConversationId: conversation.id,
      agentRunId: conversation.activeAgentRunId,
      liveWorkers: [],
    });

    expect(plan.status).toBe('ready');
    expect(plan.spawnGate).toMatchObject({ status: 'ready', workstreamId: 'worker-goal' });
  });

  it.each(['completed', 'error', 'cancelled'] as const)(
    'does not replace a %s worker that already owns the same workstream in the current run',
    (status) => {
      const conversation = buildConversation([buildDedicatedWorkerGoal()]);
      const priorWorker: SubAgentSnapshot = {
        sessionId: `worker-${status}`,
        parentConversationId: conversation.id,
        agentRunId: conversation.activeAgentRunId,
        workstreamId: 'worker-goal',
        name: 'focused-worker',
        depth: 0,
        startedAt: 2,
        updatedAt: 3,
        status,
        sandboxPolicy: 'inherit',
      };

      const plan = resolveDelegatedWorkerSpawnPlan({
        request: {
          prompt: 'Replace the prior worker.',
          name: 'focused-worker',
          workstreamId: 'worker-goal',
        },
        conversation,
        parentConversationId: conversation.id,
        agentRunId: conversation.activeAgentRunId,
        liveWorkers: [priorWorker],
      });

      expect(plan.status).toBe('blocked');
      expect(plan.response).toMatchObject({
        status: 'blocked',
        code: 'worker_workstream_already_owned',
        sessionId: priorWorker.sessionId,
        workerStatus: status,
      });
    },
  );

  it('rejects replacement from the graph-owned launch receipt after runtime snapshots expire', () => {
    const conversation = buildConversation([
      buildDedicatedWorkerGoal({
        evidence: ['delegation_launch:sub-owned-worker'],
      }),
    ]);

    const plan = resolveDelegatedWorkerSpawnPlan({
      request: {
        prompt: 'Launch another worker for the same unit.',
        workstreamId: 'worker-goal',
      },
      conversation,
      parentConversationId: conversation.id,
      agentRunId: conversation.activeAgentRunId,
      liveWorkers: [],
    });

    expect(plan.status).toBe('blocked');
    expect(plan.response).toMatchObject({
      status: 'blocked',
      code: 'worker_workstream_already_owned',
      sessionId: 'sub-owned-worker',
      goalId: 'worker-goal',
    });
  });

  it('allows the next structured workstream after a terminal worker', () => {
    const conversation = buildConversation([
      buildDedicatedWorkerGoal({
        id: 'worker-goal-a',
        title: 'First delegated workstream',
      }),
      buildDedicatedWorkerGoal({
        id: 'worker-goal-b',
        title: 'Second delegated workstream',
        status: 'pending',
      }),
    ]);

    const plan = resolveDelegatedWorkerSpawnPlan({
      request: { prompt: 'Run the next unit.', workstreamId: 'worker-goal-b' },
      conversation,
      parentConversationId: conversation.id,
      agentRunId: conversation.activeAgentRunId,
      liveWorkers: [
        {
          sessionId: 'worker-a',
          parentConversationId: conversation.id,
          agentRunId: conversation.activeAgentRunId,
          workstreamId: 'worker-goal-a',
          depth: 0,
          startedAt: 2,
          updatedAt: 3,
          status: 'completed',
          sandboxPolicy: 'inherit',
        },
      ],
    });

    expect(plan.status).toBe('ready');
    expect(plan.spawnGate).toMatchObject({ status: 'ready', workstreamId: 'worker-goal-b' });
  });

  it('does not reuse a terminal worker name after goal structure changes in the same run', () => {
    const conversation = buildConversation([buildDedicatedWorkerGoal()]);
    const priorWorker: SubAgentSnapshot = {
      sessionId: 'worker-unscoped',
      parentConversationId: conversation.id,
      agentRunId: conversation.activeAgentRunId,
      name: 'evidence auditor',
      depth: 0,
      startedAt: 2,
      updatedAt: 3,
      status: 'completed',
      sandboxPolicy: 'inherit',
    };

    const plan = resolveDelegatedWorkerSpawnPlan({
      request: {
        prompt: 'Repeat the audit after compaction.',
        name: 'evidence auditor',
        workstreamId: 'worker-goal',
      },
      conversation,
      parentConversationId: conversation.id,
      agentRunId: conversation.activeAgentRunId,
      liveWorkers: [priorWorker],
    });

    expect(plan.status).toBe('blocked');
    expect(plan.response).toMatchObject({
      status: 'blocked',
      code: 'worker_identity_already_owned',
      sessionId: priorWorker.sessionId,
      workerStatus: 'completed',
    });
  });
});
