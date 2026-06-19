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

function summarizeFailureLogs(value: unknown, maxChars: number): string | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }

  const first = value.find(
    (entry) => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry),
  ) as Record<string, unknown> | undefined;
  if (!first) {
    return undefined;
  }

  const source = typeof first.source === 'string' ? collapseWhitespace(first.source) : '';
  const excerpt = typeof first.excerpt === 'string' ? collapseWhitespace(first.excerpt) : '';
  if (!excerpt) {
    return undefined;
  }

  return truncateText(source ? `${source}: ${excerpt}` : excerpt, maxChars);
}

function summarizeStructuredField(
  parsed: Record<string, unknown>,
  keys: string[],
  maxChars: number,
): string | undefined {
  for (const key of keys) {
    const value = parsed[key];
    if (typeof value !== 'string') {
      continue;
    }

    const normalized = collapseWhitespace(value);
    if (normalized) {
      return truncateText(normalized, maxChars);
    }
  }

  return undefined;
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
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return truncateText(collapseWhitespace(trimmed), maxChars);
    }

    const record = parsed as Record<string, unknown>;
    const structuredSummary = summarizeStructuredField(
      record,
      [
        'summary',
        'outputExcerpt',
        'resultPreview',
        'message',
        'note',
        'failureSummary',
        'error',
        'path',
        'preview',
      ],
      maxChars,
    );
    if (structuredSummary) {
      return structuredSummary;
    }

    const failureSummary = summarizeFailureLogs(record.failureLogs, maxChars);
    if (failureSummary) {
      return failureSummary;
    }
  } catch {
    return truncateText(collapseWhitespace(trimmed), maxChars);
  }

  return truncateText(collapseWhitespace(trimmed), maxChars);
}

export function buildToolResultPlaceholder(
  kind: ToolResultPlaceholderKind,
  toolName: string,
  content: string,
): string {
  const normalizedToolName = collapseWhitespace(toolName) || 'tool';
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
    return content.startsWith(TOOL_RESULT_PLACEHOLDER_PREFIXES[kind]);
  }

  return Object.values(TOOL_RESULT_PLACEHOLDER_PREFIXES).some((prefix) =>
    content.startsWith(prefix),
  );
}

export const TOOL_RESULT_PLACEHOLDER_PREFIX = TOOL_RESULT_PLACEHOLDER_PREFIXES;
