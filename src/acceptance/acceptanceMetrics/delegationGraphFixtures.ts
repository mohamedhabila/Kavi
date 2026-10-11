// Delegation acceptance fixtures. This module is intentionally isolated from
// the product runtime so evaluation markers and synthetic graph state cannot
// influence chat behavior.

import type { AgentRun } from '../../types/agentRun';
import type { Conversation } from '../../types/conversation';
import { startAgentRunInConversation } from '../../store/agentRuns/lifecycle';

const NOW = 1;

function emptyFixtureConversation(): Conversation {
  return {
    id: 'conv-delegation',
    title: 'Delegation fixture',
    providerId: 'fixture',
    systemPrompt: 'fixture',
    messages: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

/** A started run, as the store holds it, for spawn plans to resolve against. */
export function buildDelegationFixtureAgentRun(runId = 'run-delegation'): AgentRun {
  const sourceMessageId = 'fixture-user';
  const started = startAgentRunInConversation(emptyFixtureConversation(), {
    goal: 'fixture delegation',
    runId,
    timestamp: NOW,
    userMessageId: sourceMessageId,
    workflowTaskAnchor: {
      sourceMessageId,
      content: 'fixture delegation',
      attachments: [],
    },
  });
  const run = started.agentRuns?.find((candidate) => candidate.id === runId);
  if (!run) throw new Error(`delegation_fixture_run_missing:${runId}`);
  return run;
}
