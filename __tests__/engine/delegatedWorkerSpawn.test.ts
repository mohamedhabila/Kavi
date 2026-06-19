import { resolveDelegatedWorkerSpawnPlan } from '../../src/engine/graph/delegatedWorkerSpawn';
import { buildDelegationFixtureAgentRun } from '../../src/engine/graph/delegationFixtureSupport';
import type { AgentGoal } from '../../src/types/agentRun';
import type { Conversation } from '../../src/types/conversation';

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

describe('resolveDelegatedWorkerSpawnPlan', () => {
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
      {
        id: 'worker-goal',
        title: 'Delegated work',
        status: 'pending',
        dependencies: [],
        evidence: [],
        createdAt: 1,
        updatedAt: 1,
      },
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

  it('returns repairable errors for dependency ids that are not in the current goal graph', () => {
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

  it('does not throw when optional goal scope fields have malformed runtime shapes', () => {
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

    expect(plan.status).toBe('ready');
    expect(plan.spawnGate.workstreamId).toBe('worker-goal');
  });
});
