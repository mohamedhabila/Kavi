import type { LlmProviderConfig } from '../../../types/provider';
import type { ModelCapabilities } from '../../../types/tool';
import { inferModelCapabilities } from '../../../constants/api';
import { getSelectableLocalLlmModels } from '../../localLlm/modelArtifacts';
import { isOnDeviceLlmProvider } from '../../localLlm/provider';
import type { ModelsWithCapabilities } from '../support/contracts';
import type { ProviderTransport } from './providerProtocols';

type DiscoveredModel = Readonly<{ model: string; capabilities: ModelCapabilities }>;

function declaredStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    return null;
  }
  return value.map((entry) => entry.trim().toLowerCase()).filter(Boolean);
}

function resolveDiscoveredModelCapabilities(entry: unknown, model: string): ModelCapabilities {
  const inferred = inferModelCapabilities(model);
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return inferred;
  const candidate = entry as Record<string, unknown>;
  const architecture =
    candidate.architecture &&
    typeof candidate.architecture === 'object' &&
    !Array.isArray(candidate.architecture)
      ? (candidate.architecture as Record<string, unknown>)
      : null;
  const inputModalities = declaredStringArray(architecture?.input_modalities);
  const supportedParameters = declaredStringArray(candidate.supported_parameters);

  return {
    vision: inputModalities ? inputModalities.includes('image') : inferred.vision,
    tools: supportedParameters ? supportedParameters.includes('tools') : inferred.tools,
    fileInput: inputModalities ? inputModalities.includes('file') : inferred.fileInput,
  };
}

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
      const candidateData = Array.isArray(json) ? json : (json?.data ?? json?.models ?? []);
      const data: unknown[] = Array.isArray(candidateData) ? candidateData : [];

      const discoveredModels = data
        .map((entry: any): DiscoveredModel | undefined => {
          if (typeof entry === 'string') {
            const model = entry.replace(/^models\//, '');
            return { model, capabilities: inferModelCapabilities(model) };
          }

          const id =
            typeof entry?.id === 'string'
              ? entry.id
              : typeof entry?.name === 'string'
                ? entry.name
                : undefined;
          if (typeof id !== 'string') return undefined;
          const model = id.replace(/^models\//, '');
          return { model, capabilities: resolveDiscoveredModelCapabilities(entry, model) };
        })
        .filter((entry: DiscoveredModel | undefined): entry is DiscoveredModel =>
          Boolean(entry?.model),
        )
        .sort((left, right) => left.model.localeCompare(right.model));

      for (const entry of discoveredModels) {
        capabilities[entry.model] = entry.capabilities;
      }

      return { models: discoveredModels.map((entry) => entry.model), capabilities };
    } catch {
      continue;
    }
  }

  return { models: [], capabilities };
}
