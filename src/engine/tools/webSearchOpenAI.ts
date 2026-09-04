import { fetchWithoutCookies } from './webSearchHttp';
import type { ToolProviderContextInput } from './toolProviderContext';
import { normalizeWebSearchResults } from '../../services/browser/core/resultShape';
import { buildProviderHeaders, resolveProviderBaseUrl } from '../../services/llm/core/providerRequest';
import { createProviderRequestError } from '../../services/llm/support/providerErrorClassification';
import { withTimeout } from './web-shared';
import { resolveOpenAISearchTransport } from './webSearchOpenAITransport';

const OPENAI_SEARCH_TIMEOUT_MS = 20_000;

type OpenAISearchResultRow = { title: string; url: string; description: string };

type OpenAISearchExtraction = {
  entries: OpenAISearchResultRow[];
  fallbackText: string;
};

/**
 * Parses a Responses API response for the `web_search` tool. `output` mixes
 * `web_search_call` items (the search itself, no citations) with `message` items whose
 * `content` parts carry `annotations` of type `url_citation` (`url`, `title`,
 * `start_index`, `end_index`) pointing at the sources used in that part's text.
 */
function extractOpenAISearchResponse(data: any): OpenAISearchExtraction {
  const output: any[] = Array.isArray(data?.output) ? data.output : [];
  const entries: OpenAISearchResultRow[] = [];
  const seenUrls = new Set<string>();
  const textParts: string[] = [];

  for (const item of output) {
    if (item?.type !== 'message') {
      continue;
    }
    for (const part of Array.isArray(item?.content) ? item.content : []) {
      if (typeof part?.text !== 'string') {
        continue;
      }
      if (part.text) {
        textParts.push(part.text);
      }
      for (const annotation of Array.isArray(part?.annotations) ? part.annotations : []) {
        if (annotation?.type !== 'url_citation') {
          continue;
        }
        const url = typeof annotation?.url === 'string' ? annotation.url : '';
        if (!url || seenUrls.has(url)) {
          continue;
        }
        seenUrls.add(url);
        entries.push({
          title: typeof annotation?.title === 'string' ? annotation.title : '',
          url,
          description: '',
        });
      }
    }
  }

  if (textParts.length === 0 && typeof data?.output_text === 'string' && data.output_text) {
    textParts.push(data.output_text);
  }

  return { entries, fallbackText: textParts.join(' ').trim() };
}

export async function searchOpenAI(params: {
  query: string;
  count: number;
  apiKey: string;
  context?: ToolProviderContextInput;
  signal?: AbortSignal;
}): Promise<Record<string, unknown>> {
  const transport = await resolveOpenAISearchTransport({
    context: params.context,
    fallbackApiKey: params.apiKey,
  });
  if (!transport) {
    throw new Error('OpenAI search is not configured.');
  }

  const baseUrl = resolveProviderBaseUrl(transport.provider);
  const headers = buildProviderHeaders(transport.provider);
  const timeout = withTimeout(params.signal, OPENAI_SEARCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetchWithoutCookies(`${baseUrl}/responses`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: transport.model,
        tools: [{ type: 'web_search' }],
        input: `Search the web for "${params.query}" and list the most relevant results.`,
      }),
      signal: timeout.signal,
    });
  } finally {
    timeout.dispose();
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw createProviderRequestError({
      providerFamily: 'openai',
      status: response.status,
      bodyText,
    });
  }

  const data = await response.json();
  const extraction = extractOpenAISearchResponse(data);

  const normalized = normalizeWebSearchResults({
    results: extraction.entries,
    citations: extraction.entries.map((entry) => entry.url),
    fallbackDescription: extraction.fallbackText,
  });

  return {
    provider: 'openai',
    model: transport.model,
    query: params.query,
    results: normalized.results.slice(0, params.count),
    citations: normalized.citations.slice(0, params.count),
  };
}
