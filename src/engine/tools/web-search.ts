// ---------------------------------------------------------------------------
// Kavi — Web Search Tool
// ---------------------------------------------------------------------------
// 5 search providers: Brave, Perplexity, Grok, Kimi, Gemini
// All use standard fetch() — fully RN compatible.

import { getSecure } from '../../services/storage/SecureStorage';
import { useSettingsStore } from '../../store/useSettingsStore';
import { DEFAULT_GEMINI_AI_STUDIO_BASE_URL, DEFAULT_GEMINI_BASE_URL } from '../../constants/api';
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
import { ToolDefinition, WebSearchProvider } from '../../types';

// ── Constants ────────────────────────────────────────────────────────────

const SEARCH_PROVIDERS = ['brave', 'perplexity', 'grok', 'kimi', 'gemini'] as const;
type SearchProvider = Exclude<WebSearchProvider, 'auto'>;

const DEFAULT_SEARCH_COUNT = 5;
const MAX_SEARCH_COUNT = 10;

const BRAVE_SEARCH_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';
const XAI_API_ENDPOINT = 'https://api.x.ai/v1/responses';
const DEFAULT_GROK_MODEL = 'grok-4-1-fast';
const DEFAULT_KIMI_BASE_URL = 'https://api.moonshot.ai/v1';
const DEFAULT_KIMI_MODEL = 'moonshot-v1-128k';
const DEFAULT_PERPLEXITY_MODEL = 'perplexity/sonar-pro';
const DEFAULT_PERPLEXITY_BASE_URL = 'https://openrouter.ai/api/v1';
const PERPLEXITY_DIRECT_BASE_URL = 'https://api.perplexity.ai';
const DEFAULT_GEMINI_SEARCH_MODEL = 'gemini-2.5-flash';

const SEARCH_CACHE = new Map<string, CacheEntry<Record<string, unknown>>>();
const GEMINI_SEARCH_BACKEND_CACHE = new Map<string, GeminiSearchBackend>();

type GeminiSearchBackend = 'vertex' | 'ai-studio';

class GeminiSearchHttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'GeminiSearchHttpError';
    this.status = status;
  }
}

const FRESHNESS_TO_RECENCY: Record<string, string> = {
  pd: 'day',
  pw: 'week',
  pm: 'month',
  py: 'year',
};
const RECENCY_TO_FRESHNESS: Record<string, string> = {
  day: 'pd',
  week: 'pw',
  month: 'pm',
  year: 'py',
};

// ── API Key Resolution ───────────────────────────────────────────────────

async function getApiKey(key: string): Promise<string | null> {
  return getSecure(key);
}

function fetchWithoutCookies(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...init,
    credentials: init.credentials ?? 'omit',
  });
}

async function detectProvider(): Promise<{ provider: SearchProvider; apiKey: string } | null> {
  const providers: Array<{ provider: SearchProvider; key: string }> = [
    { provider: 'brave', key: 'BRAVE_API_KEY' },
    { provider: 'perplexity', key: 'PERPLEXITY_API_KEY' },
    { provider: 'grok', key: 'XAI_API_KEY' },
    { provider: 'kimi', key: 'KIMI_API_KEY' },
    { provider: 'gemini', key: 'GOOGLE_API_KEY' },
  ];

  for (const { provider, key } of providers) {
    const apiKey = await getApiKey(key);
    if (apiKey) return { provider, apiKey };
  }
  return null;
}

// ── Brave Search ─────────────────────────────────────────────────────────

function resolveBraveFreshness(freshness?: string): string | undefined {
  if (!freshness) return undefined;
  const lower = freshness.trim().toLowerCase();
  if (['pd', 'pw', 'pm', 'py'].includes(lower)) return lower;
  if (RECENCY_TO_FRESHNESS[lower]) return RECENCY_TO_FRESHNESS[lower];
  return undefined;
}

async function searchBrave(params: {
  query: string;
  count: number;
  apiKey: string;
  freshness?: string;
  country?: string;
  language?: string;
  signal?: AbortSignal;
}): Promise<Record<string, unknown>> {
  const url = new URL(BRAVE_SEARCH_ENDPOINT);
  url.searchParams.set('q', params.query);
  url.searchParams.set('count', String(Math.min(params.count, MAX_SEARCH_COUNT)));
  if (params.country && params.country !== 'ALL') {
    url.searchParams.set('country', params.country.toUpperCase());
  }
  if (params.language) url.searchParams.set('search_lang', params.language);
  const braveFreshness = resolveBraveFreshness(params.freshness);
  if (braveFreshness) url.searchParams.set('freshness', braveFreshness);

  const res = await fetchWithoutCookies(url.toString(), {
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': params.apiKey,
    },
    signal: params.signal,
  });

  if (!res.ok) throw new Error(`Brave search failed: HTTP ${res.status}`);
  const data = await res.json();
  const results = (data?.web?.results || []).map((r: any) => ({
    title: r.title || '',
    url: r.url || '',
    description: r.description || '',
    age: r.age,
  }));

  return {
    provider: 'brave',
    query: params.query,
    results,
    citations: results.map((r: any) => r.url).filter(Boolean),
  };
}

