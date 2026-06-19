import type { LlmProviderConfig } from '../../../types/provider';
import type { ModelCapabilities } from '../../../types/tool';
import { inferModelCapabilities } from '../../../constants/api';
import { getSelectableLocalLlmModels } from '../../localLlm/modelArtifacts';
import { isOnDeviceLlmProvider } from '../../localLlm/provider';
import type { ModelsWithCapabilities } from '../support/contracts';
import type { ProviderTransport } from './providerProtocols';

export async function fetchProviderModels(args: {
  provider: {
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    model: string;
    enabled: boolean;
    availableModels?: string[];
    modelCapabilities?: Record<string, ModelCapabilities>;
    kind?: LlmProviderConfig['kind'];
    local?: LlmProviderConfig['local'];
  };
  baseUrl: string;
  headers: Record<string, string>;
  transport: ProviderTransport;
  createTimeoutSignal: (ms: number) => AbortSignal;
  performFetch: (url: string, init: RequestInit) => Promise<Response>;
}): Promise<ModelsWithCapabilities> {
  if (isOnDeviceLlmProvider(args.provider)) {
    const models = getSelectableLocalLlmModels(args.provider);
    const capabilities = Object.fromEntries(
      models.map((model) => [
        model,
        args.provider.modelCapabilities?.[model] || inferModelCapabilities(model),
      ]),
    );
    return { models, capabilities };
  }

  const capabilities: Record<string, ModelCapabilities> = {};

  if (args.transport === 'anthropic') {
    const models = ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5'];
    for (const model of models) {
      capabilities[model] = { vision: true, tools: true, fileInput: true };
    }
    return { models, capabilities };
  }

  const urls =
    args.transport === 'gemini'
      ? [`${args.baseUrl}/models`]
      : [`${args.baseUrl}/models`, `${args.baseUrl.replace(/\/v\d+$/i, '')}/v1/models`];

  for (const url of urls) {
    try {
      const response = await args.performFetch(url, {
        headers: args.headers,
        signal: args.createTimeoutSignal(10000),
      });
      if (!response.ok) continue;

      const json = (await response.json()) as any;
      const data = Array.isArray(json) ? json : (json?.data ?? json?.models ?? []);

      const models = data
        .map((entry: any) => {
          if (typeof entry === 'string') {
            return entry.replace(/^models\//, '');
          }

          const id =
            typeof entry?.id === 'string'
              ? entry.id
              : typeof entry?.name === 'string'
                ? entry.name
                : undefined;
          return typeof id === 'string' ? id.replace(/^models\//, '') : undefined;
        })
        .filter((id: any): id is string => typeof id === 'string' && id.length > 0)
        .sort((left: string, right: string) => left.localeCompare(right));

      for (const model of models) {
        capabilities[model] = inferModelCapabilities(model);
      }

      return { models, capabilities };
    } catch {
      continue;
    }
  }

  return { models: [], capabilities };
}
