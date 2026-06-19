import { useSettingsStore } from '../../../store/useSettingsStore';
import { getSecure } from '../../storage/SecureStorage';
import type { WebSearchProvider } from '../../../types/tool';

export const SEARCH_PROVIDERS = ['brave', 'perplexity', 'grok', 'kimi', 'gemini'] as const;
export type SearchProvider = Exclude<WebSearchProvider, 'auto'>;

const SEARCH_PROVIDER_KEYS: Record<SearchProvider, string> = {
  brave: 'BRAVE_API_KEY',
  gemini: 'GOOGLE_API_KEY',
  perplexity: 'PERPLEXITY_API_KEY',
  grok: 'XAI_API_KEY',
  kimi: 'KIMI_API_KEY',
};

export async function getSearchProviderApiKey(provider: SearchProvider): Promise<string | null> {
  return getSecure(SEARCH_PROVIDER_KEYS[provider]);
}

export async function detectSearchProvider(): Promise<{
  provider: SearchProvider;
  apiKey: string;
} | null> {
  for (const provider of SEARCH_PROVIDERS) {
    const apiKey = await getSearchProviderApiKey(provider);
    if (apiKey) {
      return { provider, apiKey };
    }
  }

  return null;
}

export function isSupportedSearchProvider(value: string): value is SearchProvider {
  return SEARCH_PROVIDERS.includes(value as SearchProvider);
}

export function resolveConfiguredSearchProvider(): SearchProvider | undefined {
  const preferredProvider = useSettingsStore.getState().webSearchProvider || 'auto';
  if (preferredProvider !== 'auto' && isSupportedSearchProvider(preferredProvider)) {
    return preferredProvider;
  }
  return undefined;
}

export type ResolvedSearchProvider = {
  provider: SearchProvider;
  apiKey: string;
};

export async function resolveSearchProvider(params: {
  resolveGeminiApiKey: () => Promise<string | null | undefined>;
}): Promise<ResolvedSearchProvider | null> {
  let resolved: ResolvedSearchProvider | null = null;
  const requestedProvider = resolveConfiguredSearchProvider();
  if (requestedProvider) {
    const apiKey =
      requestedProvider === 'gemini'
        ? await params.resolveGeminiApiKey()
        : await getSearchProviderApiKey(requestedProvider);
    if (apiKey) {
      resolved = { provider: requestedProvider, apiKey };
    }
  }

  if (!resolved) {
    resolved = await detectSearchProvider();
  }

  if (!resolved) {
    const apiKey = await params.resolveGeminiApiKey();
    if (apiKey) {
      resolved = { provider: 'gemini', apiKey };
    }
  }

  return resolved;
}

export async function dispatchSearchProvider<T>(params: {
  handlers: Record<SearchProvider, () => Promise<T>>;
  provider: SearchProvider;
}): Promise<T> {
  return params.handlers[params.provider]();
}
