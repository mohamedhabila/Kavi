// ---------------------------------------------------------------------------
// Kavi — Enhanced Web Fetch Tool
// ---------------------------------------------------------------------------
// Regex-based HTML→Markdown extraction + optional Firecrawl API fallback.

import { getSecure } from '../../services/storage/SecureStorage';
import { resolveGoogleGroundingRedirectUrl } from '../../services/browser/core/groundingRedirect';
import {
  CacheEntry,
  DEFAULT_CACHE_TTL_MINUTES,
  DEFAULT_TIMEOUT_SECONDS,
  normalizeCacheKey,
  readCache,
  resolveCacheTtlMs,
  resolveTimeoutSeconds,
  withTimeout,
  writeCache,
} from './web-shared';
import { ToolDefinition } from '../../types/tool';
import {
  completedToolOutcome,
  failedToolOutcome,
  type ToolRuntimeOutcome,
} from '../../types/toolRuntimeOutcome';
import { isAllowedUrl } from '../../services/security/ssrf';
import {
  describeFetchError,
  directFetch,
  firecrawlFetch,
  type WebFetchEntry,
  clearWebFetchDocumentCache,
} from './webFetchTransports';

export const DEFAULT_FETCH_MAX_CHARS = 20_000;

const FETCH_CACHE = new Map<string, CacheEntry<Record<string, unknown>>>();

export function clearWebFetchCaches(): void {
  FETCH_CACHE.clear();
  clearWebFetchDocumentCache();
}

async function executeSingleWebFetch(args: {
  url: string;
  extractMode?: string;
  maxChars?: number;
  offset?: number;
  find?: string;
  signal?: AbortSignal;
}): Promise<WebFetchEntry> {
  const urlString = args.url?.trim();
  if (!urlString) {
    return { error: 'URL is required' };
  }

  // SSRF check
  if (!isAllowedUrl(urlString)) {
    return {
      requestedUrl: urlString,
      error: 'URL blocked by security policy (private/internal address)',
    };
  }

  const requestedUrl = urlString;
  const resolvedInputUrl = await resolveGoogleGroundingRedirectUrl(requestedUrl).catch(
    () => requestedUrl,
  );
  if (resolvedInputUrl !== requestedUrl && !isAllowedUrl(resolvedInputUrl)) {
    return {
      requestedUrl,
      error: 'URL blocked by security policy after redirect resolution (private/internal address)',
    };
  }

  const extractMode = (args.extractMode === 'text' ? 'text' : 'markdown') as 'markdown' | 'text';
  const maxChars = Math.max(100, args.maxChars || DEFAULT_FETCH_MAX_CHARS);
  const offset = Math.max(0, Math.floor(Number(args.offset) || 0));
  const find = typeof args.find === 'string' ? args.find.trim() : '';

  const cacheTtlMs = resolveCacheTtlMs(DEFAULT_CACHE_TTL_MINUTES, DEFAULT_CACHE_TTL_MINUTES);
  const cacheKey = normalizeCacheKey(`${resolvedInputUrl}:${extractMode}:${maxChars}:${offset}:${find}`);
  const cached = readCache(FETCH_CACHE, cacheKey);
  if (cached) {
    return cached.value as WebFetchEntry;
  }

  const timeoutMs = resolveTimeoutSeconds(DEFAULT_TIMEOUT_SECONDS, DEFAULT_TIMEOUT_SECONDS) * 1000;
  const directTimeout = withTimeout(args.signal, timeoutMs);

  try {
    // Try direct fetch first
    const result = await directFetch({
      url: resolvedInputUrl,
      extractMode,
      maxChars,
      offset,
      ...(find ? { find } : {}),
      signal: directTimeout.signal,
    });
    const finalUrl = result.resolvedUrl || resolvedInputUrl;
    const output: Record<string, unknown> = {
      url: finalUrl,
      content: result.content,
      ...(result.title ? { title: result.title } : {}),
      ...(result.links ? { links: result.links } : {}),
      truncated: result.truncated,
      charCount: result.charCount,
      offset: result.offset,
      ...(result.nextOffset !== undefined ? { nextOffset: result.nextOffset } : {}),
      ...(result.matchCount !== undefined ? { matchCount: result.matchCount } : {}),
    };
    if (requestedUrl !== finalUrl) {
      output.requestedUrl = requestedUrl;
      output.resolvedUrl = finalUrl;
    }
    writeCache(FETCH_CACHE, cacheKey, output, cacheTtlMs);
    return output as WebFetchEntry;
  } catch (directError: unknown) {
    const directMsg = describeFetchError(directError);
    // Try Firecrawl fallback with a fresh signal (direct's signal may be aborted)
    const firecrawlKey = await getSecure('FIRECRAWL_API_KEY');
    if (firecrawlKey) {
      const firecrawlTimeout = withTimeout(args.signal, timeoutMs);
      try {
        const result = await firecrawlFetch({
          url: resolvedInputUrl,
          apiKey: firecrawlKey,
          maxChars,
          offset,
          signal: firecrawlTimeout.signal,
        });
        const finalUrl = resolvedInputUrl;
        const output: Record<string, unknown> = {
          url: finalUrl,
          content: result.content,
          ...(result.title ? { title: result.title } : {}),
          ...(result.links ? { links: result.links } : {}),
          truncated: result.truncated,
          charCount: result.charCount,
          offset: result.offset,
          ...(result.nextOffset !== undefined ? { nextOffset: result.nextOffset } : {}),
          source: 'firecrawl',
        };
        if (requestedUrl !== finalUrl) {
          output.requestedUrl = requestedUrl;
          output.resolvedUrl = finalUrl;
        }
        writeCache(FETCH_CACHE, cacheKey, output, cacheTtlMs);
        return output as WebFetchEntry;
      } catch (firecrawlError: unknown) {
        const firecrawlMsg = describeFetchError(firecrawlError);
        return {
          requestedUrl,
          url: resolvedInputUrl,
          error: 'Fetch failed after direct and fallback attempts.',
          directError: directMsg,
          fallbackError: firecrawlMsg,
        } as WebFetchEntry;
      } finally {
        firecrawlTimeout.dispose();
      }
    }

    return {
      requestedUrl,
      url: resolvedInputUrl,
      error: `Fetch failed: ${directMsg}`,
    };
  } finally {
    directTimeout.dispose();
  }
}

