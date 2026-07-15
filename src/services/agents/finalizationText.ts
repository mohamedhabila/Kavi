export const FINALIZATION_OUTPUT_TRUNCATION = 8_000;
export const FINALIZATION_RESULT_PREVIEW_CHARS = 320;
const FINALIZATION_STRUCTURED_SCALAR_CHARS = 96;
const FINALIZATION_STRUCTURED_LEAF_LIMIT = 12;
const FINALIZATION_STRUCTURED_QUEUE_LIMIT = 64;

export function normalizeFinalizationOutputText(
  value: string | undefined,
  maxLength?: number,
): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.replace(/\r\n?/g, '\n').trim();
  if (!normalized) {
    return undefined;
  }

  if (typeof maxLength === 'number' && normalized.length > maxLength) {
    return normalized.slice(0, maxLength).trimEnd();
  }

  return normalized;
}

export function truncateFinalizationText(
  value: string | undefined,
  maxLength: number,
): string | undefined {
  const normalized = normalizeFinalizationOutputText(value);
  if (!normalized) {
    return undefined;
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

export function normalizeFinalizationPreviewText(
  value: string | undefined,
  maxLength = FINALIZATION_RESULT_PREVIEW_CHARS,
): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return undefined;
  }

  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

type StructuredPreviewQueueEntry = Readonly<{
  path: string;
  value: unknown;
}>;

function appendStructuredPath(path: string, segment: string | number): string {
  return typeof segment === 'number'
    ? `${path}[${segment}]`
    : `${path}[${JSON.stringify(segment)}]`;
}

function summarizeStructuredScalar(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const normalized = normalizeFinalizationPreviewText(
      value,
      FINALIZATION_STRUCTURED_SCALAR_CHARS,
    );
    return normalized === undefined ? JSON.stringify('') : JSON.stringify(normalized);
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : JSON.stringify(String(value));
  }
  if (typeof value === 'boolean' || value === null) {
    return String(value);
  }
  return undefined;
}

/**
 * Preserve a bounded breadth-first view of arbitrary JSON. Field names are
 * evidence, not semantics: no natural language or tool-specific key receives
 * priority, so multilingual and third-party tool results remain visible.
 */
function summarizeStructuredFinalizationToolResult(value: unknown): string | undefined {
  const queue: StructuredPreviewQueueEntry[] = [{ path: '$', value }];
  const leaves: string[] = [];
  let omittedBranches = 0;
  const enqueue = (entry: StructuredPreviewQueueEntry): void => {
    if (queue.length >= FINALIZATION_STRUCTURED_QUEUE_LIMIT) {
      omittedBranches += 1;
      return;
    }
    queue.push(entry);
  };

  while (queue.length > 0 && leaves.length < FINALIZATION_STRUCTURED_LEAF_LIMIT) {
    const current = queue.shift()!;
    const scalar = summarizeStructuredScalar(current.value);
    if (scalar !== undefined) {
      leaves.push(`${current.path}=${scalar}`);
      continue;
    }

    if (Array.isArray(current.value)) {
      if (current.value.length === 0) {
        leaves.push(`${current.path}=[]`);
        continue;
      }
      current.value.forEach((entry, index) => {
        enqueue({ path: appendStructuredPath(current.path, index), value: entry });
      });
      continue;
    }

    if (current.value && typeof current.value === 'object') {
      const entries = Object.entries(current.value as Record<string, unknown>);
      if (entries.length === 0) {
        leaves.push(`${current.path}={}`);
        continue;
      }
      entries.forEach(([key, entry]) => {
        enqueue({ path: appendStructuredPath(current.path, key), value: entry });
      });
    }
  }

  if (leaves.length === 0) {
    return undefined;
  }
  if (leaves.length === 1 && queue.length === 0 && omittedBranches === 0) {
    const scalarSeparator = leaves[0].indexOf('=');
    if (scalarSeparator >= 0) {
      const encodedScalar = leaves[0].slice(scalarSeparator + 1);
      try {
        const scalar: unknown = JSON.parse(encodedScalar);
        return typeof scalar === 'string' ? scalar : encodedScalar;
      } catch {
        return encodedScalar;
      }
    }
  }
  if (queue.length > 0 || omittedBranches > 0) {
    leaves.push(`…+${queue.length + omittedBranches}`);
  }
  return leaves.join('; ');
}

export function summarizeFinalizationToolResultPreview(result?: string): string | undefined {
  if (!result) {
    return undefined;
  }

  const normalizedRaw = normalizeFinalizationPreviewText(result, FINALIZATION_RESULT_PREVIEW_CHARS);
  if (!normalizedRaw) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(result);
    if (!parsed || typeof parsed !== 'object') {
      return normalizedRaw;
    }
    return normalizeFinalizationPreviewText(
      summarizeStructuredFinalizationToolResult(parsed),
      FINALIZATION_RESULT_PREVIEW_CHARS,
    );
  } catch {
    return normalizedRaw;
  }

  return normalizedRaw;
}
