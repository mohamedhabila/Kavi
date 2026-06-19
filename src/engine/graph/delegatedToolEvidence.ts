import { normalizeToolName } from '../tools/toolNameNormalization';

const DELEGATION_RESULT_TOOL_NAMES = new Set(['sessions_spawn', 'sessions_send', 'sessions_wait']);
const SUCCESSFUL_TERMINAL_STATUSES = new Set([
  'completed',
  'complete',
  'success',
  'succeeded',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonRecord(value: string | undefined): Record<string, unknown> | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isSuccessfulTerminalStatus(value: unknown): boolean {
  return typeof value === 'string' && SUCCESSFUL_TERMINAL_STATUSES.has(value.trim().toLowerCase());
}

function readToolNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === 'string' ? normalizeToolName(entry) : ''))
    .filter(Boolean);
}

function addToolNames(target: Set<string>, toolNames: unknown): void {
  for (const toolName of readToolNames(toolNames)) {
    target.add(toolName);
  }
}

export function collectAgentControlGraphDelegatedCompletedToolNames(params: {
  hostToolName: string | undefined;
  result: string | undefined;
  isError?: boolean;
}): string[] {
  if (params.isError) {
    return [];
  }

  const hostToolName = normalizeToolName(params.hostToolName || '');
  if (!DELEGATION_RESULT_TOOL_NAMES.has(hostToolName)) {
    return [];
  }

  const parsed = parseJsonRecord(params.result);
  if (!parsed) {
    return [];
  }

  const completedToolNames = new Set<string>();
  if (isSuccessfulTerminalStatus(parsed.status)) {
    addToolNames(completedToolNames, parsed.toolsUsed);
  }

  if (Array.isArray(parsed.sessions)) {
    for (const session of parsed.sessions) {
      if (isRecord(session) && isSuccessfulTerminalStatus(session.status)) {
        addToolNames(completedToolNames, session.toolsUsed);
      }
    }
  }

  return [...completedToolNames];
}
