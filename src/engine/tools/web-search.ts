import type { ToolDefinition } from '../../types/tool';
import type { ToolProviderContextInput } from './toolProviderContext';
import {
  completedToolOutcome,
  failedToolOutcome,
  type ToolRuntimeOutcome,
} from '../../types/toolRuntimeOutcome';
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
import { resolveAnthropicSearchTransport } from './webSearchAnthropicTransport';
import { resolveGeminiSearchTransport } from './webSearchGeminiTransport';
import { resolveOpenAISearchTransport } from './webSearchOpenAITransport';
import { resolveOpenRouterSearchTransport } from './webSearchOpenRouterTransport';
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
    signal: params.context?.executionSignal,
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
): Promise<ToolRuntimeOutcome> {
  const normalizedSearches = normalizeWebSearchRequests(args);
  if ('error' in normalizedSearches) {
    return failedToolOutcome(JSON.stringify({ error: normalizedSearches.error }));
  }

  const resolved = await resolveSearchProvider({
    resolveGeminiApiKey: async () =>
      (
        await resolveGeminiSearchTransport({
          context,
          fallbackApiKey: await getSearchProviderApiKey('gemini'),
        })
      )?.apiKey,
    resolveAnthropicApiKey: async () =>
      (await resolveAnthropicSearchTransport({ context }))?.provider.apiKey,
    resolveOpenAIApiKey: async () => (await resolveOpenAISearchTransport({ context }))?.provider.apiKey,
    resolveOpenRouterApiKey: async () =>
      (await resolveOpenRouterSearchTransport({ context }))?.provider.apiKey,
  });
  if (!resolved) {
    // This is a model-facing tool result, not a user-facing message: it must tell the
    // model what to do next, not point the user at Settings (that hint already lives in
    // the UI). web_fetch needs no key and reaches the same keyless public sources named
    // in the runtime guidance, so it is always the correct next step.
    return failedToolOutcome(
      JSON.stringify({
        error:
          'Web search is unavailable: no search provider is configured. Use web_fetch on a public ' +
          'source instead of asking about setup — for example Open-Meteo for weather/geocoding ' +
          '(https://geocoding-api.open-meteo.com/v1/search?name=… then ' +
          'https://api.open-meteo.com/v1/forecast?latitude=…&longitude=…&daily=…&timezone=auto) or ' +
          'Wikipedia (https://<lang>.wikipedia.org/api/rest_v1/page/summary/<title>).',
      }),
    );
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

    const content = JSON.stringify({
      provider: resolved.provider,
      searches,
    });
    return searches.some((search) => 'error' in search)
      ? failedToolOutcome(content)
      : completedToolOutcome(content);
  } catch (error: unknown) {
    return failedToolOutcome(
      JSON.stringify({
        error: `Search failed: ${error instanceof Error ? error.message : String(error)}`,
      }),
    );
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
    runtimeRequirements: ['web_search_provider'],
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
