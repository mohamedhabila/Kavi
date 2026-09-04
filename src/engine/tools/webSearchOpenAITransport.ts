import type { LlmProviderConfig } from '../../types/provider';
import { DEFAULT_OPENAI_BASE_URL, KNOWN_PROVIDERS } from '../../constants/api';
import { resolveProviderFamily } from '../../services/llm/catalog/providerFamilies';
import { type ToolProviderContextInput, resolveToolProviderContext } from './toolProviderContext';

const OPENAI_PRESET_DEFAULT_MODEL =
  KNOWN_PROVIDERS.find((preset) => preset.name === 'OpenAI')?.defaultModel || 'gpt-5.4-mini';

export type OpenAISearchTransport = {
  /** The resolved provider, with `apiKey` and `model` already filled in for this search. */
  provider: LlmProviderConfig;
  model: string;
};

function isOpenAIProvider(
  provider: LlmProviderConfig | null | undefined,
): provider is LlmProviderConfig {
  return Boolean(provider) && resolveProviderFamily(provider as LlmProviderConfig) === 'openai';
}

/**
 * Resolves the enabled OpenAI provider to search with, preferring the conversation-bound
 * provider/model context over any other enabled OpenAI provider. There is no dedicated
 * secure-storage key for OpenAI search — the only key source is the user's own OpenAI LLM
 * provider, hydrated the same way a chat request would hydrate it.
 */
export async function resolveOpenAISearchTransport(params: {
  context?: ToolProviderContextInput;
  fallbackApiKey?: string | null;
}): Promise<OpenAISearchTransport | null> {
  const resolvedContext = await resolveToolProviderContext(params.context);
  const candidateProviders = [
    isOpenAIProvider(resolvedContext.provider) ? resolvedContext.provider : null,
    ...resolvedContext.allProviders.filter(isOpenAIProvider),
  ].filter((provider): provider is LlmProviderConfig => Boolean(provider));

  const activeProvider =
    candidateProviders.find((provider) => (provider.apiKey || '').trim().length > 0) ??
    candidateProviders[0] ??
    null;

  const fallbackApiKey =
    typeof params.fallbackApiKey === 'string' && params.fallbackApiKey.trim()
      ? params.fallbackApiKey.trim()
      : undefined;
  const apiKey = (activeProvider?.apiKey || '').trim() || fallbackApiKey;
  if (!apiKey) {
    return null;
  }

  const model = (activeProvider?.model || '').trim() || OPENAI_PRESET_DEFAULT_MODEL;
  const provider: LlmProviderConfig = activeProvider
    ? { ...activeProvider, apiKey, model }
    : {
        id: 'openai-search-fallback',
        name: 'OpenAI',
        providerFamily: 'openai',
        baseUrl: DEFAULT_OPENAI_BASE_URL,
        apiKey,
        model,
        enabled: true,
      };

  return { provider, model };
}
