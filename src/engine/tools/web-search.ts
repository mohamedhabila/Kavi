import type { ToolDefinition } from '../../types/tool';
import type { ToolProviderContextInput } from './toolProviderContext';
import {
  getSearchProviderApiKey,
  resolveConfiguredSearchProvider,
  resolveSearchProvider,
  type SearchProvider,
} from '../../services/browser/core/providerDispatch';
import {
  normalizeShallowWebSearchResult,
  type ShallowWebSearchResultRecord,
} from '../../services/browser/core/resultShape';
import {
  CacheEntry,
  DEFAULT_CACHE_TTL_MINUTES,
  DEFAULT_TIMEOUT_SECONDS,
  isAbortLikeTransportError,
  normalizeCacheKey,
  readCache,
  resolveCacheTtlMs,
  runWithTimeoutRetries,
  writeCache,
} from './web-shared';
import { resolveGeminiSearchTransport } from './webSearchGeminiTransport';
import { searchRemoteWebProvider } from './webSearchRemote';

const SEARCH_RESULTS_PER_QUERY = 5;
const MAX_BATCH_SEARCH_QUERIES = 4;
const SEARCH_TOOL_TIMEOUT_SECONDS = 75;
const SEARCH_TRANSPORT_ATTEMPTS = 2;

const SEARCH_CACHE = new Map<string, CacheEntry<Record<string, unknown>>>();

type ExecuteWebSearchArgs = {
  queries?: string[];
  freshness?: string;
  country?: string;
  language?: string;
};

type NormalizedWebSearchRequest = {
  query: string;
};

function normalizeWebSearchRequests(args: ExecuteWebSearchArgs):
  | {
      searches: NormalizedWebSearchRequest[];
    }
  | {
      error: string;
    } {
  const batchQueries = Array.isArray(args.queries)
    ? args.queries
        .map((query) => (typeof query === 'string' ? query.trim() : ''))
        .filter((query): query is string => query.length > 0)
    : [];

  const normalizedQueries = batchQueries.filter(
    (query, index, queries) => queries.indexOf(query) === index,
  );
  if (normalizedQueries.length === 0) {
    return { error: 'At least one search query is required' };
  }
  if (normalizedQueries.length > MAX_BATCH_SEARCH_QUERIES) {
    return {
      error: `A maximum of ${MAX_BATCH_SEARCH_QUERIES} parallel search queries is supported per call`,
    };
  }

  const searches = normalizedQueries.map((query) => {
    return {
      query,
    };
  });

  return { searches };
}

async function executeSingleWebSearch(params: {
  provider: SearchProvider;
  apiKey: string;
  query: string;
  count: number;
  freshness?: string;
  country?: string;
  language?: string;
  context?: ToolProviderContextInput;
}): Promise<ShallowWebSearchResultRecord> {
  const cacheTtlMs = resolveCacheTtlMs(DEFAULT_CACHE_TTL_MINUTES, DEFAULT_CACHE_TTL_MINUTES);
  const preferredProvider = resolveConfiguredSearchProvider() || 'auto';
  const cacheKey = normalizeCacheKey(
    `${preferredProvider}:${params.query}:${params.count}:${params.freshness || ''}`,
  );
  const cached = readCache(SEARCH_CACHE, cacheKey);
  if (cached) {
    return normalizeShallowWebSearchResult({
      query: params.query,
      result: cached.value,
      maxResults: SEARCH_RESULTS_PER_QUERY,
    });
  }

  const result = await runWithTimeoutRetries({
    attempts: SEARCH_TRANSPORT_ATTEMPTS,
    timeoutSeconds: SEARCH_TOOL_TIMEOUT_SECONDS || DEFAULT_TIMEOUT_SECONDS,
    shouldRetry: isAbortLikeTransportError,
    operation: (signal) =>
      searchRemoteWebProvider({
        provider: params.provider,
        query: params.query,
        count: params.count,
        apiKey: params.apiKey,
        freshness: params.freshness,
        country: params.country,
        language: params.language,
        context: params.context,
        signal,
      }),
  });

  writeCache(SEARCH_CACHE, cacheKey, result, cacheTtlMs);
  return normalizeShallowWebSearchResult({
    query: params.query,
    result,
    maxResults: SEARCH_RESULTS_PER_QUERY,
  });
}

export async function executeWebSearch(
  args: ExecuteWebSearchArgs,
  context?: ToolProviderContextInput,
): Promise<string> {
  const normalizedSearches = normalizeWebSearchRequests(args);
  if ('error' in normalizedSearches) {
    return JSON.stringify({ error: normalizedSearches.error });
  }

  const resolved = await resolveSearchProvider({
    resolveGeminiApiKey: async () =>
      (
        await resolveGeminiSearchTransport({
          context,
          fallbackApiKey: await getSearchProviderApiKey('gemini'),
        })
      )?.apiKey,
  });
  if (!resolved) {
    return JSON.stringify({
      error:
        'No web search provider configured. Add an API key in Settings for Brave, Gemini, Perplexity, Grok (xAI), or Kimi.',
    });
  }

  try {
    const searches = await Promise.all(
      normalizedSearches.searches.map(async (search) => {
        try {
          return await executeSingleWebSearch({
            provider: resolved.provider,
            apiKey: resolved.apiKey,
            query: search.query,
            count: SEARCH_RESULTS_PER_QUERY,
            freshness: args.freshness,
            country: args.country,
            language: args.language,
            context,
          });
        } catch (error: unknown) {
          return {
            query: search.query,
            error: `Search failed: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }),
    );

    return JSON.stringify({
      provider: resolved.provider,
      searches,
    });
  } catch (error: unknown) {
    return JSON.stringify({
      error: `Search failed: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

export const WEB_SEARCH_TOOL: ToolDefinition = {
  name: 'web_search',
  description:
    'Run one or more independent web searches using the configured search provider. Always pass every ' +
    'search in queries; for one lookup, use a one-item queries array. Batch independent searches together in one call. ' +
    'This tool is intentionally shallow: it returns only the top 5 candidate pages per query for discovery, not page content or summaries. ' +
    'Use plain-language queries. For comparisons, search each source separately and compare after fetching them. ' +
    'If you already have a plausible URL, use web_fetch directly instead of searching first. Pass several URLs together in one web_fetch call when multiple pages should be read. Returns one searches[] entry per query, ' +
    'each with query, results, and optional error.',
  input_schema: {
    type: 'object',
    properties: {
      queries: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: MAX_BATCH_SEARCH_QUERIES,
        description: 'One or more independent search queries to run in parallel in one tool call',
      },
      freshness: { type: 'string', description: 'Time filter: day, week, month, or year' },
      country: { type: 'string', description: '2-letter country code (e.g. US, DE)' },
      language: { type: 'string', description: 'ISO 639-1 language code (e.g. en, de)' },
    },
    required: ['queries'],
  },
  contract: {
    category: 'web',
    capabilities: ['discover'],
    resourceKinds: ['unknown'],
    sideEffects: ['none'],
    riskHints: ['read_only', 'open_world'],
    providesEvidence: ['verification'],
    workflowStages: ['discover_resource'],
    produces: [{ kind: 'url', field: 'search_result' }],
    precedes: ['web_fetch'],
  },
  strict: true,
};

export function clearWebSearchCaches(): void {
  SEARCH_CACHE.clear();
}
