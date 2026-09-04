import type { LlmProviderConfig } from '../../../types/provider';
import type { ModelCapabilities } from '../../../types/tool';
import { inferModelCapabilities } from '../../../constants/api';
import { createLogger } from '../../../utils/logger';
import { getSelectableLocalLlmModels } from '../../localLlm/modelArtifacts';
import { isOnDeviceLlmProvider } from '../../localLlm/provider';
import type { ModelsWithCapabilities } from '../support/contracts';
import type { ProviderTransport } from './providerProtocols';

import {
  readAdvertisedContextWindow,
  recordProviderContextWindow,
} from '../../context/providerContextWindows';

const logger = createLogger('llm.modelDiscovery');

/** Static fallback used only when live Anthropic discovery fails outright. */
const ANTHROPIC_FALLBACK_MODELS = [
  'claude-opus-5',
  'claude-fable-5-1',
  'claude-sonnet-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
];

/** Anthropic Models API pages are capped well below this; guards against a runaway loop. */
const MAX_ANTHROPIC_MODEL_PAGES = 20;
const ANTHROPIC_DISCOVERY_TIMEOUT_MS = 10000;

type DiscoveredModel = Readonly<{
  model: string;
  capabilities: ModelCapabilities;
  contextWindow?: number;
}>;

function declaredStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    return null;
  }
  return value.map((entry) => entry.trim().toLowerCase()).filter(Boolean);
}

function resolveAnthropicModelCapabilities(entry: unknown, model: string): ModelCapabilities {
  const inferred = inferModelCapabilities(model);
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return inferred;
  const candidate = entry as Record<string, unknown>;

  // Anthropic's `capabilities` field may arrive as an array of capability strings
  // (e.g. ["vision", "tool_use"]) or as an object of boolean flags — accept both.
  const capabilities = candidate.capabilities;
  const capabilityList = declaredStringArray(capabilities);
  if (capabilityList) {
    return {
      vision: capabilityList.some((cap) => cap.includes('vision') || cap.includes('image')),
      tools: capabilityList.some((cap) => cap.includes('tool')),
      fileInput: capabilityList.some((cap) => cap.includes('file') || cap.includes('document')),
    };
  }

  if (capabilities && typeof capabilities === 'object' && !Array.isArray(capabilities)) {
    const flags = capabilities as Record<string, unknown>;
    return {
      vision: typeof flags.vision === 'boolean' ? flags.vision : inferred.vision,
      tools:
        typeof flags.tool_use === 'boolean'
          ? flags.tool_use
          : typeof flags.tools === 'boolean'
            ? flags.tools
            : inferred.tools,
      fileInput:
        typeof flags.file_input === 'boolean'
          ? flags.file_input
          : typeof flags.fileInput === 'boolean'
            ? flags.fileInput
            : inferred.fileInput,
    };
  }

  return inferred;
}

