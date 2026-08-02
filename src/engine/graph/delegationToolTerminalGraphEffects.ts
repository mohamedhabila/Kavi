// ---------------------------------------------------------------------------
// Kavi — Delegation tool terminal results → control graph events
// ---------------------------------------------------------------------------

import type { AgentRun } from '../../types/agentRun';
import type {
  SubAgentCompletionState,
  SubAgentLifecycleEvent,
  SubAgentSnapshot,
  SubAgentStatus,
  SubAgentTerminationCause,
} from '../../types/subAgent';
import { buildSubAgentTerminalControlGraphEvents } from '../../services/agents/subAgentGoalGraphEffects';
import type { AgentControlGraphEvent } from './agentControlGraphTypes';
import { normalizeToolName } from '../tools/toolNameNormalization';
import { applyGoalMutation } from '../goals/graphState';
import {
  buildDelegatedWorkerLaunchEvidence,
  readDelegatedWorkerLaunchSessionId,
} from '../goals/delegation';
import { getGoalById } from '../goals/types';

const DELEGATION_TERMINAL_TOOL_NAMES = new Set([
  'sessions_spawn',
  'sessions_send',
  'sessions_wait',
]);
const SUCCESSFUL_TERMINAL_STATUSES = new Set(['completed', 'complete', 'success', 'succeeded']);
const TERMINAL_STATUSES = new Set([
  ...SUCCESSFUL_TERMINAL_STATUSES,
  'cancelled',
  'canceled',
  'blocked',
  'error',
  'failed',
  'incomplete',
  'timeout',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSuccessfulTerminalStatus(value: unknown): boolean {
  return typeof value === 'string' && SUCCESSFUL_TERMINAL_STATUSES.has(value.trim().toLowerCase());
}

function isVerifiedCompletionState(value: unknown): boolean {
  return value === 'verified_success';
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const entries = value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean);
  return entries.length > 0 ? entries : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function resolveDelegationPayloadFromSpill(
  parsed: Record<string, unknown>,
  toolName: string,
): Record<string, unknown> {
  if (parsed.status !== 'spilled' || !isRecord(parsed.structuralResult)) return parsed;
  const structural = parsed.structuralResult;
  if (
    structural.version !== 1 ||
    structural.kind !== 'delegation_sessions' ||
    !Array.isArray(structural.sessions)
  ) {
    return parsed;
  }
  const sessions = structural.sessions.filter(isRecord);
  if (toolName === 'sessions_spawn' && sessions.length === 1) return sessions[0];
  return { sessions };
}

function readCompletionState(value: unknown): SubAgentCompletionState | undefined {
  return value === 'verified_success' || value === 'blocked' || value === 'incomplete'
    ? value
    : undefined;
}

function readTerminalStatus(value: unknown): SubAgentStatus | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (SUCCESSFUL_TERMINAL_STATUSES.has(normalized)) return 'completed';
  if (normalized === 'blocked' || normalized === 'incomplete') return 'completed';
  if (normalized === 'cancelled' || normalized === 'canceled') return 'cancelled';
  if (normalized === 'timeout') return 'timeout';
  if (normalized === 'error' || normalized === 'failed') return 'error';
  return undefined;
}

function readTerminationCause(value: unknown, status: SubAgentStatus): SubAgentTerminationCause {
  const allowed = new Set<SubAgentTerminationCause>([
    'completed',
    'app_restart',
    'timeout',
    'cancelled',
    'provider_failure',
    'tool_failure',
    'internal_failure',
    'preflight_rejected',
    'iteration_limit',
    'unknown',
  ]);
  if (typeof value === 'string' && allowed.has(value as SubAgentTerminationCause)) {
    return value as SubAgentTerminationCause;
  }
  if (status === 'completed') return 'completed';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'timeout') return 'timeout';
  return 'unknown';
}

function parseTerminalDelegationRecord(
  parsed: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (
    typeof parsed.status === 'string' &&
    TERMINAL_STATUSES.has(parsed.status.trim().toLowerCase())
  ) {
    return parsed;
  }

  if (Array.isArray(parsed.sessions)) {
    for (const session of parsed.sessions) {
      if (
        isRecord(session) &&
        typeof session.status === 'string' &&
        TERMINAL_STATUSES.has(session.status.trim().toLowerCase())
      ) {
        return session;
      }
    }
  }

  return undefined;
}

function buildWorkerSnapshotFromTerminalRecord(
  record: Record<string, unknown>,
): SubAgentSnapshot | undefined {
  const sessionId = readString(record.sessionId);
  const status = readTerminalStatus(record.status);
  if (!sessionId || !status) {
    return undefined;
  }

  const output =
    readString(record.output) ?? readString(record.outputPreview) ?? readString(record.error);
  const lastToolResultPreview = readString(record.lastToolResultPreview);
  const completionState = readCompletionState(record.completionState);
  if (completionState === 'verified_success' && !output && !lastToolResultPreview) {
    return undefined;
  }

  return {
    sessionId,
    parentConversationId: '',
    depth: readNumber(record.depth) ?? 1,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    status,
    terminationCause: readTerminationCause(record.terminationCause, status),
    ...(completionState ? { completionState } : {}),
    sandboxPolicy: 'inherit',
    launchState: 'terminal',
    output,
    lastToolResultPreview,
    workstreamId: readString(record.workstreamId),
    name: readString(record.name),
    toolsUsed: readStringArray(record.toolsUsed),
    iterations: readNumber(record.iterations),
  };
}

