// ---------------------------------------------------------------------------
// Kavi — Delegation spawn gate fixtures (structural)
// ---------------------------------------------------------------------------

import { buildDelegationFixtureAgentRun } from './delegationGraphFixtures';
import type { DelegatedWorkerSpawnRequest } from '../../engine/graph/delegatedWorkerSpawn';
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
const RUN_ID = 'run-delegation';

function buildConversation(): Conversation {
  const run = buildDelegationFixtureAgentRun(RUN_ID);
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

function worker(overrides: Partial<SubAgentSnapshot>): SubAgentSnapshot {
  return {
    sessionId: 'sub-worker',
    parentConversationId: 'conv-delegation',
    agentRunId: RUN_ID,
    depth: 1,
    startedAt: NOW,
    updatedAt: NOW,
    status: 'running',
    sandboxPolicy: 'inherit',
    launchState: 'active',
    ...overrides,
  };
}

const DELIVERED_DEPENDENCY = worker({
  sessionId: 'sub-dependency',
  workstreamId: 'dep-work',
  status: 'completed',
  completionState: 'verified_success',
  launchState: 'terminal',
});

export const DELEGATION_SPAWN_FIXTURES: DelegationSpawnFixture[] = [
  {
    id: 'blocked-dependency-incomplete',
    expectation: 'must_block',
    request: { prompt: 'Research delegated topic.', dependsOnWorkstreams: ['dep-work'] },
    conversation: buildConversation(),
    liveWorkers: [worker({ sessionId: 'sub-dependency', workstreamId: 'dep-work' })],
  },
  {
    id: 'blocked-dependency-missing',
    expectation: 'must_block',
    request: { prompt: 'Research delegated topic.', dependsOnWorkstreams: ['missing-work'] },
    conversation: buildConversation(),
  },
  {
    id: 'allowed-dependency-complete',
    expectation: 'must_ready',
    request: { prompt: 'Research delegated topic.', dependsOnWorkstreams: ['dep-work'] },
    conversation: buildConversation(),
    liveWorkers: [DELIVERED_DEPENDENCY],
  },
  {
    id: 'allowed-new-work',
    expectation: 'must_ready',
    request: { prompt: 'Research delegated topic.' },
    conversation: buildConversation(),
  },
  {
    id: 'allowed-named-new-work',
    expectation: 'must_ready',
    request: { prompt: 'Research delegated topic.', workstreamId: 'market-research' },
    conversation: buildConversation(),
  },
  {
    id: 'blocked-workstream-already-delivered',
    expectation: 'must_block',
    request: { prompt: 'Research delegated topic.', workstreamId: 'dep-work' },
    conversation: buildConversation(),
    liveWorkers: [DELIVERED_DEPENDENCY],
  },
  {
    id: 'blocked-duplicate-running-worker',
    expectation: 'must_block',
    request: {
      prompt: 'Research delegated topic.',
      workstreamId: 'worker-work',
      name: 'researcher',
    },
    conversation: buildConversation(),
    liveWorkers: [
      worker({ sessionId: 'sub-running', workstreamId: 'worker-work', name: 'researcher' }),
    ],
  },
];
