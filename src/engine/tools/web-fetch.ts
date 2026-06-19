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
import { isAllowedUrl } from '../../services/security/ssrf';
import {
  describeFetchError,
  directFetch,
  firecrawlFetch,
  type WebFetchEntry,
} from './webFetchTransports';

const DEFAULT_FETCH_MAX_CHARS = 20_000;

const FETCH_CACHE = new Map<string, CacheEntry<Record<string, unknown>>>();

export function clearWebFetchCaches(): void {
  FETCH_CACHE.clear();
}

async function executeSingleWebFetch(args: {
  url: string;
  extractMode?: string;
  maxChars?: number;
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

  const cacheTtlMs = resolveCacheTtlMs(DEFAULT_CACHE_TTL_MINUTES, DEFAULT_CACHE_TTL_MINUTES);
  const cacheKey = normalizeCacheKey(`${resolvedInputUrl}:${extractMode}:${maxChars}`);
  const cached = readCache(FETCH_CACHE, cacheKey);
  if (cached) {
    return cached.value as WebFetchEntry;
  }

  const timeoutMs = resolveTimeoutSeconds(DEFAULT_TIMEOUT_SECONDS, DEFAULT_TIMEOUT_SECONDS) * 1000;
  const directTimeout = withTimeout(undefined, timeoutMs);

  try {
    // Try direct fetch first
    const result = await directFetch({
      url: resolvedInputUrl,
      extractMode,
      maxChars,
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
      const firecrawlTimeout = withTimeout(undefined, timeoutMs);
      try {
        const result = await firecrawlFetch({
          url: resolvedInputUrl,
          apiKey: firecrawlKey,
          maxChars,
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

export async function executeWebFetch(args: {
  urls: string[];
  extractMode?: string;
  maxChars?: number;
}): Promise<string> {
  const urls = Array.isArray(args.urls)
    ? args.urls.map((value) => (typeof value === 'string' ? value.trim() : '')).filter(Boolean)
    : [];
  if (urls.length === 0) {
    return JSON.stringify({ error: 'At least one URL is required' });
  }

  const fetches = await Promise.all(
    urls.map((url) =>
      executeSingleWebFetch({
        url,
        extractMode: args.extractMode,
        maxChars: args.maxChars,
      }),
    ),
  );

  return JSON.stringify({ fetches });
}

// ── Tool Definition ──────────────────────────────────────────────────────

export const WEB_FETCH_TOOL: ToolDefinition = {
  name: 'web_fetch',
  description:
    'Fetch one or more web pages and extract their content as markdown or plain text. ' +
    'Use this for any plausible HTTP or HTTPS pages you want to read, whether the URLs came from web_search, the user, or direct reasoning. ' +
    'When multiple independent pages need to be read, pass them together in urls so they are fetched in parallel in one tool call. ' +
    'Each page response is truncated to maxChars (default: 20,000). Increase maxChars only when more page content is necessary.',
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
        description: 'Maximum characters to return per fetched page (default: 20000)',
      },
    },
    required: ['urls'],
  },
  contract: {
    category: 'web',
    capabilities: ['read', 'verify'],
    resourceKinds: ['unknown'],
    sideEffects: ['none'],
    riskHints: ['read_only', 'open_world'],
    providesEvidence: ['verification'],
    workflowStages: ['inspect_resource', 'verify_evidence'],
    consumes: [{ kind: 'url', field: 'search_result', required: false }],
  },
  strict: true,
};
