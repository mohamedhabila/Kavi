// ---------------------------------------------------------------------------
// Kavi — Delegation spawn gate fixtures (structural)
// ---------------------------------------------------------------------------

import { buildDelegationFixtureAgentRun } from './delegationGraphFixtures';
import type { DelegatedWorkerSpawnRequest } from '../../engine/graph/delegatedWorkerSpawn';
import {
  DELEGATED_WORKER_EVIDENCE_CRITERION,
  DELEGATED_WORKER_GOAL_OWNER,
  DELEGATED_WORKER_MIN_EVIDENCE_CRITERION,
} from '../../engine/goals/delegation';
import type { AgentGoal } from '../../types/agentRun';
import type { Conversation } from '../../types/conversation';
import type { SubAgentSnapshot } from '../../types/subAgent';

export type DelegationSpawnExpectation = 'must_block' | 'must_ready';

export type DelegationSpawnFixture = {
  id: string;
  expectation: DelegationSpawnExpectation;
  request: DelegatedWorkerSpawnRequest;
  conversation: Conversation;
  liveWorkers?: SubAgentSnapshot[];
  agentRunId?: string;
};

const NOW = 1;

function goal(overrides: Partial<AgentGoal> = {}): AgentGoal {
  return {
    id: 'worker-goal',
    title: 'Delegated work',
    status: 'pending',
    completionPolicy: 'blocking',
    owner: DELEGATED_WORKER_GOAL_OWNER,
    dependencies: [],
    evidence: [],
    requiredCapabilities: ['coordinate'],
    successCriteria: [DELEGATED_WORKER_EVIDENCE_CRITERION, DELEGATED_WORKER_MIN_EVIDENCE_CRITERION],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function buildConversation(goals: AgentGoal[]): Conversation {
  const run = buildDelegationFixtureAgentRun(goals);

  return {
    id: 'conv-delegation',
    title: 'Delegation fixture',
    providerId: 'gemini',
    systemPrompt: 'system',
    messages: [],
    createdAt: NOW,
    updatedAt: NOW,
    activeAgentRunId: run.id,
    agentRuns: [run],
  };
}

export const DELEGATION_SPAWN_FIXTURES: DelegationSpawnFixture[] = [
  {
    id: 'blocked-dependency-incomplete',
    expectation: 'must_block',
    request: {
      prompt: 'Research delegated topic.',
      workstreamId: 'worker-goal',
      dependsOnWorkstreams: ['dep-goal'],
    },
    conversation: buildConversation([
      goal({ id: 'dep-goal', title: 'Prerequisite', status: 'active' }),
      goal({ id: 'worker-goal', title: 'Delegated work', status: 'pending' }),
    ]),
  },
  {
    id: 'blocked-dependency-missing',
    expectation: 'must_block',
    request: {
      prompt: 'Research delegated topic.',
      workstreamId: 'worker-goal',
      dependsOnWorkstreams: ['missing-goal'],
    },
    conversation: buildConversation([goal({ id: 'worker-goal', status: 'pending' })]),
  },
  {
    id: 'allowed-dependency-complete',
    expectation: 'must_ready',
    request: {
      prompt: 'Research delegated topic.',
      workstreamId: 'worker-goal',
      dependsOnWorkstreams: ['dep-goal'],
    },
    conversation: buildConversation([
      goal({ id: 'dep-goal', title: 'Prerequisite', status: 'completed' }),
      goal({ id: 'worker-goal', title: 'Delegated work', status: 'pending' }),
    ]),
  },
  {
    id: 'allowed-no-dependencies',
    expectation: 'must_ready',
    request: {
      prompt: 'Research delegated topic.',
      workstreamId: 'worker-goal',
    },
    conversation: buildConversation([goal({ id: 'worker-goal', status: 'active' })]),
  },
  {
    id: 'blocked-duplicate-running-worker',
    expectation: 'must_block',
    request: {
      prompt: 'Research delegated topic.',
      workstreamId: 'worker-goal',
      name: 'researcher',
    },
    conversation: buildConversation([goal({ id: 'worker-goal', status: 'active' })]),
    liveWorkers: [
      {
        sessionId: 'sub-running',
        parentConversationId: 'conv-delegation',
        agentRunId: 'run-delegation',
        depth: 1,
        startedAt: NOW,
        updatedAt: NOW,
        status: 'running',
        sandboxPolicy: 'inherit',
        launchState: 'active',
        workstreamId: 'worker-goal',
        name: 'researcher',
      },
    ],
  },
];
