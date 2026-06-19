import { fetchWithoutCookies } from './webSearchHttp';
import { normalizeWebSearchResults } from '../../services/browser/core/resultShape';

const XAI_API_ENDPOINT = 'https://api.x.ai/v1/responses';
const DEFAULT_GROK_MODEL = 'grok-4-1-fast';

export async function searchGrok(params: {
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

  const response = await fetchWithoutCookies(XAI_API_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: params.signal,
  });

  if (!response.ok) {
    throw new Error(`Grok search failed: HTTP ${response.status}`);
  }

  const data = await response.json();
  let text = '';
  const citations: string[] = [];

  for (const output of data?.output || []) {
    if (output?.type === 'message') {
      for (const block of output?.content || []) {
        if (block?.type === 'output_text' && typeof block?.text === 'string') {
          text = block.text;
          for (const annotation of block?.annotations || []) {
            if (annotation?.type === 'url_citation' && typeof annotation?.url === 'string') {
              citations.push(annotation.url);
            }
          }
        }
      }
    }
    if (output?.type === 'output_text' && typeof output?.text === 'string') {
      text = output.text;
      for (const annotation of output?.annotations || []) {
        if (annotation?.type === 'url_citation' && typeof annotation?.url === 'string') {
          citations.push(annotation.url);
        }
      }
    }
  }

  if (!text && typeof data?.output_text === 'string') {
    text = data.output_text;
  }
  if (data?.citations) {
    citations.push(...data.citations.filter((citation: any) => typeof citation === 'string'));
  }

  const normalized = normalizeWebSearchResults({
    citations: [...new Set(citations)],
    fallbackDescription: text,
  });

  return {
    provider: 'grok',
    query: params.query,
    results: normalized.results.slice(0, params.count),
    citations: normalized.citations.slice(0, params.count),
  };
}
