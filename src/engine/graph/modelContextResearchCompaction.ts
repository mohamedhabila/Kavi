import type { Message } from '../../types/message';
import { buildHeadTailExcerpt } from '../../utils/headTailExcerpt';
import { normalizeToolName } from '../tools/toolNameNormalization';

const WEB_CONTEXT_COMPACT_TOOL_NAMES = new Set(['web_search', 'web_fetch']);
const MAX_WEB_RESULTS = 8;
const MAX_WEB_SEARCH_BATCHES = 4;
const MAX_WEB_FETCH_BATCHES = 6;
const MAX_WEB_FIELD_CHARS = 320;
const MAX_WEB_FETCH_EXCERPT_CHARS = 1600;

function truncateText(value: string, maxChars: number): string {
  return value.length <= maxChars
    ? value
    : `${value.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function normalizeText(value: unknown, maxChars = MAX_WEB_FIELD_CHARS): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized ? truncateText(normalized, maxChars) : undefined;
}

function normalizeStructuredExcerpt(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
  return normalized ? buildHeadTailExcerpt(normalized, maxChars) : undefined;
}

function extractCompactedArrayItems(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) {
    return value;
  }

  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Array.isArray((value as { items?: unknown[] }).items)
  ) {
    return (value as { items: unknown[] }).items;
  }

  return undefined;
}

function normalizeFetchLinkList(
  value: unknown,
  maxItems: number,
): Array<Record<string, unknown>> | undefined {
  const itemsSource = extractCompactedArrayItems(value);
  if (!itemsSource) {
    return undefined;
  }

  const items = itemsSource
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return undefined;
      }

      const record = entry as Record<string, unknown>;
      const compacted: Record<string, unknown> = Object.fromEntries(
        Object.entries({
          title: normalizeText(record.title),
          url: normalizeText(record.url),
        }).filter(([, fieldValue]) => fieldValue !== undefined),
      );

      return Object.keys(compacted).length > 0 ? compacted : undefined;
    })
    .filter((entry): entry is Record<string, unknown> => entry !== undefined)
    .slice(0, maxItems);

  return items.length > 0 ? items : undefined;
}

function normalizeResultList(value: unknown): Array<Record<string, unknown>> | undefined {
  const itemsSource = extractCompactedArrayItems(value);
  if (!itemsSource) {
    return undefined;
  }

  const items = itemsSource
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return undefined;
      }

      const record = entry as Record<string, unknown>;
      const compacted: Record<string, unknown> = {
        title: normalizeText(record.title),
        url: normalizeText(record.url),
      };
      const filteredEntries = Object.entries(compacted).filter(
        ([, fieldValue]) => fieldValue !== undefined,
      );
      return filteredEntries.length > 0 ? Object.fromEntries(filteredEntries) : undefined;
    })
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .slice(0, MAX_WEB_RESULTS);

  return items.length > 0 ? items : undefined;
}

function normalizeNestedSearchList(value: unknown): Array<Record<string, unknown>> | undefined {
  const itemsSource = extractCompactedArrayItems(value);
  if (!itemsSource) {
    return undefined;
  }

  const items = itemsSource
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return undefined;
      }

      const record = entry as Record<string, unknown>;
      const compacted: Record<string, unknown> = Object.fromEntries(
        Object.entries({
          query: normalizeText(record.query),
          results: normalizeResultList(record.results),
          error: normalizeText(record.error, 600),
        }).filter(([, fieldValue]) => fieldValue !== undefined),
      );

      return Object.keys(compacted).length > 0 ? compacted : undefined;
    })
    .filter((entry): entry is Record<string, unknown> => entry !== undefined)
    .slice(0, MAX_WEB_SEARCH_BATCHES);

  return items.length > 0 ? items : undefined;
}

function normalizeFetchList(value: unknown): Array<Record<string, unknown>> | undefined {
  const itemsSource = extractCompactedArrayItems(value);
  if (!itemsSource) {
    return undefined;
  }

  const items = itemsSource
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return undefined;
      }

      const record = entry as Record<string, unknown>;
      const content =
        typeof record.content === 'string'
          ? record.content
          : typeof record.contentExcerpt === 'string'
            ? record.contentExcerpt
            : undefined;
      const compacted: Record<string, unknown> = Object.fromEntries(
        Object.entries({
          requestedUrl: normalizeText(record.requestedUrl),
          resolvedUrl: normalizeText(record.resolvedUrl),
          url: normalizeText(record.url),
          title: normalizeText(record.title),
          links: normalizeFetchLinkList(record.links, 8),
          source: normalizeText(record.source, 80),
          contentExcerpt: normalizeStructuredExcerpt(content, MAX_WEB_FETCH_EXCERPT_CHARS),
          truncated: record.truncated === true ? true : undefined,
          charCount: typeof record.charCount === 'number' ? record.charCount : undefined,
          error: normalizeText(record.error, 600),
        }).filter(([, fieldValue]) => fieldValue !== undefined),
      );

      return Object.keys(compacted).length > 0 ? compacted : undefined;
    })
    .filter((entry): entry is Record<string, unknown> => entry !== undefined)
    .slice(0, MAX_WEB_FETCH_BATCHES);

  return items.length > 0 ? items : undefined;
}

function compactWebSearchResult(parsed: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries({
      provider: normalizeText(parsed.provider, 80),
      searches: normalizeNestedSearchList(parsed.searches),
      error: normalizeText(parsed.error, 600),
    }).filter(([, value]) => value !== undefined),
  );
}

function compactWebFetchResult(parsed: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries({
      fetches: normalizeFetchList(parsed.fetches),
      error: normalizeText(parsed.error, 600),
    }).filter(([, value]) => value !== undefined),
  );
}

export function compactResearchToolResultContent(toolName: string, content: string): string {
  const normalizedToolName = normalizeToolName(toolName);
  if (
    !WEB_CONTEXT_COMPACT_TOOL_NAMES.has(normalizedToolName) ||
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
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return content;
    }

    const compacted =
      normalizedToolName === 'web_search'
        ? compactWebSearchResult(parsed as Record<string, unknown>)
        : compactWebFetchResult(parsed as Record<string, unknown>);
    if (Object.keys(compacted).length === 0) {
      return content;
    }
    return JSON.stringify(compacted);
  } catch {
    return content;
  }
}

export function compactResearchToolMessage(message: Message): Message {
  if (message.role !== 'tool') {
    return message;
  }

  const toolName = normalizeToolName(message.toolCalls?.[0]?.name || message.toolCallId || '');
  const compactedContent = compactResearchToolResultContent(toolName, message.content);
  return compactedContent === message.content ? message : { ...message, content: compactedContent };
}
