import { useSettingsStore } from '../../../store/useSettingsStore';
import { getSecure } from '../../storage/SecureStorage';
import { hydrateProviderForRequest } from '../../llm/support/providerSupport';
import { resolveProviderFamily } from '../../llm/catalog/providerFamilies';
import type { WebSearchProvider } from '../../../types/tool';
import type { LlmProviderFamily } from '../../../types/provider';

export const SEARCH_PROVIDERS = [
  'brave',
  'perplexity',
  'grok',
  'kimi',
  'gemini',
  'anthropic',
  'openai',
] as const;
export type SearchProvider = Exclude<WebSearchProvider, 'auto'>;

/**
 * Dedicated secure-storage keys, for providers the user can configure with a search-only
 * API key entered in Settings. `anthropic` and `openai` are deliberately absent — those
 * two are reachable only by reusing an enabled LLM provider's own key (see
 * `resolveSearchProvider`'s `resolveAnthropicApiKey`/`resolveOpenAIApiKey` params), so
 * there is no dedicated key to look up for them.
 */
const SEARCH_PROVIDER_KEYS: Partial<Record<SearchProvider, string>> = {
  brave: 'BRAVE_API_KEY',
  gemini: 'GOOGLE_API_KEY',
  perplexity: 'PERPLEXITY_API_KEY',
  grok: 'XAI_API_KEY',
  kimi: 'KIMI_API_KEY',
};

export async function getSearchProviderApiKey(provider: SearchProvider): Promise<string | null> {
  const storageKey = SEARCH_PROVIDER_KEYS[provider];
  if (!storageKey) {
    return null;
  }
  return getSecure(storageKey);
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

/**
 * LLM provider families that can also serve keyless web search by reusing their own
 * chat/completion API key instead of a dedicated search key.
 */
const LLM_KEY_BACKED_SEARCH_FAMILIES = new Set<LlmProviderFamily>(['gemini', 'anthropic', 'openai']);

/**
 * Whether any enabled LLM provider (Gemini, Anthropic, or OpenAI) can also serve as a
 * keyless web search provider right now — i.e. it has a resolvable API key, whether
 * stored in secure storage against the provider id or held directly on the provider
 * config. Used by `searchProviderReadiness.ts` to keep the synchronous "is search
 * available" snapshot honest: without this, a user who enabled only, say, an Anthropic
 * provider (no dedicated Brave/Perplexity/Grok/Kimi/Google key) would have `web_search`
 * hidden from the tool surface even though `resolveSearchProvider`'s LLM-key fallback
 * below could serve every request.
 */
export async function hasLlmKeyBackedSearchProvider(): Promise<boolean> {
  const candidateProviders = useSettingsStore
    .getState()
    .providers.filter(
      (provider) => provider.enabled && LLM_KEY_BACKED_SEARCH_FAMILIES.has(resolveProviderFamily(provider)),
    );

  for (const provider of candidateProviders) {
    const hydrated = await hydrateProviderForRequest(provider);
    if ((hydrated.apiKey || '').trim()) {
      return true;
    }
  }

  return false;
}

export async function resolveSearchProvider(params: {
  resolveGeminiApiKey: () => Promise<string | null | undefined>;
  resolveAnthropicApiKey: () => Promise<string | null | undefined>;
  resolveOpenAIApiKey: () => Promise<string | null | undefined>;
}): Promise<ResolvedSearchProvider | null> {
  let resolved: ResolvedSearchProvider | null = null;
  const requestedProvider = resolveConfiguredSearchProvider();
  if (requestedProvider) {
    const apiKey =
      requestedProvider === 'gemini'
        ? await params.resolveGeminiApiKey()
        : requestedProvider === 'anthropic'
          ? await params.resolveAnthropicApiKey()
          : requestedProvider === 'openai'
            ? await params.resolveOpenAIApiKey()
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

  if (!resolved) {
    const apiKey = await params.resolveAnthropicApiKey();
    if (apiKey) {
      resolved = { provider: 'anthropic', apiKey };
    }
  }

  if (!resolved) {
    const apiKey = await params.resolveOpenAIApiKey();
    if (apiKey) {
      resolved = { provider: 'openai', apiKey };
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
