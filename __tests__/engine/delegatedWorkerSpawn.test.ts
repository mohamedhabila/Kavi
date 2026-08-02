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
  it('requires graph-owned scope before delegated work starts in an agent run', () => {
    const conversation = buildConversation([]);

    const plan = resolveDelegatedWorkerSpawnPlan({
      request: { prompt: 'Run delegated research.', name: 'researcher' },
      conversation,
      parentConversationId: conversation.id,
      agentRunId: conversation.activeAgentRunId,
      liveWorkers: [],
    });

    expect(plan.status).toBe('blocked');
    expect(plan.response).toMatchObject({
      status: 'blocked',
      code: 'goal_scope_required',
      repair: { retryable: true, requiredAction: 'update_goals' },
    });
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

  it('points to an existing eligible worker goal instead of asking for another one', () => {
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
      request: {
        prompt: 'Read the assigned sources and return findings.',
        workstreamId: 'parent-deliverable',
      },
      conversation,
      parentConversationId: conversation.id,
      agentRunId: conversation.activeAgentRunId,
      liveWorkers: [],
    });

    expect(plan.status).toBe('blocked');
    expect(plan.response).toMatchObject({
      code: 'dedicated_worker_goal_required',
      repair: {
        requiredAction: 'sessions_spawn',
        expectedShape: { arguments: { workstreamId: 'worker-goal' } },
      },
    });
    expect(plan.response?.guidance).toContain('Do not add or replace');
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

  it('returns a repairable error when optional goal scope fields have malformed runtime shapes', () => {
    const conversation = buildConversation([
      {
        id: 'worker-goal',
        title: 'Delegated work',
        status: 'active',
        dependencies: [],
        evidence: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    const plan = resolveDelegatedWorkerSpawnPlan({
      request: {
        prompt: 'Run delegated research.',
        workstreamId: 7 as unknown as string,
        goalScope: { goalIds: 'worker-goal' as unknown as string[] },
      },
      conversation,
      parentConversationId: conversation.id,
      agentRunId: conversation.activeAgentRunId,
      liveWorkers: [],
    });

    expect(plan.status).toBe('error');
    expect(plan.response).toMatchObject({
      status: 'error',
      code: 'invalid_goal_scope',
      repair: {
        retryable: true,
        invalidFields: ['goalScope', 'workstreamId'],
      },
    });
  });

  it.each([
    {
      label: 'explicit workstream',
      request: { prompt: 'Run delegated research.', workstreamId: 'completed-goal' },
    },
    {
      label: 'goal scope',
      request: {
        prompt: 'Run delegated research.',
        goalScope: { goalIds: ['completed-goal'] },
      },
    },
  ])('rejects a completed goal selected by $label', ({ request }) => {
    const conversation = buildConversation([
      {
        id: 'completed-goal',
        title: 'Completed work',
        status: 'completed',
        dependencies: [],
        evidence: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    const plan = resolveDelegatedWorkerSpawnPlan({
      request,
      conversation,
      parentConversationId: conversation.id,
      agentRunId: conversation.activeAgentRunId,
      liveWorkers: [],
    });

    expect(plan.status).toBe('error');
    expect(plan.response).toMatchObject({
      status: 'error',
      code: 'invalid_goal_scope',
      repair: { invalidFields: ['goalScope', 'workstreamId'] },
    });
  });

  it('blocks a selected workstream with conflicted constraint state', () => {
    const conversation = buildConversation([
      {
        id: 'worker-goal',
        title: 'Delegated work',
        status: 'active',
        completionPolicy: 'blocking',
        owner: DELEGATED_WORKER_GOAL_OWNER,
        dependencies: [],
        evidence: [],
        successCriteria: ['evidence.tool:read_file'],
        userConstraintIntegrity: 'conflict',
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    const plan = resolveDelegatedWorkerSpawnPlan({
      request: {
        prompt: 'Run delegated research.',
        workstreamId: 'worker-goal',
      },
      conversation,
      parentConversationId: conversation.id,
      agentRunId: conversation.activeAgentRunId,
      liveWorkers: [],
    });

    expect(plan.status).toBe('blocked');
    expect(plan.response).toEqual({
      status: 'blocked',
      code: 'user_constraint_state_conflict',
      error: 'Goal "worker-goal" has conflicted user constraint state.',
    });
  });

  it('requires a separate worker goal instead of scoping the worker to the parent deliverable', () => {
    const conversation = buildConversation([
      {
        id: 'parent-deliverable',
        title: 'Create the final audit artifacts',
        description: 'Read all inputs and create every requested parent artifact.',
        status: 'active',
        completionPolicy: 'blocking',
        dependencies: [],
        evidence: [],
        requiredCapabilities: ['read', 'write', 'sessions'],
        successCriteria: [
          'evidence.artifact:artifacts/report.md',
          'evidence.artifact:artifacts/summary.json',
        ],
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    const plan = resolveDelegatedWorkerSpawnPlan({
      request: {
        prompt: 'Read the first half and return findings only.',
        workstreamId: 'parent-deliverable',
      },
      conversation,
      parentConversationId: conversation.id,
      agentRunId: conversation.activeAgentRunId,
      liveWorkers: [],
    });

    expect(plan.status).toBe('blocked');
    expect(plan.response).toMatchObject({
      status: 'blocked',
      code: 'dedicated_worker_goal_required',
      repair: {
        retryable: true,
        requiredAction: 'update_goals',
        invalidGoalId: 'parent-deliverable',
        expectedShape: {
          arguments: {
            action: 'add',
            owner: DELEGATED_WORKER_GOAL_OWNER,
            requiredCapabilities: ['coordinate'],
            successCriteria: ['evidence.prefix:worker', 'evidence.min:1'],
          },
        },
      },
    });
  });

  it('requires a coordinate goal to verify the terminal worker result before launch', () => {
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
        successCriteria: ['evidence.tool:read_file', 'evidence.min:10'],
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

    expect(plan.status).toBe('blocked');
    expect(plan.response).toMatchObject({
      status: 'blocked',
      code: 'worker_evidence_contract_required',
      repair: {
        retryable: true,
        requiredAction: 'update_goals',
        expectedShape: {
          arguments: {
            action: 'update',
            id: 'worker-goal',
            name: 'Evidence auditor',
            successCriteria: ['evidence.prefix:worker', 'evidence.min:1'],
          },
        },
      },
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
