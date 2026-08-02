export const READ_FILE_CONTINUATION_VERSION = 1 as const;
export const READ_FILE_CONTINUATION_TOOL = 'read_file' as const;
export const READ_FILE_CONTINUATION_HEADING = '## Tool Continuation State (code-owned)';

export interface ReadFileContinuationState {
  version: typeof READ_FILE_CONTINUATION_VERSION;
  tool: typeof READ_FILE_CONTINUATION_TOOL;
  path: string;
  sha256?: string;
  offset: number;
  nextOffset: number | null;
  totalChars: number;
  complete: boolean;
  /** A durable checkpoint omitted this chunk body and must reread it before advancing. */
  rereadOffset?: number;
}

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/u;

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function parseReadFileContinuationRecord(value: unknown): ReadFileContinuationState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  const path = typeof record.path === 'string' ? record.path.trim() : '';
  const complete = record.complete;
  const nextOffset = record.nextOffset;
  const sha256 = record.sha256;
  const durableCheckpoint =
    record.durableCheckpoint &&
    typeof record.durableCheckpoint === 'object' &&
    !Array.isArray(record.durableCheckpoint)
      ? (record.durableCheckpoint as Record<string, unknown>)
      : undefined;
  const rereadOffset =
    durableCheckpoint?.version === 1 && durableCheckpoint.contentRetained === false
      ? durableCheckpoint.rereadOffset
      : record.rereadOffset;
  if (
    !path ||
    !isNonNegativeSafeInteger(record.offset) ||
    !isNonNegativeSafeInteger(record.totalChars) ||
    typeof complete !== 'boolean' ||
    (sha256 !== undefined && (typeof sha256 !== 'string' || !SHA256_HEX_PATTERN.test(sha256))) ||
    (nextOffset !== null && !isNonNegativeSafeInteger(nextOffset))
  ) {
    return null;
  }

  if (record.offset > record.totalChars) return null;
  if (complete && nextOffset !== null) return null;
  if (!complete && (nextOffset === null || nextOffset <= record.offset)) return null;
  if (nextOffset !== null && nextOffset > record.totalChars) return null;
  if (rereadOffset !== undefined && !isNonNegativeSafeInteger(rereadOffset)) return null;
  if (rereadOffset !== undefined && rereadOffset !== record.offset) return null;

  return {
    version: READ_FILE_CONTINUATION_VERSION,
    tool: READ_FILE_CONTINUATION_TOOL,
    path,
    ...(typeof sha256 === 'string' ? { sha256 } : {}),
    offset: record.offset,
    nextOffset,
    totalChars: record.totalChars,
    complete,
    ...(rereadOffset !== undefined ? { rereadOffset } : {}),
  };
}

/** Parse only the exact, code-owned `read_file` chunk envelope. */
export function parseReadFileContinuationResult(content: string): ReadFileContinuationState | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith('{')) return null;

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (parsed.status !== 'read_chunk') return null;
    return parseReadFileContinuationRecord(parsed);
  } catch {
    return null;
  }
}

/** Parse one record emitted under `READ_FILE_CONTINUATION_HEADING`. */
export function parseReadFileContinuationSummaryLine(
  line: string,
): ReadFileContinuationState | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('- {')) return null;

  try {
    const parsed = JSON.parse(trimmed.slice(2)) as Record<string, unknown>;
    if (
      parsed.version !== READ_FILE_CONTINUATION_VERSION ||
      parsed.tool !== READ_FILE_CONTINUATION_TOOL
    ) {
      return null;
    }
    return parseReadFileContinuationRecord(parsed);
  } catch {
    return null;
  }
}

export function serializeReadFileContinuationSummaryLine(state: ReadFileContinuationState): string {
  return `- ${JSON.stringify(state)}`;
}

export function resolveReadFileContinuationProgress(state: ReadFileContinuationState): number {
  if (state.rereadOffset !== undefined) return state.rereadOffset;
  return state.complete ? state.totalChars : (state.nextOffset ?? state.offset);
}

/**
 * Merge chronologically newer continuation evidence without letting an older
 * chunk that is compacted later move a file backwards. A changed content hash
 * or length starts a new file revision, so its continuation may legitimately
 * restart at a lower offset.
 */
export function mergeReadFileContinuationState(
  existing: ReadFileContinuationState | undefined,
  incoming: ReadFileContinuationState,
): ReadFileContinuationState {
  if (!existing || existing.path !== incoming.path) return incoming;

  const revisionChanged =
    existing.totalChars !== incoming.totalChars ||
    (existing.sha256 !== undefined &&
      incoming.sha256 !== undefined &&
      existing.sha256 !== incoming.sha256) ||
    (existing.sha256 === undefined && incoming.sha256 !== undefined);
  if (revisionChanged) return incoming;

  const existingProgress = resolveReadFileContinuationProgress(existing);
  const incomingProgress = resolveReadFileContinuationProgress(incoming);
  if (incomingProgress > existingProgress) return incoming;
  if (incomingProgress < existingProgress) return existing;

  if (existing.rereadOffset !== undefined && incoming.rereadOffset === undefined) {
    return incoming;
  }
  if (existing.rereadOffset === undefined && incoming.rereadOffset !== undefined) {
    return existing;
  }
  if (!existing.complete && incoming.complete) return incoming;
  return existing;
}