// ── Perplexity Search ────────────────────────────────────────────────────

function resolvePerplexityBaseUrl(apiKey: string): string {
  if (apiKey.startsWith('pplx-')) return PERPLEXITY_DIRECT_BASE_URL;
  return DEFAULT_PERPLEXITY_BASE_URL;
}

async function searchPerplexity(params: {
  query: string;
  count: number;
  apiKey: string;
  freshness?: string;
  signal?: AbortSignal;
}): Promise<Record<string, unknown>> {
  const baseUrl = resolvePerplexityBaseUrl(params.apiKey);
  const model = params.apiKey.startsWith('pplx-') ? 'sonar-pro' : DEFAULT_PERPLEXITY_MODEL;

  const body: Record<string, unknown> = {
    model,
    messages: [{ role: 'user', content: params.query }],
    max_tokens: 1024,
  };

  const recency = params.freshness
    ? FRESHNESS_TO_RECENCY[params.freshness] || params.freshness
    : undefined;
  if (recency && ['day', 'week', 'month', 'year'].includes(recency)) {
    body.search_recency_filter = recency;
  }

  const res = await fetchWithoutCookies(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: params.signal,
  });

  if (!res.ok) throw new Error(`Perplexity search failed: HTTP ${res.status}`);
  const data = await res.json();

  const content = data?.choices?.[0]?.message?.content || '';
  const citations: string[] = [];
  for (const c of data?.citations || []) {
    if (typeof c === 'string' && c.trim()) citations.push(c);
  }
  for (const choice of data?.choices || []) {
    for (const ann of choice?.message?.annotations || []) {
      const url = ann?.url_citation?.url || ann?.url;
      if (typeof url === 'string' && url.trim()) citations.push(url);
    }
  }

  return {
    provider: 'perplexity',
    query: params.query,
    summary: content,
    citations: [...new Set(citations)],
    results: citations.map((url: string) => ({ url, title: '', description: '' })),
  };
}

// ── Grok Search (xAI Responses API) ─────────────────────────────────────

async function searchGrok(params: {
  query: string;
  count: number;
  apiKey: string;
  freshness?: string;
  signal?: AbortSignal;
}): Promise<Record<string, unknown>> {
  const body = {
    model: DEFAULT_GROK_MODEL,
    tools: [{ type: 'web_search' as const }],
    input: params.query,
  };

  const res = await fetchWithoutCookies(XAI_API_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: params.signal,
  });

  if (!res.ok) throw new Error(`Grok search failed: HTTP ${res.status}`);
  const data = await res.json();

  // Extract text from xAI Responses API format
  let text = '';
  const citations: string[] = [];

  for (const output of data?.output || []) {
    if (output?.type === 'message') {
      for (const block of output?.content || []) {
        if (block?.type === 'output_text' && typeof block?.text === 'string') {
          text = block.text;
          for (const ann of block?.annotations || []) {
            if (ann?.type === 'url_citation' && typeof ann?.url === 'string') {
              citations.push(ann.url);
            }
          }
        }
      }
    }
    if (output?.type === 'output_text' && typeof output?.text === 'string') {
      text = output.text;
      for (const ann of output?.annotations || []) {
        if (ann?.type === 'url_citation' && typeof ann?.url === 'string') {
          citations.push(ann.url);
        }
      }
    }
  }

  if (!text && typeof data?.output_text === 'string') text = data.output_text;
  if (data?.citations) citations.push(...data.citations.filter((c: any) => typeof c === 'string'));

  return {
    provider: 'grok',
    query: params.query,
    summary: text,
    citations: [...new Set(citations)],
    results: [...new Set(citations)].map((url) => ({ url, title: '', description: '' })),
  };
}

// ── Kimi Search (Moonshot) ───────────────────────────────────────────────

