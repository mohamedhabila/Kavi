// ---------------------------------------------------------------------------
// Kavi — Delegation acceptance fixture graph builders (graph-owned)
// ---------------------------------------------------------------------------

import { createInitialAgentRunControlGraphState } from '../../services/agents/agentControlGraphState';
import {
  createDefaultAgentRunPlan,
  createInitialAgentRunPhases,
  mergeAgentRunSummary,
} from '../../services/agents/agentRunStateModel';
import { applySubAgentTerminalControlGraphEffects } from '../../services/agents/subAgentGoalGraphEffects';
import type { AgentGoal, AgentRun } from '../../types/agentRun';
import type { SubAgentSnapshot } from '../../types/subAgent';
import { reduceAgentControlGraph } from './agentControlGraph';

const NOW = 1;

export function buildDelegationFixtureAgentRun(
  goals: AgentGoal[],
  runId = 'run-delegation',
): AgentRun {
  const controlGraph = reduceAgentControlGraph(
    createInitialAgentRunControlGraphState({ updatedAt: NOW }),
    [
      {
        type: 'GOALS_UPDATED',
        goals,
        timestamp: NOW,
      },
    ],
  );

  return {
    id: runId,
    userMessageId: 'fixture-user',
    goal: 'fixture delegation',
    status: 'running',
    createdAt: NOW,
    updatedAt: NOW,
    currentPhase: 'assess',
    phases: createInitialAgentRunPhases(NOW),
    checkpoints: [],
    plan: createDefaultAgentRunPlan('fixture delegation', NOW),
    evidence: [],
    summary: mergeAgentRunSummary(undefined, {}),
    controlGraph,
  };
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

export function buildGoalsAfterDelegationWorkerTerminal(status: AgentGoal['status']): AgentGoal[] {
  const baseGraph = reduceAgentControlGraph(
    createInitialAgentRunControlGraphState({ updatedAt: 100 }),
    [
      {
        type: 'GOALS_UPDATED',
        goals: [
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
        ],
        timestamp: 100,
      },
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
    ],
  );

  const run = buildDelegationFixtureAgentRun(baseGraph.goals ?? [], 'run-delegation-evidence');
  run.controlGraph = baseGraph;

  const nextGraph = applySubAgentTerminalControlGraphEffects({
    run,
    agent: buildDelegationWorkerSnapshot(),
    event: 'completed',
    timestamp: 200,
  });

  return (nextGraph?.goals ?? []).map((entry) => ({
    ...entry,
    status,
  }));
}
