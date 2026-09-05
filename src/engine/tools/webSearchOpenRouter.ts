import { fetchWithoutCookies } from './webSearchHttp';
import type { ToolProviderContextInput } from './toolProviderContext';
import { normalizeWebSearchResults } from '../../services/browser/core/resultShape';
import { buildProviderHeaders, resolveProviderBaseUrl } from '../../services/llm/core/providerRequest';
import { createProviderRequestError } from '../../services/llm/support/providerErrorClassification';
import { withTimeout } from './web-shared';
import { resolveOpenRouterSearchTransport } from './webSearchOpenRouterTransport';

const OPENROUTER_SEARCH_TIMEOUT_MS = 20_000;

type OpenRouterSearchResultRow = { title: string; url: string; description: string };

type OpenRouterSearchExtraction = {
  entries: OpenRouterSearchResultRow[];
  fallbackText: string;
};

/**
 * Parses a chat completions response from OpenRouter's `web` plugin
 * (https://openrouter.ai/docs/features/web-search, verified 2026-09-05). Citations
 * arrive as `message.annotations[]` entries of type `url_citation`, each nesting its
 * fields under a `url_citation` object (`url`, `title`, `content`, `start_index`,
 * `end_index`) — unlike OpenAI's Responses API, which puts `url`/`title` directly on
 * the annotation.
 */
function extractOpenRouterSearchResponse(data: any): OpenRouterSearchExtraction {
  const message = data?.choices?.[0]?.message;
  const annotations: any[] = Array.isArray(message?.annotations) ? message.annotations : [];
  const entries: OpenRouterSearchResultRow[] = [];
  const seenUrls = new Set<string>();

  for (const annotation of annotations) {
    if (annotation?.type !== 'url_citation') {
      continue;
    }
    const citation = annotation?.url_citation;
    const url = typeof citation?.url === 'string' ? citation.url : '';
    if (!url || seenUrls.has(url)) {
      continue;
    }
    seenUrls.add(url);
    entries.push({
      title: typeof citation?.title === 'string' ? citation.title : '',
      url,
      description: typeof citation?.content === 'string' ? citation.content : '',
    });
  }

  const fallbackText = typeof message?.content === 'string' ? message.content.trim() : '';
  return { entries, fallbackText };
}

export async function searchOpenRouter(params: {
  query: string;
  count: number;
  apiKey: string;
  context?: ToolProviderContextInput;
  signal?: AbortSignal;
}): Promise<Record<string, unknown>> {
  const transport = await resolveOpenRouterSearchTransport({
    context: params.context,
    fallbackApiKey: params.apiKey,
  });
  if (!transport) {
    throw new Error('OpenRouter search is not configured.');
  }

  const baseUrl = resolveProviderBaseUrl(transport.provider);
  const headers = buildProviderHeaders(transport.provider);
  const timeout = withTimeout(params.signal, OPENROUTER_SEARCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetchWithoutCookies(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: transport.model,
        plugins: [{ id: 'web' }],
        messages: [
          {
            role: 'user',
            content: `Search the web for the most relevant results for: "${params.query}"`,
          },
        ],
      }),
      signal: timeout.signal,
    });
  } finally {
    timeout.dispose();
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    // `ProviderRequestError`'s classification only recognizes 'anthropic' | 'openai' |
    // 'gemini'. OpenRouter's chat/completions error body follows the same
    // `{ error: { type, code, message } }` shape as OpenAI's, so 'openai' classifies it
    // correctly without widening that shared type.
    throw createProviderRequestError({
      providerFamily: 'openai',
      status: response.status,
      bodyText,
    });
  }

  const data = await response.json();
  const extraction = extractOpenRouterSearchResponse(data);

  const normalized = normalizeWebSearchResults({
    results: extraction.entries,
    citations: extraction.entries.map((entry) => entry.url),
    fallbackDescription: extraction.fallbackText,
  });

  return {
    provider: 'openrouter',
    model: transport.model,
    query: params.query,
    results: normalized.results.slice(0, params.count),
    citations: normalized.citations.slice(0, params.count),
  };
}
