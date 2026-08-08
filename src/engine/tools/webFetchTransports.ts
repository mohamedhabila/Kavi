import { fetch as expoFetch } from 'expo/fetch';

import {
  extractFetchedLinksFromHtml,
  extractFetchedLinksFromMarkdown,
  type WebFetchLink,
} from '../../services/browser/core/linkExtractor';
import {
  htmlToMarkdown,
  selectMatchingRegions,
  sliceTextWindow,
  stripNonRenderedHtml,
} from './web-fetch-utils';
import {
  DEFAULT_CACHE_TTL_MINUTES,
  readCache,
  readResponseText,
  resolveCacheTtlMs,
  writeCache,
  type CacheEntry,
} from './web-shared';

/**
 * The extracted document, cached apart from the window projected out of it.
 *
 * Downloading and extracting a page depends only on its URL and the extraction mode.
 * `maxChars`, `offset` and `find` merely select a window of the text that extraction
 * already produced. The response cache keyed on all five therefore missed whenever any
 * of them changed, and a miss repeated the whole expensive half: measured on-device
 * against en.wikipedia.org/wiki/Jupiter, 1,415,879 chars costing ~9.8s to convert and
 * ~10.8s to scan for links, against ~0.2s of network. A single traced run fetched and
 * re-parsed the same URL twice.
 *
 * That hit the documented paging flow hardest — `web_fetch` tells callers to "pass the
 * nextOffset from a truncated response to continue reading the same page", and every
 * such continuation paid for a fresh download and a fresh parse of a document the run
 * already held.
 *
 * Caching the extracted text keyed on url and mode makes a second window over the same
 * page a string slice.
 */
type ExtractedDocument = {
  text: string;
  title?: string;
  links?: WebFetchLink[];
  resolvedUrl?: string;
};

const DOCUMENT_CACHE = new Map<string, CacheEntry<ExtractedDocument>>();

export function clearWebFetchDocumentCache(): void {
  DOCUMENT_CACHE.clear();
}

/** 4xx statuses where a different client identity can plausibly change the answer. */
const USER_AGENT_SENSITIVE_STATUSES = new Set([401, 403, 405, 406, 429]);

/**
 * Whether re-asking with the other User-Agent could change this answer.
 *
 * A 5xx is the server failing rather than refusing, so a second attempt is worth making,
 * as is a bot wall or a rate limit. A 404 or 410 is a definitive answer about the
 * resource and no client identity changes it.
 *
 * Traced on-device across a twelve-source research run: 19 primary attempts drew 18
 * fallback retries, nearly all of them a second request for a 404 the site had already
 * answered — doubling the cost of every dead URL, and dead URLs are common because with
 * no search provider configured the model reaches pages by guessing plausible addresses.
 */
function statusCouldChangeWithAnotherUserAgent(status: number): boolean {
  return status >= 500 || USER_AGENT_SENSITIVE_STATUSES.has(status);
}

const DEFAULT_FETCH_MAX_RESPONSE_BYTES = 2_000_000;
const DEFAULT_FIRECRAWL_BASE_URL = 'https://api.firecrawl.dev';
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const FALLBACK_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

export type WebFetchEntry = {
  requestedUrl?: string;
  resolvedUrl?: string;
  url?: string;
  title?: string;
  content?: string;
  links?: WebFetchLink[];
  truncated?: boolean;
  charCount?: number;
  source?: string;
  error?: string;
  directError?: string;
  fallbackError?: string;
};

export function describeFetchError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    if (typeof record.message === 'string' && record.message.trim()) {
      return record.message;
    }
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== '{}') {
        return serialized;
      }
    } catch {}
  }

  return String(error);
}

