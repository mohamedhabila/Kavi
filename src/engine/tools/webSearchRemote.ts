import type { ToolProviderContextInput } from './toolProviderContext';
import {
  dispatchSearchProvider,
  type SearchProvider,
} from '../../services/browser/core/providerDispatch';
import { searchBrave } from './webSearchBrave';
import { searchGemini } from './web-searchGemini';
import { searchGrok } from './webSearchGrok';
import { searchKimi } from './webSearchKimi';
import { searchPerplexity } from './webSearchPerplexity';

export async function searchRemoteWebProvider(params: {
  provider: SearchProvider;
  query: string;
  count: number;
  apiKey: string;
  freshness?: string;
  country?: string;
  language?: string;
  context?: ToolProviderContextInput;
  signal?: AbortSignal;
}): Promise<Record<string, unknown>> {
  return dispatchSearchProvider({
    provider: params.provider,
    handlers: {
      brave: () => searchBrave(params),
      gemini: () => searchGemini(params),
      perplexity: () => searchPerplexity(params),
      grok: () => searchGrok(params),
      kimi: () => searchKimi(params),
    },
  });
}
