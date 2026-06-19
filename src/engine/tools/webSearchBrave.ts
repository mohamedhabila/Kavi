import { fetchWithoutCookies } from './webSearchHttp';

const BRAVE_SEARCH_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';
const MAX_SEARCH_COUNT = 5;

const RECENCY_TO_FRESHNESS: Record<string, string> = {
  day: 'pd',
  week: 'pw',
  month: 'pm',
  year: 'py',
};

function resolveBraveFreshness(freshness?: string): string | undefined {
  if (!freshness) {
    return undefined;
  }

  const lower = freshness.trim().toLowerCase();
  if (['pd', 'pw', 'pm', 'py'].includes(lower)) {
    return lower;
  }

  return RECENCY_TO_FRESHNESS[lower];
}

export async function searchBrave(params: {
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
  if (params.language) {
    url.searchParams.set('search_lang', params.language);
  }
  const braveFreshness = resolveBraveFreshness(params.freshness);
  if (braveFreshness) {
    url.searchParams.set('freshness', braveFreshness);
  }

  const response = await fetchWithoutCookies(url.toString(), {
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': params.apiKey,
    },
    signal: params.signal,
  });

  if (!response.ok) {
    throw new Error(`Brave search failed: HTTP ${response.status}`);
  }

  const data = await response.json();
  const results = (data?.web?.results || [])
    .map((result: any) => ({
      title: typeof result?.title === 'string' ? result.title : '',
      url: typeof result?.url === 'string' ? result.url : '',
    }))
    .filter((result: { title: string; url: string }) => result.url.trim().length > 0);

  return {
    provider: 'brave',
    query: params.query,
    results,
  };
}
