import { fetchWithoutCookies } from './webSearchHttp';
import { normalizeWebSearchResults } from '../../services/browser/core/resultShape';

const DEFAULT_KIMI_BASE_URL = 'https://api.moonshot.ai/v1';
const DEFAULT_KIMI_MODEL = 'moonshot-v1-128k';

export async function searchKimi(params: {
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

  const response = await fetchWithoutCookies(`${DEFAULT_KIMI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: params.signal,
  });

  if (!response.ok) {
    throw new Error(`Kimi search failed: HTTP ${response.status}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content || '';
  const searchResults = (data?.search_results || []).map((result: any) => ({
    title: result.title || '',
    url: result.url || '',
    description: result.content || '',
  }));
  const normalized = normalizeWebSearchResults({
    citations: searchResults.map((result: any) => result.url).filter(Boolean),
    results: searchResults,
    fallbackDescription: content,
  });

  return {
    provider: 'kimi',
    query: params.query,
    results: normalized.results.slice(0, params.count),
    citations: normalized.citations.slice(0, params.count),
  };
}
