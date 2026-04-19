// ---------------------------------------------------------------------------
// Kavi — Enhanced Web Fetch Tool
// ---------------------------------------------------------------------------
// Regex-based HTML→Markdown extraction + optional Firecrawl API fallback.

import { fetch as expoFetch } from 'expo/fetch';

import { getSecure } from '../../services/storage/SecureStorage';
import { htmlToMarkdown, truncateText } from './web-fetch-utils';
import {
  CacheEntry,
  DEFAULT_CACHE_TTL_MINUTES,
  DEFAULT_TIMEOUT_SECONDS,
  normalizeCacheKey,
  readCache,
  readResponseText,
  resolveCacheTtlMs,
  resolveTimeoutSeconds,
  withTimeout,
  writeCache,
} from './web-shared';
import { ToolDefinition } from '../../types';
import { isAllowedUrl } from '../../services/security/ssrf';

const DEFAULT_FETCH_MAX_CHARS = 50_000;
const DEFAULT_FETCH_MAX_RESPONSE_BYTES = 2_000_000;
const DEFAULT_FIRECRAWL_BASE_URL = 'https://api.firecrawl.dev';
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const FALLBACK_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const FETCH_CACHE = new Map<string, CacheEntry<Record<string, unknown>>>();

// ── Direct fetch with HTML→Markdown extraction ───────────────────────────

async function directFetch(params: {
  url: string;
  extractMode: 'markdown' | 'text';
  maxChars: number;
  signal?: AbortSignal;
}): Promise<{ content: string; title?: string; truncated: boolean }> {
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

  for (const headers of headerProfiles) {
    try {
      const res = await expoFetch(params.url, {
        credentials: 'omit',
        headers,
        redirect: 'follow',
        signal: params.signal,
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(
          `HTTP ${res.status} ${res.statusText}${detail ? `: ${detail.slice(0, 160)}` : ''}`,
        );
      }

      const contentType = res.headers.get('content-type') || '';
      const { text: rawText } = await readResponseText(res, {
        maxBytes: DEFAULT_FETCH_MAX_RESPONSE_BYTES,
      });

      if (contentType.includes('application/json')) {
        const { text, truncated } = truncateText(rawText, params.maxChars);
        return { content: text, truncated };
      }

      if (contentType.includes('text/plain') || contentType.includes('text/csv')) {
        const { text, truncated } = truncateText(rawText, params.maxChars);
        return { content: text, truncated };
      }

      const { text: markdown, title } = htmlToMarkdown(rawText);
      const { text: truncatedMd, truncated } = truncateText(markdown, params.maxChars);
      return { content: truncatedMd, title, truncated };
    } catch (error: unknown) {
      if (params.signal?.aborted) throw error;
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError || new Error('Fetch failed');
}

// ── Firecrawl API fallback ───────────────────────────────────────────────

async function firecrawlFetch(params: {
  url: string;
  apiKey: string;
  maxChars: number;
  signal?: AbortSignal;
}): Promise<{ content: string; title?: string; truncated: boolean }> {
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
  const { text, truncated } = truncateText(markdown, params.maxChars);
  return { content: text, title, truncated };
}

// ── Main fetch dispatcher ────────────────────────────────────────────────

export async function executeWebFetch(args: {
  url: string;
  extractMode?: string;
  maxChars?: number;
}): Promise<string> {
  const urlString = args.url?.trim();
  if (!urlString) return JSON.stringify({ error: 'URL is required' });

  // SSRF check
  if (!isAllowedUrl(urlString)) {
    return JSON.stringify({ error: 'URL blocked by security policy (private/internal address)' });
  }

  const extractMode = (args.extractMode === 'text' ? 'text' : 'markdown') as 'markdown' | 'text';
  const maxChars = Math.max(100, args.maxChars || DEFAULT_FETCH_MAX_CHARS);

  const cacheTtlMs = resolveCacheTtlMs(DEFAULT_CACHE_TTL_MINUTES, DEFAULT_CACHE_TTL_MINUTES);
  const cacheKey = normalizeCacheKey(`${urlString}:${extractMode}:${maxChars}`);
  const cached = readCache(FETCH_CACHE, cacheKey);
  if (cached) return JSON.stringify(cached.value);

  const timeoutMs = resolveTimeoutSeconds(DEFAULT_TIMEOUT_SECONDS, DEFAULT_TIMEOUT_SECONDS) * 1000;
  const directTimeout = withTimeout(undefined, timeoutMs);

  try {
    // Try direct fetch first
    const result = await directFetch({
      url: urlString,
      extractMode,
      maxChars,
      signal: directTimeout.signal,
    });
    const output: Record<string, unknown> = {
      url: urlString,
      content: result.content,
      title: result.title,
      truncated: result.truncated,
      charCount: result.content.length,
    };
    writeCache(FETCH_CACHE, cacheKey, output, cacheTtlMs);
    return JSON.stringify(output);
  } catch (directError: unknown) {
    const directMsg = directError instanceof Error ? directError.message : String(directError);
    // Try Firecrawl fallback with a fresh signal (direct's signal may be aborted)
    const firecrawlKey = await getSecure('FIRECRAWL_API_KEY');
    if (firecrawlKey) {
      const firecrawlTimeout = withTimeout(undefined, timeoutMs);
      try {
        const result = await firecrawlFetch({
          url: urlString,
          apiKey: firecrawlKey,
          maxChars,
          signal: firecrawlTimeout.signal,
        });
        const output: Record<string, unknown> = {
          url: urlString,
          content: result.content,
          title: result.title,
          truncated: result.truncated,
          charCount: result.content.length,
          source: 'firecrawl',
        };
        writeCache(FETCH_CACHE, cacheKey, output, cacheTtlMs);
        return JSON.stringify(output);
      } catch (firecrawlError: unknown) {
        const firecrawlMsg =
          firecrawlError instanceof Error ? firecrawlError.message : String(firecrawlError);
        return JSON.stringify({
          error: `Both direct fetch and Firecrawl failed. Direct: ${directMsg}. Firecrawl: ${firecrawlMsg}`,
        });
      } finally {
        firecrawlTimeout.dispose();
      }
    }

    return JSON.stringify({ error: `Fetch failed: ${directMsg}` });
  } finally {
    directTimeout.dispose();
  }
}

// ── Tool Definition ──────────────────────────────────────────────────────

export const WEB_FETCH_TOOL: ToolDefinition = {
  name: 'web_fetch',
  description:
    'Fetch a web page and extract its content as clean markdown or plain text. ' +
    'Uses HTML-to-Markdown conversion with optional Firecrawl API fallback for better extraction. ' +
    'Response is truncated to maxChars (default: 50,000).',
  input_schema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'HTTP or HTTPS URL to fetch' },
      extractMode: { type: 'string', description: '"markdown" (default) or "text"' },
      maxChars: { type: 'number', description: 'Maximum characters to return (default: 50000)' },
    },
    required: ['url'],
  },
  strict: true,
};