function truncateDetail(value: string, maxChars = 160): string {
  return value.length <= maxChars
    ? value
    : `${value.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function summarizeFetchErrorBody(bodyText: string, contentType: string | null): string {
  const normalizedBody = bodyText.trim();
  if (!normalizedBody) {
    return '';
  }

  const normalizedType = (contentType || '').toLowerCase();

  if (normalizedType.includes('application/json')) {
    try {
      const parsed = JSON.parse(normalizedBody) as
        | { error?: unknown; message?: unknown }
        | undefined;
      if (typeof parsed?.message === 'string' && parsed.message.trim()) {
        return truncateDetail(parsed.message.trim());
      }
      if (typeof parsed?.error === 'string' && parsed.error.trim()) {
        return truncateDetail(parsed.error.trim());
      }
    } catch {}
  }

  if (normalizedType.includes('text/html') || normalizedBody.startsWith('<')) {
    const { text, title } = htmlToMarkdown(normalizedBody, 'text');
    const summary = truncateDetail((title || text || '').trim());
    return summary;
  }

  return truncateDetail(normalizedBody.replace(/\s+/g, ' ').trim());
}

export async function directFetch(params: {
  url: string;
  extractMode: 'markdown' | 'text';
  maxChars: number;
  offset?: number;
  find?: string;
  signal?: AbortSignal;
}): Promise<{
  content: string;
  title?: string;
  links?: WebFetchLink[];
  truncated: boolean;
  charCount: number;
  offset: number;
  nextOffset?: number;
  matchCount?: number;
  resolvedUrl?: string;
}> {
  const requestedOffset = params.offset ?? 0;
  const findTerm = params.find?.trim() ?? '';
  const project = (text: string) => {
    if (!findTerm) {
      return { ...sliceTextWindow(text, requestedOffset, params.maxChars), matchCount: undefined };
    }
    const matched = selectMatchingRegions(text, findTerm, params.maxChars);
    return {
      text: matched.text,
      truncated: false,
      totalChars: matched.totalChars,
      offset: 0,
      nextOffset: undefined,
      matchCount: matched.matchCount,
    };
  };
  const documentCacheKey = `${params.url}\u0000${params.extractMode}`;
  const cachedDocument = readCache(DOCUMENT_CACHE, documentCacheKey);
  if (cachedDocument) {
    const window = project(cachedDocument.value.text);
    return {
      content: window.text,
      ...(cachedDocument.value.title ? { title: cachedDocument.value.title } : {}),
      ...(cachedDocument.value.links ? { links: cachedDocument.value.links } : {}),
      truncated: window.truncated,
      charCount: window.totalChars,
      offset: window.offset,
      ...(window.nextOffset !== undefined ? { nextOffset: window.nextOffset } : {}),
      ...(window.matchCount !== undefined ? { matchCount: window.matchCount } : {}),
      ...(cachedDocument.value.resolvedUrl
        ? { resolvedUrl: cachedDocument.value.resolvedUrl }
        : {}),
    };
  }

  const headerProfiles = [
    {
      'User-Agent': DEFAULT_USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    {
      'User-Agent': FALLBACK_USER_AGENT,
      Accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.8',
    },
  ];

  let lastError: Error | null = null;
  let definitiveStatusFailure = false;

  for (const headers of headerProfiles) {
    try {
      const res = await expoFetch(params.url, {
        credentials: 'omit',
        headers,
        redirect: 'follow',
        signal: params.signal,
      });

      if (!res.ok) {
        if (!statusCouldChangeWithAnotherUserAgent(res.status)) {
          definitiveStatusFailure = true;
        }
        const detail = typeof res.text === 'function' ? await res.text().catch(() => '') : '';
        const summarizedDetail = summarizeFetchErrorBody(
          detail,
          typeof res.headers?.get === 'function' ? res.headers.get('content-type') : null,
        );
        throw new Error(
          `HTTP ${res.status} ${res.statusText}${summarizedDetail ? `: ${summarizedDetail}` : ''}`,
        );
      }

      const contentType = res.headers.get('content-type') || '';
      const { text: rawText } = await readResponseText(res, {
        maxBytes: DEFAULT_FETCH_MAX_RESPONSE_BYTES,
      });

      // Structured and plain payloads are returned as a contiguous window. A
      // head-and-tail excerpt would corrupt JSON and hide the middle of a document,
      // which is exactly where a requested field tends to sit.
      if (
        contentType.includes('application/json') ||
        contentType.includes('text/plain') ||
        contentType.includes('text/csv')
      ) {
        const window = project(rawText);
        return {
          content: window.text,
          truncated: window.truncated,
          charCount: window.totalChars,
          offset: window.offset,
          ...(window.nextOffset !== undefined ? { nextOffset: window.nextOffset } : {}),
          ...(window.matchCount !== undefined ? { matchCount: window.matchCount } : {}),
          resolvedUrl: typeof res.url === 'string' && res.url.trim() ? res.url : undefined,
        };
      }

      // Both passes below walk the whole document, so the markup that renders no text
      // and holds no navigable link is removed once rather than scanned twice.
      const renderableHtml = stripNonRenderedHtml(rawText);
      const { text: extractedText, title } = htmlToMarkdown(
        renderableHtml,
        params.extractMode,
        typeof res.url === 'string' && res.url.trim() ? res.url : params.url,
      );
      const links = extractFetchedLinksFromHtml(
        renderableHtml,
        typeof res.url === 'string' && res.url.trim() ? res.url : params.url,
      );
      const resolvedUrl =
        typeof res.url === 'string' && res.url.trim() ? res.url : undefined;
      writeCache(
        DOCUMENT_CACHE,
        documentCacheKey,
        {
          text: extractedText,
          ...(title ? { title } : {}),
          ...(links ? { links } : {}),
          ...(resolvedUrl ? { resolvedUrl } : {}),
        },
        resolveCacheTtlMs(DEFAULT_CACHE_TTL_MINUTES, DEFAULT_CACHE_TTL_MINUTES),
      );
      const window = project(extractedText);
      return {
        content: window.text,
        title,
        ...(links ? { links } : {}),
        truncated: window.truncated,
        charCount: window.totalChars,
        offset: window.offset,
        ...(window.nextOffset !== undefined ? { nextOffset: window.nextOffset } : {}),
        ...(window.matchCount !== undefined ? { matchCount: window.matchCount } : {}),
        resolvedUrl: typeof res.url === 'string' && res.url.trim() ? res.url : undefined,
      };
    } catch (error: unknown) {
      if (params.signal?.aborted) throw error;
      lastError = error instanceof Error ? error : new Error(describeFetchError(error));
      if (definitiveStatusFailure) {
        break;
      }
    }
  }

  throw lastError || new Error('Fetch failed');
}

export async function firecrawlFetch(params: {
  url: string;
  apiKey: string;
  maxChars: number;
  offset?: number;
  signal?: AbortSignal;
}): Promise<{
  content: string;
  title?: string;
  links?: WebFetchLink[];
  truncated: boolean;
  charCount: number;
  offset: number;
  nextOffset?: number;
}> {
  const res = await expoFetch(`${DEFAULT_FIRECRAWL_BASE_URL}/v1/scrape`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      url: params.url,
      formats: ['markdown'],
      onlyMainContent: true,
    }),
    credentials: 'omit',
    signal: params.signal,
  });

  if (!res.ok) throw new Error(`Firecrawl failed: HTTP ${res.status}`);
  const data = await res.json();

  const markdown = data?.data?.markdown || '';
  const title = data?.data?.metadata?.title;
  const links = extractFetchedLinksFromMarkdown(markdown);
  const window = sliceTextWindow(markdown, params.offset ?? 0, params.maxChars);
  return {
    content: window.text,
    title,
    ...(links ? { links } : {}),
    truncated: window.truncated,
    charCount: window.totalChars,
    offset: window.offset,
    ...(window.nextOffset !== undefined ? { nextOffset: window.nextOffset } : {}),
  };
}