export async function executeWebFetch(
  args: {
    urls: string[];
    extractMode?: string;
    maxChars?: number;
    offset?: number;
    find?: string;
  },
  signal?: AbortSignal,
): Promise<ToolRuntimeOutcome> {
  const urls = Array.isArray(args.urls)
    ? args.urls.map((value) => (typeof value === 'string' ? value.trim() : '')).filter(Boolean)
    : [];
  if (urls.length === 0) {
    return failedToolOutcome(JSON.stringify({ error: 'At least one URL is required' }));
  }

  const fetches = await Promise.all(
    urls.map((url) =>
      executeSingleWebFetch({
        url,
        extractMode: args.extractMode,
        maxChars: args.maxChars,
        offset: args.offset,
        find: args.find,
        signal,
      }),
    ),
  );

  const content = JSON.stringify({ fetches });
  return fetches.some((entry) => Boolean(entry.error))
    ? failedToolOutcome(content)
    : completedToolOutcome(content);
}

// ── Tool Definition ──────────────────────────────────────────────────────

export const WEB_FETCH_TOOL: ToolDefinition = {
  name: 'web_fetch',
  description:
    'Fetch one or more web pages and extract their content as markdown or plain text. ' +
    'Use this for any plausible HTTP or HTTPS pages you want to read, whether the URLs came from web_search, the user, or direct reasoning. ' +
    'When multiple independent pages need to be read, pass them together in urls so they are fetched in parallel in one tool call. ' +
    'Each page returns a contiguous window of maxChars characters (default: 20,000) starting at offset. ' +
    'When the response has truncated:true it also returns charCount (the full length) and nextOffset. ' +
    'To read further into the same page, call web_fetch again with the same url and offset set to nextOffset — ' +
    'do not re-fetch the same window or hunt for an alternative URL. ' +
    'When you need one specific value rather than the whole page, pass find with the text to look for; ' +
    'the response then contains only the matching regions and matchCount tells you whether the page has it at all.',
  input_schema: {
    type: 'object',
    properties: {
      urls: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        description: 'One or more HTTP or HTTPS URLs to fetch in parallel',
      },
      extractMode: { type: 'string', description: '"markdown" (default) or "text"' },
      maxChars: {
        type: 'number',
        description: 'Characters to return per fetched page window (default: 20000)',
      },
      find: {
        type: 'string',
        description:
          'Return only the parts of the page that mention this text, with surrounding context, instead of a positional window. Use this when looking for a specific value; matchCount:0 means the page does not contain it, so try a different source rather than another window.',
      },
      offset: {
        type: 'number',
        description:
          'Character offset to start the window at (default: 0). Pass the nextOffset from a truncated response to continue reading the same page.',
      },
    },
    required: ['urls'],
  },
  contract: {
    category: 'web',
    capabilities: ['read', 'verify'],
    boundedOutput: true,
    resourceKinds: ['unknown'],
    sideEffects: ['none'],
    riskHints: ['read_only', 'open_world'],
    providesEvidence: ['verification'],
    workflowStages: ['inspect_resource', 'verify_evidence'],
    consumes: [{ kind: 'url', field: 'search_result', required: false }],
  },
  strict: true,
};
