import type {
  LlmProviderConfig,
  LlmProviderKind,
  LocalLlmRuntime,
  ModelCapabilities,
} from '../types';
import {
  createDefaultLocalLlmProvider,
  isOnDeviceLlmProvider,
  normalizeLocalLlmProvider,
} from '../services/localLlm/runtime';
import {
  DEFAULT_LOCAL_LLM_MODEL_ID,
  GEMMA_LOCAL_MODEL_CATALOG,
  GEMMA_LOCAL_PROVIDER_NAME,
  getLocalLlmCatalogEntry,
} from '../services/localLlm/catalog';

export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_GEMINI_BASE_URL = 'https://aiplatform.googleapis.com/v1';
export const DEFAULT_GEMINI_AI_STUDIO_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
export const DEFAULT_GEMINI_OPENAI_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta/openai';

const DEFAULT_GEMINI_AI_STUDIO_HOST = 'generativelanguage.googleapis.com';
const DEFAULT_GEMINI_VERTEX_HOST = 'aiplatform.googleapis.com';

interface BaseLlmProviderPreset {
  name: string;
  kind: LlmProviderKind;
  baseUrl: string;
  defaultModel: string;
  availableModels: string[];
  modelCapabilities: Record<string, ModelCapabilities>;
}

export interface RemoteLlmProviderPreset extends BaseLlmProviderPreset {
  kind: 'remote';
}

export interface OnDeviceLlmProviderPreset extends BaseLlmProviderPreset {
  kind: 'on-device';
  localRuntime?: LocalLlmRuntime;
}

export type LlmProviderPreset = RemoteLlmProviderPreset | OnDeviceLlmProviderPreset;

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function buildModelCapabilities(models: string[]): Record<string, ModelCapabilities> {
  return Object.fromEntries(models.map((model) => [model, inferModelCapabilities(model)]));
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(
    new Set(
      values.filter(
        (value): value is string => typeof value === 'string' && value.trim().length > 0,
      ),
    ),
  );
}

function normalizeUrlForComparison(baseUrl?: string): string {
  return trimTrailingSlashes((baseUrl || '').trim()).toLowerCase();
}

function tryParseUrl(baseUrl?: string): URL | null {
  const normalized = trimTrailingSlashes((baseUrl || '').trim());
  if (!normalized) {
    return null;
  }

  try {
    return new URL(normalized);
  } catch {
    return null;
  }
}

function isVertexAiHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return (
    normalized === DEFAULT_GEMINI_VERTEX_HOST ||
    /^[a-z0-9-]+-aiplatform\.googleapis\.com$/i.test(normalized)
  );
}

function normalizeGeminiProviderName(name?: string): string {
  return (name || '').trim().toLowerCase();
}

function isGeminiProviderName(name?: string): boolean {
  return /(^|\b)(google|gemini)(\b|$)/.test(normalizeGeminiProviderName(name));
}

function stripGeminiModelCollectionSuffix(pathname: string): string {
  return pathname.replace(/\/publishers\/[^/]+\/models(?:\/[^/]+)?$/i, '');
}

function stripUrlMetadata(url: URL): void {
  url.hash = '';
  url.search = '';
}

export function isGoogleAiStudioBaseUrl(baseUrl?: string): boolean {
  const parsed = tryParseUrl(baseUrl);
  if (parsed) {
    return parsed.hostname.toLowerCase() === DEFAULT_GEMINI_AI_STUDIO_HOST;
  }

  return /^https:\/\/generativelanguage\.googleapis\.com(?:\/|$)/i.test(
    normalizeUrlForComparison(baseUrl),
  );
}

export function isVertexOpenAiCompatibleBaseUrl(baseUrl?: string): boolean {
  const parsed = tryParseUrl(baseUrl);
  if (parsed) {
    return (
      isVertexAiHostname(parsed.hostname) &&
      /\/endpoints\/openapi$/i.test(trimTrailingSlashes(parsed.pathname || ''))
    );
  }

  return /^https:\/\/(?:[a-z0-9-]+-)?aiplatform\.googleapis\.com\/v[^/]+\/.+\/endpoints\/openapi$/i.test(
    normalizeUrlForComparison(baseUrl),
  );
}