async function fetchAnthropicModelPage(args: {
  baseUrl: string;
  headers: Record<string, string>;
  createTimeoutSignal: (ms: number) => AbortSignal;
  performFetch: (url: string, init: RequestInit) => Promise<Response>;
  afterId?: string;
}): Promise<{ data: unknown[]; hasMore: boolean; lastId?: string }> {
  const url = new URL(`${args.baseUrl.replace(/\/+$/, '')}/models`);
  url.searchParams.set('limit', '100');
  if (args.afterId) {
    url.searchParams.set('after_id', args.afterId);
  }

  const response = await args.performFetch(url.toString(), {
    method: 'GET',
    headers: args.headers,
    signal: args.createTimeoutSignal(ANTHROPIC_DISCOVERY_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Anthropic model discovery failed with status ${response.status}`);
  }

  const json = (await response.json()) as any;
  const data: unknown[] = Array.isArray(json?.data) ? json.data : [];
  const hasMore = json?.has_more === true;
  const lastId = typeof json?.last_id === 'string' ? json.last_id : undefined;
  return { data, hasMore, lastId };
}

/**
 * Live Anthropic Models API discovery (`GET /v1/models`, paginated via
 * `has_more`/`last_id`). Falls back to the static catalog only when the request
 * itself fails — a successful-but-empty response is trusted as-is.
 */
async function discoverAnthropicModels(args: {
  baseUrl: string;
  headers: Record<string, string>;
  createTimeoutSignal: (ms: number) => AbortSignal;
  performFetch: (url: string, init: RequestInit) => Promise<Response>;
}): Promise<ModelsWithCapabilities> {
  const capabilities: Record<string, ModelCapabilities> = {};
  const contextWindows: Record<string, number> = {};
  const models: string[] = [];

  try {
    let afterId: string | undefined;
    for (let page = 0; page < MAX_ANTHROPIC_MODEL_PAGES; page += 1) {
      const { data, hasMore, lastId } = await fetchAnthropicModelPage({
        baseUrl: args.baseUrl,
        headers: args.headers,
        createTimeoutSignal: args.createTimeoutSignal,
        performFetch: args.performFetch,
        afterId,
      });

      for (const entry of data) {
        if (!entry || typeof entry !== 'object') continue;
        const record = entry as Record<string, unknown>;
        const id = typeof record.id === 'string' ? record.id.trim() : '';
        if (!id) continue;

        models.push(id);
        capabilities[id] = resolveAnthropicModelCapabilities(record, id);

        const contextWindow = readAdvertisedContextWindow(record);
        if (contextWindow !== undefined) {
          contextWindows[id] = contextWindow;
          recordProviderContextWindow(id, contextWindow);
        }
      }

      if (!hasMore || !lastId) {
        break;
      }
      afterId = lastId;
    }

    if (models.length === 0) {
      logger.warn('Anthropic model discovery returned no models; using static fallback');
      return anthropicFallbackModels(capabilities, contextWindows);
    }

    return {
      models: models.sort((left, right) => left.localeCompare(right)),
      capabilities,
      contextWindows,
    };
  } catch (error) {
    logger.warn('Anthropic model discovery failed; using static fallback', error);
    return anthropicFallbackModels(capabilities, contextWindows);
  }
}

function anthropicFallbackModels(
  capabilities: Record<string, ModelCapabilities>,
  contextWindows: Record<string, number>,
): ModelsWithCapabilities {
  const mergedCapabilities = { ...capabilities };
  for (const model of ANTHROPIC_FALLBACK_MODELS) {
    if (!mergedCapabilities[model]) {
      mergedCapabilities[model] = { vision: true, tools: true, fileInput: true };
    }
  }
  return { models: [...ANTHROPIC_FALLBACK_MODELS], capabilities: mergedCapabilities, contextWindows };
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
    return { models, capabilities, contextWindows: {} };
  }

  const capabilities: Record<string, ModelCapabilities> = {};
  const contextWindows: Record<string, number> = {};

  if (args.transport === 'anthropic') {
    return discoverAnthropicModels({
      baseUrl: args.baseUrl,
      headers: args.headers,
      createTimeoutSignal: args.createTimeoutSignal,
      performFetch: args.performFetch,
    });
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
          // The provider's own figure beats the static table getContextWindow falls back
          // to, which silently defaults unlisted models to 128k.
          const advertisedContextWindow = readAdvertisedContextWindow(entry);
          if (advertisedContextWindow !== undefined) {
            recordProviderContextWindow(model, advertisedContextWindow);
          }
          return {
            model,
            capabilities: resolveDiscoveredModelCapabilities(entry, model),
            ...(advertisedContextWindow !== undefined
              ? { contextWindow: advertisedContextWindow }
              : {}),
          };
        })
        .filter((entry: DiscoveredModel | undefined): entry is DiscoveredModel =>
          Boolean(entry?.model),
        )
        .sort((left, right) => left.model.localeCompare(right.model));

      for (const entry of discoveredModels) {
        capabilities[entry.model] = entry.capabilities;
        if (entry.contextWindow !== undefined) {
          contextWindows[entry.model] = entry.contextWindow;
        }
      }

      return {
        models: discoveredModels.map((entry) => entry.model),
        capabilities,
        contextWindows,
      };
    } catch {
      continue;
    }
  }

  return { models: [], capabilities, contextWindows };
}
