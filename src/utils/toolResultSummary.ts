import {
  parseReadFileContinuationResult,
  READ_FILE_CONTINUATION_TOOL,
} from './readFileContinuation';

const TOOL_RESULT_SUMMARY_MAX_CHARS = 180;
const TOOL_RESULT_PLACEHOLDER_MAX_CHARS = 320;

export type ToolResultPlaceholderKind = 'cleared' | 'compacted';

const TOOL_RESULT_PLACEHOLDER_PREFIXES: Record<ToolResultPlaceholderKind, string> = {
  cleared: '[cleared:',
  compacted: '[compacted:',
};

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

/**
 * Result fields that carry what the run actually produced, most substantive first.
 *
 * A tool result is a JSON object whose key order is written for machines, not for
 * truncation. Summarising it by serialising and cutting at a character budget therefore
 * keeps whichever fields happen to be declared first — which is metadata.
 *
 * Traced live on an Android emulator. Compaction cleared 52 tool results across two
 * passes; the python result was 1652 chars with `"output"` starting at index 236, so a
 * 180-char summary retained only:
 *
 *   {"summary":"Python execution completed.","status":"completed",
 *    "workspaceMutationState":"none_observed","networkAccessState":"blocked",...
 *
 * Every Monte Carlo figure was dropped. The model came out of compaction knowing a
 * computation had succeeded but not what it produced, re-planned from scratch with fresh
 * goal ids, and the run ended in critical_loop_detected and then a 900s provider timeout.
 *
 * Ordering by substance keeps the same budget spent on the part worth keeping.
 */
const SUBSTANTIVE_TOOL_RESULT_KEYS = [
  'output',
  'stdout',
  'content',
  'text',
  'error',
  'message',
  'path',
  'summary',
  'status',
] as const;

function readSummaryFieldValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value.trim() ? collapseWhitespace(value) : undefined;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
}

/**
 * Summary built from the substantive fields, or undefined when none are present so the
 * caller falls back to plain truncation.
 */
function summarizeToolResultRecord(parsed: unknown, maxChars: number): string | undefined {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }

  const record = parsed as Record<string, unknown>;
  const segments: string[] = [];
  let used = 0;

  for (const key of SUBSTANTIVE_TOOL_RESULT_KEYS) {
    if (used >= maxChars) {
      break;
    }
    const value = readSummaryFieldValue(record[key]);
    if (!value) {
      continue;
    }
    const segment = `${key}: ${truncateText(value, Math.max(24, maxChars - used))}`;
    segments.push(segment);
    used += segment.length + 2;
  }

  return segments.length > 0 ? truncateText(segments.join('; '), maxChars) : undefined;
}

export function extractToolResultSummary(
  content: string,
  maxChars = TOOL_RESULT_SUMMARY_MAX_CHARS,
): string {
  const trimmed = content.trim();
  if (!trimmed) {
    return '';
  }

  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return truncateText(collapseWhitespace(trimmed), maxChars);
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const substantive = summarizeToolResultRecord(parsed, maxChars);
    if (substantive) {
      return substantive;
    }
    const serialized = JSON.stringify(parsed);
    return truncateText(collapseWhitespace(serialized ?? trimmed), maxChars);
  } catch {
    return truncateText(collapseWhitespace(trimmed), maxChars);
  }
}

export function buildToolResultPlaceholder(
  kind: ToolResultPlaceholderKind,
  toolName: string,
  content: string,
): string {
  const normalizedToolName = collapseWhitespace(toolName) || 'tool';
  const readFileContinuation =
    normalizedToolName === READ_FILE_CONTINUATION_TOOL
      ? parseReadFileContinuationResult(content)
      : null;
  if (readFileContinuation) {
    return JSON.stringify({
      status: 'read_chunk',
      path: readFileContinuation.path,
      ...(readFileContinuation.sha256 ? { sha256: readFileContinuation.sha256 } : {}),
      offset: readFileContinuation.offset,
      nextOffset: readFileContinuation.nextOffset,
      totalChars: readFileContinuation.totalChars,
      complete: readFileContinuation.complete,
      ...(readFileContinuation.rereadOffset !== undefined
        ? { rereadOffset: readFileContinuation.rereadOffset }
        : {}),
      compactionPlaceholder: { version: 1, kind },
      guidance:
        readFileContinuation.rereadOffset !== undefined
          ? `Reread this path at offset ${readFileContinuation.rereadOffset}; the durable checkpoint omitted the chunk body.`
          : readFileContinuation.complete
            ? 'End of file was reached before this result was compacted.'
            : `Resume read_file with the same path and offset ${readFileContinuation.nextOffset}.`,
    });
  }

  const summary = extractToolResultSummary(content);
  const base = [
    `${TOOL_RESULT_PLACEHOLDER_PREFIXES[kind]} historical ${normalizedToolName}`,
    kind === 'cleared' ? 'result removed to free context.' : 'output removed to free context.',
    `Do not retry only because it was ${kind}.`,
    summary ? `Summary: ${summary}.` : undefined,
  ]
    .filter((segment): segment is string => Boolean(segment))
    .join(' ');

  const normalized = base.endsWith(']') ? base : `${base}]`;
  return truncateText(normalized, TOOL_RESULT_PLACEHOLDER_MAX_CHARS);
}

export function isToolResultPlaceholder(
  content: string,
  kind?: ToolResultPlaceholderKind,
): boolean {
  if (!content) {
    return false;
  }

  if (kind) {
    if (content.startsWith(TOOL_RESULT_PLACEHOLDER_PREFIXES[kind])) return true;
  } else if (
    Object.values(TOOL_RESULT_PLACEHOLDER_PREFIXES).some((prefix) => content.startsWith(prefix))
  ) {
    return true;
  }

  const trimmed = content.trim();
  if (!trimmed.startsWith('{')) return false;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const placeholder = parsed.compactionPlaceholder;
    if (!placeholder || typeof placeholder !== 'object' || Array.isArray(placeholder)) return false;
    const record = placeholder as Record<string, unknown>;
    return (
      record.version === 1 &&
      (record.kind === 'cleared' || record.kind === 'compacted') &&
      (kind === undefined || record.kind === kind)
    );
  } catch {
    return false;
  }
}

export const TOOL_RESULT_PLACEHOLDER_PREFIX = TOOL_RESULT_PLACEHOLDER_PREFIXES;
