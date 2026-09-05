import type { LlmProviderConfig } from '../../types/provider';
import { KNOWN_PROVIDERS } from '../../constants/api';
import { resolveProviderFamily } from '../../services/llm/catalog/providerFamilies';
import { type ToolProviderContextInput, resolveToolProviderContext } from './toolProviderContext';

const OPENROUTER_PRESET = KNOWN_PROVIDERS.find((preset) => preset.name === 'OpenRouter');
const OPENROUTER_DEFAULT_BASE_URL = OPENROUTER_PRESET?.baseUrl || 'https://openrouter.ai/api/v1';
const OPENROUTER_PRESET_DEFAULT_MODEL = OPENROUTER_PRESET?.defaultModel || 'openai/gpt-5.4';

export type OpenRouterSearchTransport = {
  /** The resolved provider, with `apiKey` and `model` already filled in for this search. */
  provider: LlmProviderConfig;
  model: string;
};

function isOpenRouterProvider(
  provider: LlmProviderConfig | null | undefined,
): provider is LlmProviderConfig {
  return Boolean(provider) && resolveProviderFamily(provider as LlmProviderConfig) === 'openrouter';
}

/**
 * Resolves the enabled OpenRouter provider to search with, preferring the
 * conversation-bound provider/model context over any other enabled OpenRouter provider.
 * There is no dedicated secure-storage key for OpenRouter search — the only key source
 * is the user's own OpenRouter LLM provider, hydrated the same way a chat request would
 * hydrate it (mirrors `resolveOpenAISearchTransport`).
 */
export async function resolveOpenRouterSearchTransport(params: {
  context?: ToolProviderContextInput;
  fallbackApiKey?: string | null;
}): Promise<OpenRouterSearchTransport | null> {
  const resolvedContext = await resolveToolProviderContext(params.context);
  const candidateProviders = [
    isOpenRouterProvider(resolvedContext.provider) ? resolvedContext.provider : null,
    ...resolvedContext.allProviders.filter(isOpenRouterProvider),
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

  const model = (activeProvider?.model || '').trim() || OPENROUTER_PRESET_DEFAULT_MODEL;
  const provider: LlmProviderConfig = activeProvider
    ? { ...activeProvider, apiKey, model }
    : {
        id: 'openrouter-search-fallback',
        name: 'OpenRouter',
        providerFamily: 'openrouter',
        baseUrl: OPENROUTER_DEFAULT_BASE_URL,
        apiKey,
        model,
        enabled: true,
      };

  return { provider, model };
}