async function searchKimi(params: {
  query: string;
  count: number;
  apiKey: string;
  signal?: AbortSignal;
}): Promise<Record<string, unknown>> {
  const body = {
    model: DEFAULT_KIMI_MODEL,
    messages: [{ role: 'user', content: params.query }],
    tools: [{ type: 'builtin_function', function: { name: '$web_search' } }],
    stream: false,
  };

  const res = await fetchWithoutCookies(`${DEFAULT_KIMI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: params.signal,
  });

  if (!res.ok) throw new Error(`Kimi search failed: HTTP ${res.status}`);
  const data = await res.json();

  const content = data?.choices?.[0]?.message?.content || '';
  const searchResults = (data?.search_results || []).map((r: any) => ({
    title: r.title || '',
    url: r.url || '',
    description: r.content || '',
  }));

  return {
    provider: 'kimi',
    query: params.query,
    summary: content,
    citations: searchResults.map((r: any) => r.url).filter(Boolean),
    results: searchResults,
  };
}

// ── Gemini Search ────────────────────────────────────────────────────────

function buildGeminiSearchUrl(model: string, backend: GeminiSearchBackend): string {
  const encodedModel = encodeURIComponent(model);
  if (backend === 'vertex') {
    return `${DEFAULT_GEMINI_BASE_URL}/publishers/google/models/${encodedModel}:generateContent`;
  }

  return `${DEFAULT_GEMINI_AI_STUDIO_BASE_URL}/models/${encodedModel}:generateContent`;
}

function buildGeminiSearchBody(
  query: string,
  model: string,
  backend: GeminiSearchBackend,
): Record<string, unknown> {
  return {
    contents: [{ role: 'user', parts: [{ text: query }] }],
    tools: backend === 'vertex' ? [{ googleSearch: {} }] : [{ google_search: {} }],
    ...(backend === 'vertex' ? { model: `publishers/google/models/${model}` } : {}),
  };
}

function shouldRetryGeminiSearchBackend(error: unknown): boolean {
  return error instanceof GeminiSearchHttpError && [400, 401, 403, 404].includes(error.status);
}

function extractGeminiGroundingResult(data: any): Record<string, unknown> {
  let text = '';
  const citations: string[] = [];

  const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
  for (const candidate of candidates) {
    for (const part of candidate?.content?.parts || []) {
      if (typeof part?.text === 'string') {
        text += part.text;
      }
    }
  }

  const grounding = candidates[0]?.groundingMetadata;
  if (grounding?.groundingChunks) {
    for (const chunk of grounding.groundingChunks) {
      if (chunk?.web?.uri) citations.push(chunk.web.uri);
    }
  }

  return {
    summary: text,
    citations: [...new Set(citations)],
    webSearchQueries: Array.isArray(grounding?.webSearchQueries) ? grounding.webSearchQueries : [],
    searchEntryPoint: grounding?.searchEntryPoint,
    groundingMetadata: grounding,
    results: [...new Set(citations)].map((url) => ({ url, title: '', description: '' })),
  };
}

async function searchGeminiWithBackend(params: {
  query: string;
  apiKey: string;
  signal?: AbortSignal;
  backend: GeminiSearchBackend;
}): Promise<Record<string, unknown>> {
  const model = DEFAULT_GEMINI_SEARCH_MODEL;
  const res = await fetchWithoutCookies(buildGeminiSearchUrl(model, params.backend), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': params.apiKey,
    },
    body: JSON.stringify(buildGeminiSearchBody(params.query, model, params.backend)),
    signal: params.signal,
  });

  if (!res.ok) {
    const errorText = await readResponseText(res);
    throw new GeminiSearchHttpError(
      res.status,
      `Gemini search failed: HTTP ${res.status}${errorText ? ` ${errorText}` : ''}`,
    );
  }

  const data = await res.json();
  return {
    provider: 'gemini',
    backend: params.backend,
    query: params.query,
    ...extractGeminiGroundingResult(data),
  };
}

async function searchGemini(params: {
  query: string;
  count: number;
  apiKey: string;
  signal?: AbortSignal;
}): Promise<Record<string, unknown>> {
  const cachedBackend = GEMINI_SEARCH_BACKEND_CACHE.get(params.apiKey);
  const backendOrder: GeminiSearchBackend[] = cachedBackend
    ? [cachedBackend, cachedBackend === 'vertex' ? 'ai-studio' : 'vertex']
    : ['vertex', 'ai-studio'];
  let lastError: unknown;

  for (let index = 0; index < backendOrder.length; index += 1) {
    const backend = backendOrder[index];

    try {
      const result = await searchGeminiWithBackend({
        query: params.query,
        apiKey: params.apiKey,
        signal: params.signal,
        backend,
      });
      GEMINI_SEARCH_BACKEND_CACHE.set(params.apiKey, backend);
      return result;
    } catch (error: unknown) {
      lastError = error;
      if (!shouldRetryGeminiSearchBackend(error) || index === backendOrder.length - 1) {
        throw error;
      }

      if (GEMINI_SEARCH_BACKEND_CACHE.get(params.apiKey) === backend) {
        GEMINI_SEARCH_BACKEND_CACHE.delete(params.apiKey);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Gemini search failed');
}

// ── Main search dispatcher ───────────────────────────────────────────────

export async function executeWebSearch(args: {
  query: string;
  count?: number;
  provider?: string;
  freshness?: string;
  country?: string;
  language?: string;
}): Promise<string> {
  const query = args.query?.trim();
  if (!query) return JSON.stringify({ error: 'Search query is required' });

  const count = Math.max(1, Math.min(args.count || DEFAULT_SEARCH_COUNT, MAX_SEARCH_COUNT));
  const cacheTtlMs = resolveCacheTtlMs(DEFAULT_CACHE_TTL_MINUTES, DEFAULT_CACHE_TTL_MINUTES);
  const cacheKey = normalizeCacheKey(
    `${args.provider || 'auto'}:${query}:${count}:${args.freshness || ''}`,
  );

  const cached = readCache(SEARCH_CACHE, cacheKey);
  if (cached) return JSON.stringify(cached.value);

  let resolved: { provider: SearchProvider; apiKey: string } | null = null;
  const preferredProvider = useSettingsStore.getState().webSearchProvider || 'auto';
  const requestedProvider =
    args.provider && SEARCH_PROVIDERS.includes(args.provider as SearchProvider)
      ? (args.provider as SearchProvider)
      : preferredProvider !== 'auto'
        ? preferredProvider
        : undefined;

  if (requestedProvider) {
    const key = await getApiKeyForProvider(requestedProvider);
    if (key) resolved = { provider: requestedProvider, apiKey: key };
  }

  if (!resolved) resolved = await detectProvider();
  if (!resolved) {
    return JSON.stringify({
      error:
        'No search provider configured. Add an API key in Settings for one of: Brave, Perplexity, Grok (xAI), Kimi, or Google Gemini.',
    });
  }

  const timeoutMs = resolveTimeoutSeconds(DEFAULT_TIMEOUT_SECONDS, DEFAULT_TIMEOUT_SECONDS) * 1000;
  const timeout = withTimeout(undefined, timeoutMs);

  try {
    let result: Record<string, unknown>;

    switch (resolved.provider) {
      case 'brave':
        result = await searchBrave({
          query,
          count,
          apiKey: resolved.apiKey,
          freshness: args.freshness,
          country: args.country,
          language: args.language,
          signal: timeout.signal,
        });
        break;
      case 'perplexity':
        result = await searchPerplexity({
          query,
          count,
          apiKey: resolved.apiKey,
          freshness: args.freshness,
          signal: timeout.signal,
        });
        break;
      case 'grok':
        result = await searchGrok({
          query,
          count,
          apiKey: resolved.apiKey,
          freshness: args.freshness,
          signal: timeout.signal,
        });
        break;
      case 'kimi':
        result = await searchKimi({
          query,
          count,
          apiKey: resolved.apiKey,
          signal: timeout.signal,
        });
        break;
      case 'gemini':
        result = await searchGemini({
          query,
          count,
          apiKey: resolved.apiKey,
          signal: timeout.signal,
        });
        break;
      default:
        return JSON.stringify({ error: `Unknown provider: ${resolved.provider}` });
    }

    writeCache(SEARCH_CACHE, cacheKey, result, cacheTtlMs);
    return JSON.stringify(result);
  } catch (err: unknown) {
    return JSON.stringify({
      error: `Search failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  } finally {
    timeout.dispose();
  }
}