export function isVertexNativeGeminiBaseUrl(baseUrl?: string): boolean {
  const parsed = tryParseUrl(baseUrl);
  if (parsed) {
    return (
      isVertexAiHostname(parsed.hostname) &&
      !/\/endpoints\/openapi$/i.test(trimTrailingSlashes(parsed.pathname || ''))
    );
  }

  const normalized = normalizeUrlForComparison(baseUrl);
  return (
    /^https:\/\/(?:[a-z0-9-]+-)?aiplatform\.googleapis\.com(?:\/|$)/i.test(normalized) &&
    !/\/endpoints\/openapi$/i.test(normalized)
  );
}

export function inferModelCapabilities(model: string): ModelCapabilities {
  const lower = model.toLowerCase();
  return {
    vision: /vision|gpt-|claude-|gemini|pixtral|llama4/i.test(lower),
    tools: !/whisper|dall|embed|tts/i.test(lower),
    fileInput: /gpt-|claude-|gemini|pixtral|llama4/i.test(lower),
  };
}

export function looksLikeGeminiProvider(
  provider: Pick<LlmProviderConfig, 'name' | 'baseUrl'>,
): boolean {
  const configuredBaseUrl = (provider.baseUrl || '').trim();
  if (configuredBaseUrl.length > 0) {
    return (
      isGoogleAiStudioBaseUrl(configuredBaseUrl) || isVertexNativeGeminiBaseUrl(configuredBaseUrl)
    );
  }

  return isGeminiProviderName(provider.name);
}

export function isOnDeviceProviderPreset(
  preset: LlmProviderPreset,
): preset is OnDeviceLlmProviderPreset {
  return preset.kind === 'on-device';
}

export function normalizeGeminiBaseUrl(baseUrl?: string): string {
  const raw =
    trimTrailingSlashes((baseUrl || DEFAULT_GEMINI_BASE_URL).trim()) || DEFAULT_GEMINI_BASE_URL;

  try {
    const url = new URL(raw);
    stripUrlMetadata(url);

    if (url.hostname.toLowerCase() === DEFAULT_GEMINI_AI_STUDIO_HOST) {
      const pathname = trimTrailingSlashes(url.pathname || '');
      if (!pathname || pathname === '/openai') {
        url.pathname = '/v1beta';
      } else if (pathname === '/v1/openai' || pathname === '/v1beta/openai') {
        url.pathname = pathname.replace(/\/openai$/i, '');
      }

      return trimTrailingSlashes(url.toString());
    }

    if (isVertexAiHostname(url.hostname)) {
      const pathname = trimTrailingSlashes(url.pathname || '');
      if (!pathname) {
        url.pathname = '/v1';
      } else if (/\/endpoints\/openapi$/i.test(pathname)) {
        return trimTrailingSlashes(url.toString());
      } else if (/^\/v[^/]+\/publishers\/[^/]+\/models(?:\/[^/]+)?$/i.test(pathname)) {
        url.pathname = stripGeminiModelCollectionSuffix(pathname) || '/v1';
      } else if (
        /^\/v[^/]+\/projects\/[^/]+\/locations\/[^/]+\/publishers\/[^/]+\/models(?:\/[^/]+)?$/i.test(
          pathname,
        )
      ) {
        url.pathname = stripGeminiModelCollectionSuffix(pathname);
      }

      return trimTrailingSlashes(url.toString());
    }

    return trimTrailingSlashes(url.toString());
  } catch {
    if (/^https:\/\/generativelanguage\.googleapis\.com\/?$/i.test(raw)) {
      return DEFAULT_GEMINI_AI_STUDIO_BASE_URL;
    }
    if (/^https:\/\/generativelanguage\.googleapis\.com\/(v1beta|v1)\/openai\/?$/i.test(raw)) {
      return trimTrailingSlashes(raw).replace(/\/openai$/i, '');
    }
    if (/^https:\/\/generativelanguage\.googleapis\.com\/openai\/?$/i.test(raw)) {
      return DEFAULT_GEMINI_AI_STUDIO_BASE_URL;
    }
    if (/^https:\/\/(?:[a-z0-9-]+-)?aiplatform\.googleapis\.com\/?$/i.test(raw)) {
      return DEFAULT_GEMINI_BASE_URL;
    }
    if (
      /^https:\/\/(?:[a-z0-9-]+-)?aiplatform\.googleapis\.com\/v[^/]+\/publishers\/[^/]+\/models(?:\/[^/]+)?\/?$/i.test(
        raw,
      )
    ) {
      return trimTrailingSlashes(raw).replace(/\/publishers\/[^/]+\/models(?:\/[^/]+)?$/i, '');
    }
    if (
      /^https:\/\/(?:[a-z0-9-]+-)?aiplatform\.googleapis\.com\/v[^/]+\/projects\/[^/]+\/locations\/[^/]+\/publishers\/[^/]+\/models(?:\/[^/]+)?\/?$/i.test(
        raw,
      )
    ) {
      return trimTrailingSlashes(raw).replace(/\/publishers\/[^/]+\/models(?:\/[^/]+)?$/i, '');
    }
    return raw;
  }
}

