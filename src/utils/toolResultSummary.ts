import {
  parseReadFileContinuationResult,
  READ_FILE_CONTINUATION_TOOL,
} from './readFileContinuation';

const TOOL_RESULT_SUMMARY_MAX_CHARS = 180;
/** Values at or under this length are treated as pointers or labels, never as padding. */
const POINTER_VALUE_MAX_CHARS = 64;
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
 * Summary spending the budget on what the tool produced, not on how it is serialised.
 *
 * A tool result is a JSON object whose key order is written for machines, so serialising
 * and cutting at a character budget keeps whichever fields are declared first — which is
 * metadata.
 *
 * Traced live on an Android emulator. Compaction cleared 52 tool results across two
 * passes; the python result was 1652 chars with `"output"` starting at index 236, so a
 * 180-char summary retained only:
 *
 *   {"summary":"Python execution completed.","status":"completed",
 *    "workspaceMutationState":"none_observed","networkAccessState":"blocked",...
 *
 * Every Monte Carlo figure was dropped, and the model came out of compaction knowing a
 * computation had succeeded but not what it produced.
 *
 * Fields are ranked by value length rather than by name. Naming the substantive keys
 * would work only for the tools that have already been traced and would quietly degrade
 * for every tool and MCP server added later; length is a property of the payload, so it
 * needs no registry and cannot fall out of date. Metadata is short and enumerable by
 * nature, and what a tool actually produced — output, a message, an error, a written
 * summary — is the longest thing it returns.
 */
function summarizeToolResultRecord(parsed: unknown, maxChars: number): string | undefined {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }

  const record = parsed as Record<string, unknown>;
  const fields = Object.keys(record)
    .map((key) => ({ key, value: readSummaryFieldValue(record[key]) }))
    .filter((entry): entry is { key: string; value: string } => Boolean(entry.value));

  if (fields.length === 0) {
    return undefined;
  }

  /**
   * Short values are pointers, not padding, so they are kept whole and cheaply: a spilled
   * result carries `.kavi/spill/read_file-42.txt` beside a 1,200-character preview, and
   * losing the path costs the model the only way back to the content. Length ranking alone
   * dropped it, because the preview is longer.
   */
  const byLengthDescending = (left: { value: string }, right: { value: string }) =>
    right.value.length - left.value.length;

  const pointers = fields
    .filter((entry) => entry.value.length <= POINTER_VALUE_MAX_CHARS)
    .sort(byLengthDescending);
  const longest = fields
    .filter((entry) => entry.value.length > POINTER_VALUE_MAX_CHARS)
    .sort(byLengthDescending)[0];

  // The reserve exists only to leave room for a long content field. With nothing long to
  // protect — a failed call is often just {status, error} — the pointers are the whole
  // result and get the whole budget, most informative first.
  const pointerBudget = longest ? Math.floor(maxChars / 3) : maxChars;

  // Pointers are emitted first so the final trim can never cut one in half — a spill path
  // truncated to `.kavi/spill/read_file-4...` is no longer a path the model can read.
  const segments: string[] = [];
  let used = 0;

  for (const { key, value } of pointers) {
    const segment = `${key}: ${value}`;
    if (used + segment.length + 2 > pointerBudget) {
      break;
    }
    segments.push(segment);
    used += segment.length + 2;
  }

  if (longest) {
    const room = Math.max(24, maxChars - used);
    segments.push(`${longest.key}: ${truncateText(longest.value, room)}`);
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
