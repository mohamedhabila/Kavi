import type { LlmProviderConfig } from '../../types/provider';
import { resolveProviderFamily } from '../../services/llm/catalog/providerFamilies';
import { getAnthropicModelGeneration } from '../../services/llm/catalog/providerCapabilities';
import { type ToolProviderContextInput, resolveToolProviderContext } from './toolProviderContext';

const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';
export const DEFAULT_ANTHROPIC_SEARCH_MODEL = 'claude-haiku-4-5';

const ANTHROPIC_WEB_SEARCH_MAX_USES = 3;
/** Adds dynamic filtering; available from Claude 4.6 onward. */
const ANTHROPIC_WEB_SEARCH_TOOL_DYNAMIC_FILTERING = 'web_search_20260209';
/** Basic web search, understood by every Claude generation that supports the tool at all. */
const ANTHROPIC_WEB_SEARCH_TOOL_BASIC = 'web_search_20250305';

export type AnthropicSearchTransport = {
  /** The resolved provider, with `apiKey` and `model` already filled in for this search. */
  provider: LlmProviderConfig;
  model: string;
};

function isAnthropicProvider(
  provider: LlmProviderConfig | null | undefined,
): provider is LlmProviderConfig {
  return Boolean(provider) && resolveProviderFamily(provider as LlmProviderConfig) === 'anthropic';
}

/**
 * Resolves the enabled Anthropic provider to search with, preferring the
 * conversation-bound provider/model context over any other enabled Anthropic provider.
 * There is no dedicated secure-storage key for Anthropic search (unlike Brave/Gemini/etc.)
 * — the only key source is the user's own Anthropic LLM provider, hydrated the same way a
 * chat request would hydrate it (secure storage first, then the plaintext config field).
 */
export async function resolveAnthropicSearchTransport(params: {
  context?: ToolProviderContextInput;
  fallbackApiKey?: string | null;
}): Promise<AnthropicSearchTransport | null> {
  const resolvedContext = await resolveToolProviderContext(params.context);
  const candidateProviders = [
    isAnthropicProvider(resolvedContext.provider) ? resolvedContext.provider : null,
    ...resolvedContext.allProviders.filter(isAnthropicProvider),
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

  const model = (activeProvider?.model || '').trim() || DEFAULT_ANTHROPIC_SEARCH_MODEL;
  const provider: LlmProviderConfig = activeProvider
    ? { ...activeProvider, apiKey, model }
    : {
        id: 'anthropic-search-fallback',
        name: 'Anthropic',
        providerFamily: 'anthropic',
        baseUrl: DEFAULT_ANTHROPIC_BASE_URL,
        apiKey,
        model,
        enabled: true,
      };

  return { provider, model };
}

/** True once `generation` is at or above `major.minor`, regardless of Claude family. */
function isAnthropicModelAtLeast(model: string | undefined, major: number, minor: number): boolean {
  const generation = getAnthropicModelGeneration(model);
  if (!generation) {
    return false;
  }
  return generation.major > major || (generation.major === major && generation.minor >= minor);
}

/**
 * Picks the web search server tool definition for `model`. Claude 4.6 and later default
 * `web_search_20260209` to running searches through code execution (dynamic filtering),
 * which wraps results in a nested `server_tool_use`/`web_search_tool_result` pair with a
 * `caller` field this tool's parser does not need to understand — `allowed_callers:
 * ['direct']` keeps every version on the flat response shape documented for the tool.
 */
export function resolveAnthropicWebSearchTool(model: string): Record<string, unknown> {
  const toolType = isAnthropicModelAtLeast(model, 4, 6)
    ? ANTHROPIC_WEB_SEARCH_TOOL_DYNAMIC_FILTERING
    : ANTHROPIC_WEB_SEARCH_TOOL_BASIC;

  return {
    type: toolType,
    name: 'web_search',
    max_uses: ANTHROPIC_WEB_SEARCH_MAX_USES,
    allowed_callers: ['direct'],
  };
}
