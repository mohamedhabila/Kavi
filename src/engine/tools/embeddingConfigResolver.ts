import { isVertexNativeGeminiBaseUrl } from '../../constants/api';
import type { EmbeddingConfig } from '../../types/memory';
import type { LlmProviderConfig } from '../../types/provider';
import { resolveProviderFamily } from '../../services/llm/catalog/providerFamilies';

export function resolveProviderEmbeddingConfig(
  provider: LlmProviderConfig | null | undefined,
): EmbeddingConfig | undefined {
  if (!provider) {
    return undefined;
  }

  const normalizedApiKey = provider.apiKey?.trim() || undefined;
  const normalizedBaseUrl = provider.baseUrl?.trim() || undefined;
  const providerFamily = provider.providerFamily || resolveProviderFamily(provider);

  switch (providerFamily) {
    case 'gemini': {
      const usesVertexExpressBase =
        isVertexNativeGeminiBaseUrl(normalizedBaseUrl) &&
        !/\/projects\/[^/]+\/locations\/[^/]+$/i.test(normalizedBaseUrl || '');
      if (usesVertexExpressBase) {
        return undefined;
      }

      return {
        provider: 'gemini',
        apiKey: normalizedApiKey,
        baseUrl: normalizedBaseUrl,
      };
    }
    case 'openai':
      return {
        provider: 'openai',
        apiKey: normalizedApiKey,
        baseUrl: normalizedBaseUrl,
      };
    case 'mistral':
      return {
        provider: 'mistral',
        apiKey: normalizedApiKey,
      };
    case 'voyage':
      return {
        provider: 'voyage',
        apiKey: normalizedApiKey,
      };
    case 'ollama':
      return {
        provider: 'ollama',
        baseUrl: normalizedBaseUrl?.replace(/\/v1\/?$/i, '').replace(/\/+$/, ''),
      };
    default:
      return undefined;
  }
}
