import { buildStreamingPreview } from '../../../utils/streamingPreview';

const DEFAULT_ACTIVITY_TEXT_CHARS = 220;
const TOOL_ACTIVITY_ARGUMENT_KEYS = [
  'path',
  'url',
  'query',
  'command',
  'name',
  'sessionId',
  'pattern',
  'slug',
  'title',
];

export function normalizePreviewText(
  value: string | undefined,
  maxLength = DEFAULT_ACTIVITY_TEXT_CHARS,
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

export function buildSubAgentResponsePreview(
  value: string | undefined,
  maxToolResultPreviewChars: number,
): string | undefined {
  if (!value) {
    return undefined;
  }

  const preview = buildStreamingPreview(value, {
    charWindow: 2400,
    maxLines: 6,
    maxChars: maxToolResultPreviewChars,
  });

  return normalizePreviewText(preview, maxToolResultPreviewChars);
}

function summarizeScalarValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return normalizePreviewText(value, 120);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return undefined;
}

export function summarizeToolArguments(argumentsText?: string): string | undefined {
  if (!argumentsText) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(argumentsText) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }

    for (const key of TOOL_ACTIVITY_ARGUMENT_KEYS) {
      const summary = summarizeScalarValue(parsed[key]);
      if (summary) {
        return summary;
      }
    }

    for (const value of Object.values(parsed)) {
      const summary = summarizeScalarValue(value);
      if (summary) {
        return summary;
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}
