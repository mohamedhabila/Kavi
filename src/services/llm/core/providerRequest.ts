import type { LlmProviderConfig } from '../../../types/provider';
import {
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_OPENAI_BASE_URL,
  normalizeGeminiBaseUrl,
} from '../../../constants/api';
import { resolveProviderTransport } from '../catalog/providerProtocols';

export function resolveGeminiBaseUrl(provider: Pick<LlmProviderConfig, 'baseUrl'>): string {
  const configuredBaseUrl = (provider.baseUrl || '').trim();
  return normalizeGeminiBaseUrl(configuredBaseUrl || DEFAULT_GEMINI_BASE_URL);
}

export function resolveProviderBaseUrl(
  provider: Pick<
    LlmProviderConfig,
    'kind' | 'local' | 'name' | 'baseUrl' | 'protocol' | 'providerFamily' | 'capabilityHints'
  >,
): string {
  const configuredBaseUrl = (provider.baseUrl || '').trim();
  const fallbackBaseUrl = DEFAULT_OPENAI_BASE_URL;
  if (resolveProviderTransport(provider) === 'gemini') {
    return resolveGeminiBaseUrl(provider);
  }
  const normalizedBaseUrl = (configuredBaseUrl || fallbackBaseUrl).replace(/\/+$/, '');
  return normalizedBaseUrl || fallbackBaseUrl;
}

export function buildProviderHeaders(
  provider: Pick<
    LlmProviderConfig,
    | 'kind'
    | 'local'
    | 'name'
    | 'baseUrl'
    | 'protocol'
    | 'providerFamily'
    | 'capabilityHints'
    | 'apiKey'
  >,
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const apiKey = (provider.apiKey || '').trim();
  const providerTransport = resolveProviderTransport(provider);

  if (providerTransport === 'anthropic') {
    if (apiKey) {
      headers['x-api-key'] = apiKey;
    }
    headers['anthropic-version'] = '2023-06-01';
    return headers;
  }

  if (providerTransport === 'gemini') {
    if (apiKey) {
      headers['x-goog-api-key'] = apiKey;
    }
    return headers;
  }

  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
    headers['x-api-key'] = apiKey;
    headers['api-key'] = apiKey;
  }
  return headers;
}
