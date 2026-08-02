import { normalizeToolName } from './toolNameNormalization';

const DELEGATION_SESSION_TOOL_NAMES = new Set(['sessions_spawn', 'sessions_send', 'sessions_wait']);
const MAX_STRUCTURAL_SESSION_RECORDS = 8;
const MAX_OUTPUT_PREVIEW_CHARS = 600;
const MAX_ERROR_PREVIEW_CHARS = 400;
const MAX_TOOL_RESULT_PREVIEW_CHARS = 480;
const MAX_TOOLS_USED = 32;

export interface DelegationSessionStructuralMetadata {
  version: 1;
  kind: 'delegation_sessions';
  sessions: Record<string, unknown>[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function truncate(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  return normalized.length <= maxChars
    ? normalized
    : `${normalized.slice(0, maxChars - 1).trimEnd()}…`;
}

function copyString(record: Record<string, unknown>, key: string): string | undefined {
  return truncate(record[key], 240);
}

function compactSessionRecord(
  record: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const sessionId = copyString(record, 'sessionId');
  const status = copyString(record, 'status');
  if (!sessionId || !status) return undefined;

  const toolsUsed = Array.isArray(record.toolsUsed)
    ? Array.from(
        new Set(
          record.toolsUsed
            .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
            .filter(Boolean),
        ),
      ).slice(0, MAX_TOOLS_USED)
    : undefined;
  const output =
    truncate(record.outputPreview, MAX_OUTPUT_PREVIEW_CHARS) ??
    truncate(record.output, MAX_OUTPUT_PREVIEW_CHARS);

  return {
    sessionId,
    status,
    ...(copyString(record, 'completionState')
      ? { completionState: copyString(record, 'completionState') }
      : {}),
    ...(copyString(record, 'terminationCause')
      ? { terminationCause: copyString(record, 'terminationCause') }
      : {}),
    ...(copyString(record, 'workstreamId')
      ? { workstreamId: copyString(record, 'workstreamId') }
      : {}),
    ...(copyString(record, 'name') ? { name: copyString(record, 'name') } : {}),
    ...(output ? { outputPreview: output } : {}),
    ...(truncate(record.error, MAX_ERROR_PREVIEW_CHARS)
      ? { error: truncate(record.error, MAX_ERROR_PREVIEW_CHARS) }
      : {}),
    ...(truncate(record.lastToolResultPreview, MAX_TOOL_RESULT_PREVIEW_CHARS)
      ? {
          lastToolResultPreview: truncate(
            record.lastToolResultPreview,
            MAX_TOOL_RESULT_PREVIEW_CHARS,
          ),
        }
      : {}),
    ...(toolsUsed?.length ? { toolsUsed } : {}),
    ...(typeof record.iterations === 'number' && Number.isFinite(record.iterations)
      ? { iterations: record.iterations }
      : {}),
    ...(typeof record.depth === 'number' && Number.isFinite(record.depth)
      ? { depth: record.depth }
      : {}),
  };
}

export function extractToolOutputStructuralMetadata(params: {
  toolName: string;
  result: string;
}): DelegationSessionStructuralMetadata | undefined {
  if (!DELEGATION_SESSION_TOOL_NAMES.has(normalizeToolName(params.toolName))) return undefined;

  let parsed: Record<string, unknown>;
  try {
    const value = JSON.parse(params.result) as unknown;
    if (!isRecord(value)) return undefined;
    parsed = value;
  } catch {
    return undefined;
  }

  const rawSessions = Array.isArray(parsed.sessions) ? parsed.sessions : [parsed];
  const sessions = rawSessions
    .filter(isRecord)
    .map(compactSessionRecord)
    .filter((record): record is Record<string, unknown> => Boolean(record))
    .slice(0, MAX_STRUCTURAL_SESSION_RECORDS);
  return sessions.length > 0 ? { version: 1, kind: 'delegation_sessions', sessions } : undefined;
}
