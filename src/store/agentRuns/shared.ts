import type { AgentRun, AgentRunCheckpoint, AgentRunEvidenceEntry } from '../../types/agentRun';
import type { Conversation } from '../../types/conversation';
import { generateId } from '../../utils/id';
import { normalizeAgentRunEvidenceEntries } from '../../services/agents/lifecycle/evidence';
import type { AgentRunEvidenceDraft } from '../../services/agents/lifecycle/evidenceTypes';
import {
  createInitialAgentRunPhases,
  mergeAgentRunPlan,
  mergeAgentRunSummary,
} from '../../services/agents/agentRunStateModel';
import {
  normalizeAgentRunControlGraphState,
  updateAgentRunControlGraphAsyncWorkState,
} from '../../services/agents/agentControlGraphState';

const MAX_AGENT_RUN_CHECKPOINTS = 64;

export function normalizeAgentRunEvidence(
  evidence: ReadonlyArray<AgentRunEvidenceEntry | AgentRunEvidenceDraft> | undefined,
): AgentRunEvidenceEntry[] | undefined {
  const normalized = normalizeAgentRunEvidenceEntries(evidence);
  return normalized.length > 0 ? normalized : undefined;
}

export function areAgentRunEvidenceEntriesEqual(
  left: AgentRunEvidenceEntry[] | undefined,
  right: AgentRunEvidenceEntry[] | undefined,
): boolean {
  if (left === right) {
    return true;
  }

  if (!left?.length && !right?.length) {
    return true;
  }

  if (!left || !right || left.length !== right.length) {
    return false;
  }

  return left.every((leftEntry, index) => {
    const rightEntry = right[index];
    return (
      leftEntry.id === rightEntry.id &&
      leftEntry.kind === rightEntry.kind &&
      leftEntry.status === rightEntry.status &&
      leftEntry.recorder === rightEntry.recorder &&
      leftEntry.title === rightEntry.title &&
      leftEntry.content === rightEntry.content &&
      leftEntry.dedupeKey === rightEntry.dedupeKey &&
      leftEntry.sourceName === rightEntry.sourceName &&
      leftEntry.sourceUri === rightEntry.sourceUri &&
      leftEntry.toolName === rightEntry.toolName &&
      leftEntry.workerSessionId === rightEntry.workerSessionId &&
      leftEntry.artifactWorkspacePath === rightEntry.artifactWorkspacePath &&
      leftEntry.createdAt === rightEntry.createdAt &&
      leftEntry.updatedAt === rightEntry.updatedAt &&
      JSON.stringify(leftEntry.tags ?? []) === JSON.stringify(rightEntry.tags ?? [])
    );
  });
}

export function appendAgentCheckpoint(
  run: AgentRun,
  entry: Omit<AgentRunCheckpoint, 'id'>,
): AgentRun {
  const checkpoint: AgentRunCheckpoint = {
    id: generateId(),
    ...entry,
  };
  const nextCheckpoints = [...run.checkpoints, checkpoint];
  const trimmedCheckpoints =
    nextCheckpoints.length > MAX_AGENT_RUN_CHECKPOINTS
      ? [nextCheckpoints[0], ...nextCheckpoints.slice(-(MAX_AGENT_RUN_CHECKPOINTS - 1))]
      : nextCheckpoints;

  return {
    ...run,
    updatedAt: Math.max(run.updatedAt, checkpoint.timestamp),
    checkpoints: trimmedCheckpoints,
  };
}

export function resolveTargetAgentRunId(
  conversation: Conversation,
  runId?: string,
): string | undefined {
  return runId ?? conversation.activeAgentRunId;
}

export function isTargetAgentRun(
  run: AgentRun,
  targetRunId: string | undefined,
  allowTerminalUpdates = false,
): boolean {
  if (!targetRunId || run.id !== targetRunId) {
    return false;
  }

  return allowTerminalUpdates || run.status === 'running';
}

export function normalizePersistedAgentRun(run: AgentRun): AgentRun {
  const timestamp = run.updatedAt ?? run.createdAt ?? Date.now();
  const goal = run.goal?.trim() || 'Complete the current task.';
  const plan = mergeAgentRunPlan(run.plan, undefined, goal, timestamp);
  const {
    routeState: _legacyRouteState,
    awaitingBackgroundWorkers: _legacyAwaitingBackgroundWorkers,
    pendingAsyncOperations: _legacyPendingAsyncOperations,
    ...runWithoutLegacyControlState
  } = run as AgentRun & {
    routeState?: unknown;
    awaitingBackgroundWorkers?: unknown;
    pendingAsyncOperations?: unknown;
  };
  const checkpoints =
    run.checkpoints?.length > MAX_AGENT_RUN_CHECKPOINTS
      ? [run.checkpoints[0], ...run.checkpoints.slice(-(MAX_AGENT_RUN_CHECKPOINTS - 1))]
      : run.checkpoints?.length
        ? run.checkpoints
        : [];
  const normalizedControlGraph = normalizeAgentRunControlGraphState(run.controlGraph);
  const pendingAsyncOperations =
    run.status === 'running' && normalizedControlGraph?.asyncWork.pendingOperations.length
      ? normalizedControlGraph.asyncWork.pendingOperations
      : undefined;
  const awaitingBackgroundWorkers =
    run.status === 'running'
      ? normalizedControlGraph?.asyncWork.awaitingBackgroundWorkers === true
      : false;
  const controlGraph = normalizedControlGraph
    ? updateAgentRunControlGraphAsyncWorkState(normalizedControlGraph, {
        awaitingBackgroundWorkers,
        pendingOperations: pendingAsyncOperations ?? [],
        updatedAt: timestamp,
      })
    : undefined;

  return {
    ...runWithoutLegacyControlState,
    goal,
    phases: run.phases?.length ? run.phases : createInitialAgentRunPhases(timestamp),
    checkpoints,
    summary: mergeAgentRunSummary(run.summary),
    plan,
    evidence: normalizeAgentRunEvidence(run.evidence),
    controlGraph,
    terminalReason: run.terminalReason,
  };
}
