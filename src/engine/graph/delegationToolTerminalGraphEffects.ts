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
import { buildSubAgentTerminalControlGraphEvents } from '../../services/agents/subAgentTerminalGraphEffects';
import { reduceAgentControlGraph } from './agentControlGraph';
import type { AgentControlGraphEvent } from './agentControlGraphTypes';
import { normalizeToolName } from '../tools/toolNameNormalization';

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

function hasTerminalStatus(record: Record<string, unknown>): boolean {
  return (
    typeof record.status === 'string' && TERMINAL_STATUSES.has(record.status.trim().toLowerCase())
  );
}

/**
 * The terminal worker records a delegation result carries. A wait result reports every
 * session it waited on under `sessions`; its own top-level `status` only summarizes them
 * and names no session. Reading that summary as the worker — as this did whenever it was
 * terminal — produced no worker at all, so a worker that finished `verified_success` and
 * was collected with `sessions_wait` never reached its goal: live, the goal kept only its
 * launch evidence and the supervisor ended blocked. Only the first terminal session was
 * ever read, too, so a wait on several workers credited one of them.
 */
function parseTerminalDelegationRecords(
  parsed: Record<string, unknown>,
): Array<Record<string, unknown>> {
  if (Array.isArray(parsed.sessions)) {
    return parsed.sessions.filter(
      (session): session is Record<string, unknown> =>
        isRecord(session) && hasTerminalStatus(session),
    );
  }
  return hasTerminalStatus(parsed) ? [parsed] : [];
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

export function buildDelegationToolTerminalGraphEvents(params: {
  toolName: string;
  resultContent: string;
  run: Pick<AgentRun, 'controlGraph'>;
  timestamp?: number;
}): AgentControlGraphEvent[] {
  const normalizedToolName = normalizeToolName(params.toolName);
  if (!DELEGATION_TERMINAL_TOOL_NAMES.has(normalizedToolName)) {
    return [];
  }

  if (!params.run.controlGraph) {
    return [];
  }

  let parsed: Record<string, unknown> | undefined;
  try {
    const raw = JSON.parse(params.resultContent) as unknown;
    parsed = isRecord(raw) ? raw : undefined;
  } catch {
    return [];
  }

  if (!parsed) {
    return [];
  }
  parsed = resolveDelegationPayloadFromSpill(parsed, normalizedToolName);

  const timestamp = params.timestamp ?? Date.now();
  // Each worker's events are built against the graph as the previous worker's left it, so
  // one worker's pending-operation removal does not overwrite another's.
  const events: AgentControlGraphEvent[] = [];
  let run = params.run;
  for (const terminalRecord of parseTerminalDelegationRecords(parsed)) {
    const worker = buildWorkerSnapshotFromTerminalRecord(terminalRecord);
    if (!worker) continue;

    const workerEvents = buildSubAgentTerminalControlGraphEvents({
      run,
      agent: worker,
      event: resolveWorkerLifecycleEvent(worker.status),
      timestamp,
    });
    if (workerEvents.length === 0) continue;

    events.push(...workerEvents);
    if (run.controlGraph) {
      run = { controlGraph: reduceAgentControlGraph(run.controlGraph, workerEvents) };
    }
  }

  return events;
}
