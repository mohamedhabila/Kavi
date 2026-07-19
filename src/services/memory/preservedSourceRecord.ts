import { sha256HexUtf8 } from '../../utils/sha256';
import { tokenizeLexicalUnits } from './ranking/lexical';

export const PRESERVED_SOURCE_RECORD_VERSION = 1 as const;
export const PRESERVED_SOURCE_PROVIDER_EXCERPT_MAX_CHARS = 2_600;
const PRESERVED_SOURCE_QUERY_LINE_LIMIT = 8;

export interface PreservedSourceRecordV1 {
  version: typeof PRESERVED_SOURCE_RECORD_VERSION;
  title: string;
  content: string;
  contentSha256: string;
}

export interface PreservedSourceProviderProjection {
  version: typeof PRESERVED_SOURCE_RECORD_VERSION;
  title: string;
  excerpt: string;
  excerptComplete: boolean;
  contentSha256: string;
}

function fitText(value: string, maxChars: number): string {
  const codePoints = Array.from(value);
  if (codePoints.length <= maxChars) return value;
  return `${codePoints
    .slice(0, Math.max(0, maxChars - 1))
    .join('')
    .trimEnd()}\u2026`;
}

function parseRecord(objectText: string): PreservedSourceRecordV1 | null {
  try {
    const parsed = JSON.parse(objectText) as Record<string, unknown>;
    if (
      parsed.version !== PRESERVED_SOURCE_RECORD_VERSION ||
      typeof parsed.title !== 'string' ||
      parsed.title !== parsed.title.trim() ||
      parsed.title.length === 0 ||
      typeof parsed.content !== 'string' ||
      parsed.content.length === 0 ||
      typeof parsed.contentSha256 !== 'string' ||
      !/^[0-9a-f]{64}$/u.test(parsed.contentSha256) ||
      sha256HexUtf8(parsed.content) !== parsed.contentSha256
    ) {
      return null;
    }
    return parsed as unknown as PreservedSourceRecordV1;
  } catch {
    return null;
  }
}

function queryHitCount(value: string, queryUnits: ReadonlySet<string> | null): number {
  if (!queryUnits || queryUnits.size === 0) return 0;
  const valueUnits = tokenizeLexicalUnits(value);
  let hits = 0;
  for (const unit of queryUnits) {
    if (valueUnits.has(unit)) hits += 1;
  }
  return hits;
}

function focusedExcerpt(
  content: string,
  queryUnits: ReadonlySet<string> | null,
  maxChars: number,
): string {
  const lines = content
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trimEnd(), index }))
    .filter((entry) => entry.line.trim().length > 0);
  if (queryUnits && queryUnits.size > 0 && lines.length >= 4) {
    const matches = lines
      .map((entry) => ({ ...entry, score: queryHitCount(entry.line, queryUnits) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        return left.index - right.index;
      })
      .slice(0, PRESERVED_SOURCE_QUERY_LINE_LIMIT)
      .sort((left, right) => left.index - right.index);
    if (matches.length > 0) {
      return fitText(matches.map((entry) => entry.line).join('\n...\n'), maxChars);
    }
  }
  return fitText(content, maxChars);
}

export function projectPreservedSourceRecord(
  objectText: string,
  queryUnits: ReadonlySet<string> | null,
  maxChars = PRESERVED_SOURCE_PROVIDER_EXCERPT_MAX_CHARS,
): PreservedSourceProviderProjection | null {
  const record = parseRecord(objectText);
  if (!record || !Number.isSafeInteger(maxChars) || maxChars < 1) return null;
  const excerpt = focusedExcerpt(record.content, queryUnits, maxChars);
  return {
    version: PRESERVED_SOURCE_RECORD_VERSION,
    title: record.title,
    excerpt,
    excerptComplete: excerpt === record.content,
    contentSha256: record.contentSha256,
  };
}

export function preservedSourceProviderText(
  objectText: string,
  queryUnits: ReadonlySet<string> | null,
): string {
  const projection = projectPreservedSourceRecord(objectText, queryUnits);
  return JSON.stringify(projection ?? { sourceUnavailable: true });
}
