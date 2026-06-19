// ---------------------------------------------------------------------------
// Kavi — Delegation tool terminal results → control graph events
// ---------------------------------------------------------------------------

import type { AgentRun } from '../../types/agentRun';
import type { SubAgentSnapshot } from '../../types/subAgent';
import { buildSubAgentTerminalControlGraphEvents } from '../../services/agents/subAgentGoalGraphEffects';
import type { AgentControlGraphEvent } from './agentControlGraphTypes';
import { normalizeToolName } from '../tools/toolNameNormalization';

const DELEGATION_TERMINAL_TOOL_NAMES = new Set([
  'sessions_spawn',
  'sessions_send',
  'sessions_wait',
]);
const SUCCESSFUL_TERMINAL_STATUSES = new Set(['completed', 'complete', 'success', 'succeeded']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSuccessfulTerminalStatus(value: unknown): boolean {
  return typeof value === 'string' && SUCCESSFUL_TERMINAL_STATUSES.has(value.trim().toLowerCase());
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

function parseTerminalDelegationRecord(
  parsed: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (isSuccessfulTerminalStatus(parsed.status)) {
    return parsed;
  }

  if (Array.isArray(parsed.sessions)) {
    for (const session of parsed.sessions) {
      if (isRecord(session) && isSuccessfulTerminalStatus(session.status)) {
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
  if (!sessionId) {
    return undefined;
  }

  const output = readString(record.output);
  const lastToolResultPreview = readString(record.lastToolResultPreview);
  if (!output && !lastToolResultPreview) {
    return undefined;
  }

  return {
    sessionId,
    parentConversationId: '',
    depth: readNumber(record.depth) ?? 1,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    status: 'completed',
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

  const terminalRecord = parseTerminalDelegationRecord(parsed);
  if (!terminalRecord) {
    return { events: [], applied: false };
  }

  const worker = buildWorkerSnapshotFromTerminalRecord(terminalRecord);
  if (!worker) {
    return { events: [], applied: false };
  }

  const events = buildSubAgentTerminalControlGraphEvents({
    run: params.run,
    agent: worker,
    event: 'completed',
    timestamp: params.timestamp,
  });

  const applied = events.some((event) => event.type === 'GOAL_EVIDENCE_ADDED');
  return { events, applied };
}
