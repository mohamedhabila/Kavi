import { buildHeadTailExcerpt } from '../../../utils/headTailExcerpt';

export const MAX_BROWSER_SNAPSHOT_CHARS = 8_000;
export const MAX_FILE_CONTENT_CHARS = 12_000;
export const MAX_EXEC_OUTPUT_CHARS = 8_000;
export const MAX_LIST_ENTRIES = 40;
export const MAX_BROWSER_MESSAGES = 12;
export const MAX_SEARCH_MATCHES = 40;

export function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  const omittedChars = value.length - maxChars;
  const suffix = `... (${omittedChars} chars omitted)`;
  return `${value.slice(0, Math.max(0, maxChars - suffix.length)).trimEnd()}${suffix}`;
}

export function countLines(value: string): number {
  if (!value) {
    return 0;
  }
  return value.split(/\r?\n/).length;
}

function selectRelevantLines(value: string, maxLines: number): string[] {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length <= maxLines) {
    return lines.map((line) => truncateText(line, 240));
  }

  const headCount = Math.ceil(maxLines / 2);
  const tailCount = Math.max(0, maxLines - headCount);
  return [
    ...lines.slice(0, headCount),
    ...lines.slice(Math.max(headCount, lines.length - tailCount)),
  ].map((line) => truncateText(line, 240));
}

export function buildRelevantOutputExcerpt(value: string): string {
  const relevantLines = selectRelevantLines(value, 12);
  const candidate = relevantLines.join('\n');
  return candidate.length > 0
    ? truncateText(candidate, MAX_EXEC_OUTPUT_CHARS)
    : buildHeadTailExcerpt(value, MAX_EXEC_OUTPUT_CHARS);
}

export function approxBinaryBytes(base64: string): number {
  const normalized = base64.replace(/\s+/g, '');
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}