export function normalizeGeminiOpenAiBaseUrl(baseUrl?: string): string {
  const raw =
    trimTrailingSlashes((baseUrl || DEFAULT_GEMINI_OPENAI_BASE_URL).trim()) ||
    DEFAULT_GEMINI_OPENAI_BASE_URL;
  if (isVertexOpenAiCompatibleBaseUrl(raw)) {
    return raw;
  }

  return `${normalizeGeminiBaseUrl(raw || DEFAULT_GEMINI_AI_STUDIO_BASE_URL)}/openai`;
}

export function finalizeProviderConfig(provider: LlmProviderConfig): LlmProviderConfig {
  if (isOnDeviceLlmProvider(provider)) {
    return normalizeLocalLlmProvider(provider);
  }

  const name = provider.name.trim();
  const model = provider.model.trim();
  const rawBaseUrl = (provider.baseUrl || '').trim();
  const baseUrl =
    rawBaseUrl.length === 0 && isGeminiProviderName(name)
      ? DEFAULT_GEMINI_BASE_URL
      : isVertexOpenAiCompatibleBaseUrl(rawBaseUrl)
        ? trimTrailingSlashes(rawBaseUrl)
        : isGoogleAiStudioBaseUrl(rawBaseUrl)
          ? normalizeGeminiOpenAiBaseUrl(rawBaseUrl)
          : isVertexNativeGeminiBaseUrl(rawBaseUrl)
            ? normalizeGeminiBaseUrl(rawBaseUrl)
            : trimTrailingSlashes(rawBaseUrl);
  const availableModels = uniqueStrings([...(provider.availableModels || []), model]);
  const modelCapabilities = {
    ...(provider.modelCapabilities || {}),
  };

  for (const availableModel of availableModels) {
    modelCapabilities[availableModel] =
      modelCapabilities[availableModel] || inferModelCapabilities(availableModel);
  }

  return {
    ...provider,
    name,
    baseUrl,
    model,
    availableModels,
    modelCapabilities,
  };
}

export function buildProviderFromPreset(
  preset: (typeof KNOWN_PROVIDERS)[number],
  overrides: Partial<LlmProviderConfig> & Pick<LlmProviderConfig, 'id'>,
): LlmProviderConfig {
  if (isOnDeviceProviderPreset(preset)) {
    return finalizeProviderConfig({
      ...createDefaultLocalLlmProvider(overrides.id),
      ...(overrides.name ? { name: overrides.name } : {}),
      ...(overrides.model ? { model: overrides.model } : {}),
      ...(overrides.enabled !== undefined ? { enabled: overrides.enabled } : {}),
      ...(overrides.hiddenModels ? { hiddenModels: overrides.hiddenModels } : {}),
      ...(overrides.local
        ? { local: { ...createDefaultLocalLlmProvider(overrides.id).local, ...overrides.local } }
        : {}),
    });
  }

  return finalizeProviderConfig({
    id: overrides.id,
    kind: 'remote',
    name: overrides.name || preset.name,
    baseUrl: overrides.baseUrl || preset.baseUrl,
    apiKey: overrides.apiKey || '',
    model: overrides.model || preset.defaultModel,
    availableModels: overrides.availableModels || [...preset.availableModels],
    modelCapabilities: overrides.modelCapabilities || { ...preset.modelCapabilities },
    hiddenModels: overrides.hiddenModels,
    enabled: overrides.enabled ?? true,
    apiKeyRef: overrides.apiKeyRef,
  });
}

