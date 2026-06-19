import {
  DEFAULT_GEMINI_BASE_URL,
  isVertexNativeGeminiBaseUrl,
  looksLikeGeminiProvider,
  normalizeGeminiBaseUrl,
} from '../../constants/api';
import { type ToolProviderContextInput, resolveToolProviderContext } from './toolProviderContext';

const DEFAULT_GEMINI_SEARCH_MODEL = 'gemini-3.5-flash';

export type GeminiSearchTransport = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

function normalizeGeminiSearchModelCandidate(model: string | null | undefined): string | undefined {
  if (typeof model !== 'string') {
    return undefined;
  }

  const normalized = model
    .trim()
    .replace(/^google\//i, '')
    .replace(/^models\//i, '')
    .replace(/^publishers\/google\/models\//i, '');
  return /^gemini[-/]/i.test(normalized) ? normalized : undefined;
}

async function resolveGeminiSearchModel(context?: ToolProviderContextInput): Promise<string> {
  const resolvedContext = await resolveToolProviderContext(context);
  const providerCandidates = [resolvedContext.provider, ...resolvedContext.allProviders];
  for (const provider of providerCandidates) {
    const configuredModel = normalizeGeminiSearchModelCandidate(provider?.model);
    if (configuredModel) {
      return configuredModel;
    }
  }

  const runBoundModel = normalizeGeminiSearchModelCandidate(resolvedContext.model);
  if (runBoundModel) {
    return runBoundModel;
  }

  return DEFAULT_GEMINI_SEARCH_MODEL;
}

function isGeminiSearchProvider(
  provider: Awaited<ReturnType<typeof resolveToolProviderContext>>['provider'],
): boolean {
  if (!provider) {
    return false;
  }

  return provider.providerFamily === 'gemini' || looksLikeGeminiProvider(provider);
}

export function buildGeminiSearchUrl(baseUrl: string, model: string): string {
  const normalizedBaseUrl = normalizeGeminiBaseUrl(baseUrl || DEFAULT_GEMINI_BASE_URL);
  const normalizedModel = model
    .replace(/^models\//i, '')
    .replace(/^publishers\/[^/]+\/models\//i, '')
    .replace(/^projects\/[^/]+\/locations\/[^/]+\/publishers\/[^/]+\/models\//i, '')
    .trim();
  const modelPath = isVertexNativeGeminiBaseUrl(normalizedBaseUrl)
    ? `publishers/google/models/${encodeURIComponent(normalizedModel)}`
    : `models/${encodeURIComponent(normalizedModel)}`;
  return `${normalizedBaseUrl}/${modelPath}:generateContent`;
}

export function buildGeminiSearchTools(baseUrl: string): Array<Record<string, unknown>> {
  return isVertexNativeGeminiBaseUrl(baseUrl)
    ? [{ googleSearch: {} }]
    : [{ google_search: {} }];
}

export function describeGeminiErrorBody(bodyText: string): string {
  const normalizedBody = bodyText.trim();
  if (!normalizedBody) {
    return '';
  }

  try {
    const parsed = JSON.parse(normalizedBody) as
      | {
          error?: {
            message?: unknown;
            status?: unknown;
            code?: unknown;
          };
          message?: unknown;
        }
      | undefined;
    const message =
      typeof parsed?.error?.message === 'string'
        ? parsed.error.message.trim()
        : typeof parsed?.message === 'string'
          ? parsed.message.trim()
          : '';
    const status =
      typeof parsed?.error?.status === 'string' ? parsed.error.status.trim() : '';
    if (message && status) {
      return `${status}: ${message}`;
    }
    if (message) {
      return message;
    }
  } catch {}

  return normalizedBody.replace(/\s+/g, ' ').trim();
}

export async function resolveGeminiSearchTransport(params: {
  context?: ToolProviderContextInput;
  fallbackApiKey?: string | null;
}): Promise<GeminiSearchTransport | null> {
  const resolvedContext = await resolveToolProviderContext(params.context);
  const fallbackApiKey =
    typeof params.fallbackApiKey === 'string' && params.fallbackApiKey.trim()
      ? params.fallbackApiKey.trim()
      : undefined;
  const activeProvider =
    [
      isGeminiSearchProvider(resolvedContext.provider) ? resolvedContext.provider : null,
      ...resolvedContext.allProviders.filter((provider) => isGeminiSearchProvider(provider)),
    ].find((provider): provider is NonNullable<typeof provider> => Boolean(provider)) ?? null;
  const activeProviderApiKey =
    typeof activeProvider?.apiKey === 'string' && activeProvider.apiKey.trim()
      ? activeProvider.apiKey.trim()
      : undefined;
  const apiKey = activeProviderApiKey || fallbackApiKey;

  if (!apiKey) {
    return null;
  }

  if (activeProvider) {
    const activeModel =
      normalizeGeminiSearchModelCandidate(activeProvider.model) ||
      normalizeGeminiSearchModelCandidate(resolvedContext.model) ||
      DEFAULT_GEMINI_SEARCH_MODEL;
    return {
      apiKey,
      baseUrl: normalizeGeminiBaseUrl(activeProvider.baseUrl || DEFAULT_GEMINI_BASE_URL),
      model: activeModel,
    };
  }

  return {
    apiKey,
    baseUrl: DEFAULT_GEMINI_BASE_URL,
    model: await resolveGeminiSearchModel(params.context),
  };
}
