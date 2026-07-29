// Delegation acceptance fixtures. This module is intentionally isolated from
// the product runtime so evaluation markers and synthetic graph state cannot
// influence chat behavior.

import { applySubAgentTerminalControlGraphEffects } from '../../services/agents/subAgentGoalGraphEffects';
import type { AgentGoal, AgentRun } from '../../types/agentRun';
import type { Conversation } from '../../types/conversation';
import type { SubAgentSnapshot } from '../../types/subAgent';
import { reduceAgentControlGraph } from '../../engine/graph/agentControlGraph';
import { updateAgentRunControlGraphInConversation } from '../../store/agentRuns/graph';
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

function requireRun(conversation: Conversation, runId: string): AgentRun {
  const run = conversation.agentRuns?.find((candidate) => candidate.id === runId);
  if (!run) throw new Error(`delegation_fixture_run_missing:${runId}`);
  return run;
}

function buildDelegationFixtureConversation(
  goals: AgentGoal[],
  runId = 'run-delegation',
): Conversation {
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
  const run = requireRun(started, runId);
  const graphWithGoals = reduceAgentControlGraph(run.controlGraph, [
    {
      type: 'GOALS_UPDATED',
      goals,
      timestamp: NOW,
    },
  ]);
  return updateAgentRunControlGraphInConversation(started, graphWithGoals, runId);
}

export function buildDelegationFixtureAgentRun(
  goals: AgentGoal[],
  runId = 'run-delegation',
): AgentRun {
  return requireRun(buildDelegationFixtureConversation(goals, runId), runId);
}

function buildDelegationWorkerSnapshot(
  overrides: Partial<SubAgentSnapshot> = {},
): SubAgentSnapshot {
  return {
    sessionId: 'sub-worker',
    parentConversationId: 'conv-delegation',
    depth: 1,
    startedAt: 10,
    updatedAt: 20,
    status: 'completed',
    terminationCause: 'completed',
    completionState: 'verified_success',
    sandboxPolicy: 'inherit',
    launchState: 'terminal',
    output: 'E2E-WORKER-EVIDENCE-42',
    workstreamId: 'worker-goal',
    name: 'researcher',
    toolsUsed: ['write_file'],
    iterations: 1,
    ...overrides,
  };
}

export function buildGoalsAfterDelegationWorkerTerminal(
  status: AgentGoal['status'],
  workerOverrides: Partial<SubAgentSnapshot> = {},
): AgentGoal[] {
  const goals: AgentGoal[] = [
    {
      id: 'worker-goal',
      title: 'Delegated work',
      status: 'active',
      dependencies: [],
      evidence: [],
      successCriteria: ['evidence.prefix:worker', 'evidence.min:1'],
      createdAt: 1,
      updatedAt: 1,
    },
  ];
  const runId = 'run-delegation-evidence';
  const conversation = buildDelegationFixtureConversation(goals, runId);
  const run = requireRun(conversation, runId);
  const waitingGraph = reduceAgentControlGraph(run.controlGraph, [
    {
      type: 'ASYNC_WAITING',
      pendingAsyncCount: 1,
      pendingOperations: [
        {
          key: 'session:sub-worker',
          kind: 'session',
          resourceId: 'sub-worker',
          displayName: 'Worker',
          status: 'running',
          lastUpdatedByTool: 'sessions_spawn',
          updatedAt: 1000,
          monitorToolNames: ['sessions_wait'],
          waitToolName: 'sessions_wait',
          waitArgs: { sessionId: 'sub-worker', workstreamId: 'worker-goal' },
        },
      ],
      awaitingBackgroundWorkers: true,
      timestamp: 100,
    },
  ]);
  const waitingConversation = updateAgentRunControlGraphInConversation(
    conversation,
    waitingGraph,
    runId,
  );
  const waitingRun = requireRun(waitingConversation, runId);
  const nextGraph = applySubAgentTerminalControlGraphEffects({
    run: waitingRun,
    agent: buildDelegationWorkerSnapshot(workerOverrides),
    event: 'completed',
    timestamp: 200,
  });

  return (nextGraph?.goals ?? []).map((entry) => ({
    ...entry,
    status,
  }));
}