async function getApiKeyForProvider(provider: SearchProvider): Promise<string | null> {
  const keyMap: Record<SearchProvider, string> = {
    brave: 'BRAVE_API_KEY',
    perplexity: 'PERPLEXITY_API_KEY',
    grok: 'XAI_API_KEY',
    kimi: 'KIMI_API_KEY',
    gemini: 'GOOGLE_API_KEY',
  };
  return getApiKey(keyMap[provider]);
}

// ── Tool Definition ──────────────────────────────────────────────────────

export const WEB_SEARCH_TOOL: ToolDefinition = {
  name: 'web_search',
  description:
    'Search the web using available search providers (Brave, Perplexity, Grok, Kimi, Gemini). ' +
    'Automatically selects the best configured provider. Returns search results with titles, URLs, ' +
    'descriptions, and citations. For Perplexity and Grok, also returns an AI-generated summary.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query string' },
      count: { type: 'number', description: 'Number of results (1-10, default: 5)' },
      provider: {
        type: 'string',
        description: 'Force a specific provider: brave, perplexity, grok, kimi, or gemini',
      },
      freshness: { type: 'string', description: 'Time filter: day, week, month, or year' },
      country: { type: 'string', description: '2-letter country code (e.g. US, DE)' },
      language: { type: 'string', description: 'ISO 639-1 language code (e.g. en, de)' },
    },
    required: ['query'],
  },
  strict: true,
};

export function clearWebSearchCaches(): void {
  SEARCH_CACHE.clear();
  GEMINI_SEARCH_BACKEND_CACHE.clear();
}
