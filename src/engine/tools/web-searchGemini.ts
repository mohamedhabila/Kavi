import { fetchWithoutCookies } from './webSearchHttp';
import type { ToolProviderContextInput } from './toolProviderContext';
import { extractGeminiGroundingResult } from './webSearchGeminiGrounding';
import {
  buildGeminiSearchTools,
  buildGeminiSearchUrl,
  describeGeminiErrorBody,
  resolveGeminiSearchTransport,
} from './webSearchGeminiTransport';

export async function searchGemini(params: {
  query: string;
  count: number;
  apiKey: string;
  context?: ToolProviderContextInput;
  signal?: AbortSignal;
}): Promise<Record<string, unknown>> {
  const transport = await resolveGeminiSearchTransport({
    context: params.context,
    fallbackApiKey: params.apiKey,
  });
  if (!transport) {
    throw new Error('Gemini search is not configured.');
  }

  const response = await fetchWithoutCookies(
    buildGeminiSearchUrl(transport.baseUrl, transport.model),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': transport.apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: params.query }],
          },
        ],
        tools: buildGeminiSearchTools(transport.baseUrl),
      }),
      signal: params.signal,
    },
  );

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    const detail = describeGeminiErrorBody(bodyText);
    throw new Error(
      `Gemini search failed: HTTP ${response.status}${detail ? ` ${detail}` : ''}`,
    );
  }

  const data = await response.json();
  const groundingResult = await extractGeminiGroundingResult({
    data,
    count: params.count,
    signal: params.signal,
  });

  return {
    provider: 'gemini',
    model: transport.model,
    query: params.query,
    results: groundingResult.results,
  };
}
