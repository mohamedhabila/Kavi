import type {
  AgentRun,
  AgentRunAsyncOperation,
  AgentRunControlGraphState,
} from '../../types/agentRun';
import type { SubAgentLifecycleEvent, SubAgentSnapshot } from '../../types/subAgent';
import { reduceAgentControlGraph } from '../../engine/graph/agentControlGraph';
import type { AgentControlGraphEvent } from '../../engine/graph/agentControlGraphTypes';
import { createGoal, getActiveGoal, getGoalById } from '../../engine/goals/types';
import {
  DELEGATED_WORKER_EVIDENCE_CRITERION,
  DELEGATED_WORKER_GOAL_OWNER,
  DELEGATED_WORKER_MIN_EVIDENCE_CRITERION,
} from '../../engine/goals/delegation';
import { buildAutomaticSubAgentEvidenceEntries } from './automaticEvidence';

const MAX_GOAL_EVIDENCE_CHARS = 480;
const DELEGATION_WORKER_SUCCESS_CRITERIA = [
  DELEGATED_WORKER_EVIDENCE_CRITERION,
  DELEGATED_WORKER_MIN_EVIDENCE_CRITERION,
];

function truncateEvidence(value: string): string {
  if (value.length <= MAX_GOAL_EVIDENCE_CHARS) {
    return value;
  }
  return `${value.slice(0, MAX_GOAL_EVIDENCE_CHARS - 1).trimEnd()}…`;
}

function buildWorkerGoalEvidence(
  agent: SubAgentSnapshot,
  event: SubAgentLifecycleEvent,
): string | undefined {
  const entries = buildAutomaticSubAgentEvidenceEntries(agent, event);
  const primaryEntry = entries.find(
    (entry) => entry.status === 'verified' && entry.kind === 'summary',
  );
  if (!primaryEntry?.content) {
    return undefined;
  }

  const workerLabel = agent.name?.trim() || agent.sessionId;
  return truncateEvidence(`worker:${workerLabel}:${primaryEntry.content}`);
}

function buildWorkerGoalEvidenceEntries(
  agent: SubAgentSnapshot,
  event: SubAgentLifecycleEvent,
): string[] {
  const summaryEvidence = buildWorkerGoalEvidence(agent, event);
  if (!summaryEvidence) return [];

  const toolEvidence = Array.from(
    new Set(
      (agent.toolsUsed ?? [])
        .map((toolName) => toolName.trim())
        .filter(Boolean)
        .map((toolName) => `${toolName}:worker:${agent.sessionId}`),
    ),
  );
  return [summaryEvidence, ...toolEvidence];
}

function removeTerminalSessionOperations(
  operations: ReadonlyArray<AgentRunAsyncOperation> | undefined,
  sessionId: string,
): AgentRunAsyncOperation[] {
  return (operations ?? []).filter((operation) => operation.resourceId !== sessionId);
}

export function buildSubAgentTerminalControlGraphEvents(params: {
  run: Pick<AgentRun, 'controlGraph'>;
  agent: SubAgentSnapshot;
  event: SubAgentLifecycleEvent;
  timestamp?: number;
}): AgentControlGraphEvent[] {
  if (params.event === 'started') {
    return [];
  }

  const timestamp = params.timestamp ?? Date.now();
  const events: AgentControlGraphEvent[] = [];
  const goals = params.run.controlGraph?.goals ?? [];
  const goalId = params.agent.workstreamId?.trim() || getActiveGoal(goals)?.id;
  const evidenceEntries = buildWorkerGoalEvidenceEntries(params.agent, params.event);

  if (goalId && evidenceEntries.length > 0) {
    const existingGoal = getGoalById(goals, goalId);
    if (!existingGoal) {
      const materializedGoal = createGoal({
        id: goalId,
        title: params.agent.name?.trim() || goalId,
        status: 'active',
        owner: DELEGATED_WORKER_GOAL_OWNER,
        requiredCapabilities: ['coordinate'],
        successCriteria: DELEGATION_WORKER_SUCCESS_CRITERIA,
        completionPolicy: 'blocking',
        now: timestamp,
      });
      events.push({
        type: 'GOALS_UPDATED',
        goals: [...goals, materializedGoal],
        reason: 'delegation:materialize_workstream',
        timestamp,
      });
    }
    for (const evidence of evidenceEntries) {
      events.push({
        type: 'GOAL_EVIDENCE_ADDED',
        goalId,
        evidence,
        timestamp,
      });
    }
  }

  const currentGraph = params.run.controlGraph;
  const pendingOperations = removeTerminalSessionOperations(
    currentGraph?.asyncWork?.pendingOperations,
    params.agent.sessionId,
  );

  events.push({
    type: 'ASYNC_WAITING',
    pendingAsyncCount: pendingOperations.length,
    pendingOperations,
    timestamp,
  });

  return events;
}

export function applySubAgentTerminalControlGraphEffects(params: {
  run: Pick<AgentRun, 'controlGraph'>;
  agent: SubAgentSnapshot;
  event: SubAgentLifecycleEvent;
  timestamp?: number;
}): AgentRunControlGraphState | undefined {
  const events = buildSubAgentTerminalControlGraphEvents(params);
  if (events.length === 0 || !params.run.controlGraph) {
    return params.run.controlGraph;
  }

  return reduceAgentControlGraph(params.run.controlGraph, events);
}