function resolveWorkerLifecycleEvent(status: SubAgentStatus): SubAgentLifecycleEvent {
  return status === 'running' ? 'error' : status;
}

function buildRunningSpawnGraphEvents(params: {
  record: Record<string, unknown>;
  run: Pick<AgentRun, 'controlGraph'>;
  timestamp: number;
}): AgentControlGraphEvent[] {
  const graph = params.run.controlGraph;
  const sessionId = readString(params.record.sessionId);
  const goalId = readString(params.record.workstreamId);
  if (!graph || !sessionId || !goalId || !getGoalById(graph.goals ?? [], goalId)) return [];

  const events: AgentControlGraphEvent[] = [];
  const activation = applyGoalMutation(
    graph.goals ?? [],
    { action: 'activate', goals: [{ id: goalId }] },
    params.timestamp,
  );
  if (activation.errors.length === 0) {
    events.push({
      type: 'GOALS_UPDATED',
      goals: activation.goals,
      reason: 'delegation:worker_launched',
      timestamp: params.timestamp,
    });
  }

  const launchEvidence = buildDelegatedWorkerLaunchEvidence(sessionId);
  const goal = getGoalById(graph.goals ?? [], goalId);
  if (!goal?.evidence.some((entry) => readDelegatedWorkerLaunchSessionId(entry) === sessionId)) {
    events.push({
      type: 'GOAL_EVIDENCE_ADDED',
      goalId,
      evidence: launchEvidence,
      timestamp: params.timestamp,
    });
  }
  return events;
}

function buildBlockedWorkerGoalEvents(params: {
  worker: SubAgentSnapshot;
  run: Pick<AgentRun, 'controlGraph'>;
  timestamp: number;
}): AgentControlGraphEvent[] {
  const graph = params.run.controlGraph;
  const goalId = params.worker.workstreamId?.trim();
  const existingGoal = graph && goalId ? getGoalById(graph.goals ?? [], goalId) : undefined;
  if (!graph || !goalId || !existingGoal) return [];

  const reason = `Worker ${params.worker.sessionId} ended with ${params.worker.completionState ?? params.worker.status}.`;
  const goals = (graph.goals ?? []).map((goal) =>
    goal.id === goalId
      ? {
          ...goal,
          status: 'blocked' as const,
          blockedReason: reason,
          updatedAt: params.timestamp,
        }
      : goal,
  );
  return [
    {
      type: 'GOALS_UPDATED',
      goals,
      reason: 'delegation:worker_not_verified',
      timestamp: params.timestamp,
    },
  ];
}

export function buildDelegationToolTerminalGraphEvents(params: {
  toolName: string;
  resultContent: string;
  run: Pick<AgentRun, 'controlGraph'>;
  timestamp?: number;
}): { events: AgentControlGraphEvent[]; applied: boolean } {
  const normalizedToolName = normalizeToolName(params.toolName);
  if (!DELEGATION_TERMINAL_TOOL_NAMES.has(normalizedToolName)) {
    return { events: [], applied: false };
  }

  if (!params.run.controlGraph) {
    return { events: [], applied: false };
  }

  let parsed: Record<string, unknown> | undefined;
  try {
    const raw = JSON.parse(params.resultContent) as unknown;
    parsed = isRecord(raw) ? raw : undefined;
  } catch {
    return { events: [], applied: false };
  }

  if (!parsed) {
    return { events: [], applied: false };
  }
  parsed = resolveDelegationPayloadFromSpill(parsed, normalizedToolName);

  const timestamp = params.timestamp ?? Date.now();
  if (
    normalizedToolName === 'sessions_spawn' &&
    parsed.status === 'running' &&
    readString(parsed.sessionId)
  ) {
    const events = buildRunningSpawnGraphEvents({ record: parsed, run: params.run, timestamp });
    return { events, applied: events.length > 0 };
  }

  const terminalRecord = parseTerminalDelegationRecord(parsed);
  if (!terminalRecord) {
    return { events: [], applied: false };
  }

  const worker = buildWorkerSnapshotFromTerminalRecord(terminalRecord);
  if (!worker) {
    return { events: [], applied: false };
  }

  const terminalEvents = buildSubAgentTerminalControlGraphEvents({
    run: params.run,
    agent: worker,
    event: resolveWorkerLifecycleEvent(worker.status),
    timestamp,
  });
  const verified =
    worker.status === 'completed' &&
    isSuccessfulTerminalStatus(terminalRecord.status) &&
    isVerifiedCompletionState(worker.completionState);
  const events = verified
    ? terminalEvents
    : [...buildBlockedWorkerGoalEvents({ worker, run: params.run, timestamp }), ...terminalEvents];

  const applied = events.some(
    (event) => event.type === 'GOAL_EVIDENCE_ADDED' || event.type === 'GOALS_UPDATED',
  );
  return { events, applied };
}
