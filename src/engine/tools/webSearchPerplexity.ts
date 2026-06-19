import { fetchWithoutCookies } from './webSearchHttp';

const PERPLEXITY_SEARCH_ENDPOINT = 'https://api.perplexity.ai/search';

const FRESHNESS_TO_RECENCY: Record<string, string> = {
  pd: 'day',
  pw: 'week',
  pm: 'month',
  py: 'year',
};

export async function searchPerplexity(params: {
  query: string;
  count: number;
  apiKey: string;
  freshness?: string;
  country?: string;
  language?: string;
  signal?: AbortSignal;
}): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = {
    query: params.query,
    max_results: params.count,
  };

  const recency = params.freshness
    ? FRESHNESS_TO_RECENCY[params.freshness] || params.freshness
    : undefined;
  if (recency && ['day', 'week', 'month', 'year'].includes(recency)) {
    body.search_recency_filter = recency;
  }
  if (params.country && params.country !== 'ALL') {
    body.country = params.country.toUpperCase();
  }
  if (params.language) {
    body.search_language_filter = [params.language];
  }

  const response = await fetchWithoutCookies(PERPLEXITY_SEARCH_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: params.signal,
  });

  if (!response.ok) {
    throw new Error(`Perplexity search failed: HTTP ${response.status}`);
  }

  const data = await response.json();
  const results = Array.isArray(data?.results)
    ? data.results
        .map((result: any) => ({
          title: typeof result?.title === 'string' ? result.title : '',
          url: typeof result?.url === 'string' ? result.url : '',
        }))
        .filter((result: { title: string; url: string }) => result.url.trim().length > 0)
    : [];

  return {
    provider: 'perplexity',
    query: params.query,
    results: results.slice(0, params.count),
  };
}
