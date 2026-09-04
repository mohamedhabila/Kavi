import { fetchWithoutCookies } from './webSearchHttp';
import type { ToolProviderContextInput } from './toolProviderContext';
import { normalizeWebSearchResults } from '../../services/browser/core/resultShape';
import { buildProviderHeaders, resolveProviderBaseUrl } from '../../services/llm/core/providerRequest';
import { createProviderRequestError } from '../../services/llm/support/providerErrorClassification';
import { createLogger } from '../../utils/logger';
import { withTimeout } from './web-shared';
import {
  resolveAnthropicSearchTransport,
  resolveAnthropicWebSearchTool,
} from './webSearchAnthropicTransport';

const logger = createLogger('WebSearchAnthropic');

const ANTHROPIC_SEARCH_TIMEOUT_MS = 20_000;
const ANTHROPIC_SEARCH_MAX_TOKENS = 1024;

type AnthropicSearchResultRow = { title: string; url: string; description: string };

type AnthropicSearchExtraction = {
  entries: AnthropicSearchResultRow[];
  fallbackText: string;
  refusalReason?: string;
};

/**
 * Parses a Claude Messages API response for the web search server tool. `content` mixes
 * plain `text` blocks (which may carry `citations` with `cited_text`/`url`/`title`) and
 * `web_search_tool_result` blocks, whose own `content` is either an array of
 * `web_search_result` objects (success) or a single object carrying `error_code`
 * (failure) — the two shapes are disambiguated by `Array.isArray`, not by any field.
 */
function extractAnthropicSearchResponse(data: any): AnthropicSearchExtraction {
  const content: any[] = Array.isArray(data?.content) ? data.content : [];
  const citationTextByUrl = new Map<string, string>();
  const rows: Array<{ title: string; url: string; pageAge: string }> = [];
  const textParts: string[] = [];
  let refusalReason: string | undefined;

  for (const block of content) {
    if (block?.type === 'text') {
      if (typeof block.text === 'string' && block.text) {
        textParts.push(block.text);
      }
      for (const citation of Array.isArray(block?.citations) ? block.citations : []) {
        const url = typeof citation?.url === 'string' ? citation.url : undefined;
        const citedText = typeof citation?.cited_text === 'string' ? citation.cited_text : undefined;
        if (url && citedText && !citationTextByUrl.has(url)) {
          citationTextByUrl.set(url, citedText);
        }
      }
      continue;
    }

    if (block?.type !== 'web_search_tool_result') {
      continue;
    }

    const resultContent = block?.content;
    if (Array.isArray(resultContent)) {
      for (const item of resultContent) {
        if (item?.type !== 'web_search_result') {
          continue;
        }
        const url = typeof item?.url === 'string' ? item.url : '';
        if (!url) {
          continue;
        }
        rows.push({
          title: typeof item?.title === 'string' ? item.title : '',
          url,
          pageAge: typeof item?.page_age === 'string' ? item.page_age : '',
        });
      }
    } else if (resultContent && typeof resultContent === 'object' && typeof resultContent.error_code === 'string') {
      refusalReason = resultContent.error_code;
    }
  }

  const entries = rows.map((row) => ({
    title: row.title,
    url: row.url,
    description: citationTextByUrl.get(row.url) || (row.pageAge ? `Last updated ${row.pageAge}` : ''),
  }));

  return { entries, fallbackText: textParts.join(' ').trim(), refusalReason };
}

export async function searchAnthropic(params: {
  query: string;
  count: number;
  apiKey: string;
  context?: ToolProviderContextInput;
  signal?: AbortSignal;
}): Promise<Record<string, unknown>> {
  const transport = await resolveAnthropicSearchTransport({
    context: params.context,
    fallbackApiKey: params.apiKey,
  });
  if (!transport) {
    throw new Error('Anthropic search is not configured.');
  }

  const baseUrl = resolveProviderBaseUrl(transport.provider);
  const headers = buildProviderHeaders(transport.provider);
  const timeout = withTimeout(params.signal, ANTHROPIC_SEARCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetchWithoutCookies(`${baseUrl}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: transport.model,
        max_tokens: ANTHROPIC_SEARCH_MAX_TOKENS,
        messages: [
          {
            role: 'user',
            content: `Search the web for "${params.query}" and list the most relevant results.`,
          },
        ],
        tools: [resolveAnthropicWebSearchTool(transport.model)],
      }),
      signal: timeout.signal,
    });
  } finally {
    timeout.dispose();
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw createProviderRequestError({
      providerFamily: 'anthropic',
      status: response.status,
      bodyText,
    });
  }

  const data = await response.json();
  const extraction = extractAnthropicSearchResponse(data);

  if (extraction.entries.length === 0 && extraction.refusalReason) {
    logger.warn('web search returned an error result', {
      errorCode: extraction.refusalReason,
      query: params.query,
    });
    return {
      provider: 'anthropic',
      model: transport.model,
      query: params.query,
      results: [],
      citations: [],
      reason: `Anthropic web search returned no results (${extraction.refusalReason}).`,
    };
  }

  const normalized = normalizeWebSearchResults({
    results: extraction.entries,
    citations: extraction.entries.map((entry) => entry.url),
    fallbackDescription: extraction.fallbackText,
  });

  return {
    provider: 'anthropic',
    model: transport.model,
    query: params.query,
    results: normalized.results.slice(0, params.count),
    citations: normalized.citations.slice(0, params.count),
  };
}
