import type { LlmProviderConfig, LlmProviderProtocol } from '../../../types/provider';
import { isVertexOpenAiCompatibleBaseUrl } from '../../../constants/api';
import { isOnDeviceLlmProvider } from '../../localLlm/provider';
import { resolveProviderFamily } from './providerFamilies';

export type ProviderTransport = 'anthropic' | 'gemini' | 'openai' | 'compatible' | 'local';

export interface ProviderRouting {
  family: ReturnType<typeof resolveProviderFamily>;
  protocol: Exclude<LlmProviderProtocol, 'auto'>;
  transport: ProviderTransport;
}

function normalizePath(baseUrl?: string): string {
  const trimmed = (baseUrl || '').trim();
  if (!trimmed) {
    return '';
  }

  try {
    return new URL(trimmed).pathname.toLowerCase();
  } catch {
    const parts = trimmed.replace(/^https?:\/\//i, '').split('/');
    return parts.length > 1 ? `/${parts.slice(1).join('/')}`.toLowerCase() : '';
  }
}

export function resolveProviderProtocol(
  provider: Pick<
    LlmProviderConfig,
    'kind' | 'local' | 'name' | 'baseUrl' | 'protocol' | 'providerFamily' | 'capabilityHints'
  >,
): Exclude<LlmProviderProtocol, 'auto'> {
  if (isOnDeviceLlmProvider(provider)) {
    return 'local';
  }

  const explicitProtocol = provider.protocol;
  if (explicitProtocol && explicitProtocol !== 'auto') {
    return explicitProtocol;
  }

  const preferredProtocol = provider.capabilityHints?.preferredProtocol;
  if (preferredProtocol) {
    return preferredProtocol;
  }

  const family = resolveProviderFamily(provider);
  const path = normalizePath(provider.baseUrl);

  if (provider.capabilityHints?.supportsAnthropicMessages || path.includes('/anthropic')) {
    return 'anthropic-messages';
  }

  if (family === 'gemini' && !isVertexOpenAiCompatibleBaseUrl(provider.baseUrl)) {
    return 'gemini-native';
  }

  if (family === 'anthropic') {
    return 'anthropic-messages';
  }

  if (family === 'openai' || provider.capabilityHints?.supportsResponsesApi) {
    return 'openai-responses';
  }

  return 'openai-chat';
}

export function resolveProviderTransport(
  provider: Pick<
    LlmProviderConfig,
    'kind' | 'local' | 'name' | 'baseUrl' | 'protocol' | 'providerFamily' | 'capabilityHints'
  >,
): ProviderTransport {
  const protocol = resolveProviderProtocol(provider);

  switch (protocol) {
    case 'local':
      return 'local';
    case 'anthropic-messages':
      return 'anthropic';
    case 'gemini-native':
      return 'gemini';
    case 'openai-responses':
      return 'openai';
    case 'openai-chat':
    default:
      return 'compatible';
  }
}

export function resolveProviderRouting(
  provider: Pick<
    LlmProviderConfig,
    'kind' | 'local' | 'name' | 'baseUrl' | 'protocol' | 'providerFamily' | 'capabilityHints'
  >,
): ProviderRouting {
  const family = resolveProviderFamily(provider);
  const protocol = resolveProviderProtocol(provider);
  return {
    family,
    protocol,
    transport: resolveProviderTransport(provider),
  };
}