function normalizePresetHost(baseUrl: string): string {
  return baseUrl
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
    .toLowerCase();
}

export function getKnownProviderFallbackModels(provider: LlmProviderConfig): string[] {
  if (isOnDeviceLlmProvider(provider)) {
    return provider.availableModels || [provider.model || DEFAULT_LOCAL_LLM_MODEL_ID];
  }

  const providerHost = normalizePresetHost(provider.baseUrl || '');
  const preset =
    KNOWN_PROVIDERS.find(
      (candidate) =>
        candidate.kind === 'remote' &&
        providerHost.length > 0 &&
        providerHost.includes(normalizePresetHost(candidate.baseUrl)),
    ) ||
    (isGeminiProviderName(provider.name) ||
    isGoogleAiStudioBaseUrl(provider.baseUrl) ||
    isVertexNativeGeminiBaseUrl(provider.baseUrl) ||
    isVertexOpenAiCompatibleBaseUrl(provider.baseUrl)
      ? KNOWN_PROVIDERS.find(
          (candidate) => candidate.name === 'Gemini' && candidate.kind === 'remote',
        )
      : undefined);

  return preset?.availableModels || provider.availableModels || [];
}

export const KNOWN_PROVIDERS = [
  {
    name: 'OpenAI',
    kind: 'remote',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.4',
    availableModels: ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5-mini', 'o4-mini', 'o3'],
    modelCapabilities: buildModelCapabilities([
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5-mini',
      'o4-mini',
      'o3',
    ]),
  },
  {
    name: 'Anthropic',
    kind: 'remote',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-opus-4-7',
    availableModels: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
    modelCapabilities: buildModelCapabilities([
      'claude-opus-4-7',
      'claude-sonnet-4-6',
      'claude-haiku-4-5',
    ]),
  },
  {
    name: 'Gemini',
    kind: 'remote',
    baseUrl: DEFAULT_GEMINI_BASE_URL,
    defaultModel: 'gemini-3.1-pro-preview',
    availableModels: [
      'gemini-3.1-pro-preview',
      'gemini-3-flash-preview',
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
    ],
    modelCapabilities: buildModelCapabilities([
      'gemini-3.1-pro-preview',
      'gemini-3-flash-preview',
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
    ]),
  },
  {
    name: 'OpenRouter',
    kind: 'remote',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-5.4',
    availableModels: [
      'openai/gpt-5.4',
      'openai/gpt-5-mini',
      'anthropic/claude-opus-4-7',
      'anthropic/claude-sonnet-4-6',
      'google/gemini-3.1-pro-preview',
    ],
    modelCapabilities: buildModelCapabilities([
      'openai/gpt-5.4',
      'openai/gpt-5-mini',
      'anthropic/claude-opus-4-7',
      'anthropic/claude-sonnet-4-6',
      'google/gemini-3.1-pro-preview',
    ]),
  },
  {
    name: 'Ollama (local)',
    kind: 'remote',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama4',
    availableModels: ['llama4', 'qwen3', 'gemma3', 'mistral-large-3', 'phi4'],
    modelCapabilities: buildModelCapabilities([
      'llama4',
      'qwen3',
      'gemma3',
      'mistral-large-3',
      'phi4',
    ]),
  },
  {
    name: GEMMA_LOCAL_PROVIDER_NAME,
    kind: 'on-device',
    baseUrl: '',
    defaultModel: DEFAULT_LOCAL_LLM_MODEL_ID,
    availableModels: GEMMA_LOCAL_MODEL_CATALOG.map((entry) => entry.id),
    modelCapabilities: Object.fromEntries(
      GEMMA_LOCAL_MODEL_CATALOG.map((entry) => [entry.id, entry.capabilities]),
    ),
    localRuntime: getLocalLlmCatalogEntry(DEFAULT_LOCAL_LLM_MODEL_ID)?.runtime || 'litert-lm',
  },
] as const satisfies readonly LlmProviderPreset[];
