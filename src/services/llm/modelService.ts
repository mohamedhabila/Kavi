import type { LlmProviderConfig } from '../../types/provider';
import { createTimeoutSignal } from '../../utils/runtime';
import { fetchProviderModels } from './catalog/modelDiscovery';
import { resolveProviderTransport } from './catalog/providerProtocols';
import { buildProviderHeaders, resolveProviderBaseUrl } from './core/providerRequest';
import type { LlmPerformFetch } from './core/fetchTransport';
import type { ModelsWithCapabilities } from './support/contracts';

export function fetchLlmProviderModels(params: {
  provider: LlmProviderConfig;
  performFetch: LlmPerformFetch;
}): Promise<ModelsWithCapabilities> {
  return fetchProviderModels({
    provider: params.provider,
    baseUrl: resolveProviderBaseUrl(params.provider),
    headers: buildProviderHeaders(params.provider),
    transport: resolveProviderTransport(params.provider),
    createTimeoutSignal,
    performFetch: (url, init) => params.performFetch(url, init),
  });
}
