import type { Message } from '../../types/message';
import { normalizeToolName } from '../tools/toolNameNormalization';

const SESSION_CONTEXT_COMPACT_TOOL_NAMES = new Set([
  'sessions_list',
  'sessions_output',
  'sessions_send',
  'sessions_spawn',
  'sessions_status',
  'sessions_surface_output',
  'sessions_wait',
]);

const SESSION_CONTEXT_OMIT_KEYS = new Set(['guidance', 'recentActivity', 'artifacts']);
const SESSION_CONTEXT_TERMINAL_OMIT_KEYS = new Set([
  'sessionId',
  'workstreamId',
  'depth',
  'iterations',
  'lastToolResultPreview',
  'outputPreview',
  'launchState',
  'idleMs',
  'lastProgressAt',
  'awaitingModelResponse',
  'modelResponsePendingSince',
  'modelResponseWaitMs',
  'liveness',
  'currentActivity',
  'activeToolName',
]);

function isTerminalSessionStatus(status: unknown): boolean {
  if (typeof status !== 'string') {
    return false;
  }

  switch (status.trim().toLowerCase()) {
    case 'completed':
    case 'failed':
    case 'error':
    case 'cancelled':
    case 'timeout':
      return true;
    default:
      return false;
  }
}

function compactSessionEnvelopeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => compactSessionEnvelopeValue(entry));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const record = value as Record<string, unknown>;
  const terminal = isTerminalSessionStatus(record.status);
  const compacted: Record<string, unknown> = {};
  for (const [key, entryValue] of Object.entries(record)) {
    if (SESSION_CONTEXT_OMIT_KEYS.has(key)) {
      continue;
    }
    if (terminal && SESSION_CONTEXT_TERMINAL_OMIT_KEYS.has(key)) {
      continue;
    }
    compacted[key] = compactSessionEnvelopeValue(entryValue);
  }

  return compacted;
}

export function compactSessionToolResultContent(toolName: string, content: string): string {
  const normalizedToolName = normalizeToolName(toolName);
  if (
    !SESSION_CONTEXT_COMPACT_TOOL_NAMES.has(normalizedToolName) ||
    typeof content !== 'string' ||
    content.trim().length === 0
  ) {
    return content;
  }

  const trimmed = content.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return content;
  }

  try {
    return JSON.stringify(compactSessionEnvelopeValue(JSON.parse(trimmed)));
  } catch {
    return content;
  }
}

export function compactSessionToolMessage(message: Message): Message {
  if (message.role !== 'tool') {
    return message;
  }

  const toolName = normalizeToolName(message.toolCalls?.[0]?.name || message.toolCallId || '');
  const compactedContent = compactSessionToolResultContent(toolName, message.content);
  return compactedContent === message.content ? message : { ...message, content: compactedContent };
}
