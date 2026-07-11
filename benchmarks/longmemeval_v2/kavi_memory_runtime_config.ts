import type {
  LlmProviderConfig,
  LlmProviderFamily,
  LlmProviderProtocol,
} from '../../src/types/provider';

export interface RuntimeConfig {
  chunkChars: number;
  chunkOverlapChars: number;
  maxItems: number;
  maxItemChars: number;
  minScore: number;
  conversationId: string;
  queryImageUnderstanding: boolean;
  queryImageModel: string;
  queryImageBaseUrl: string;
  queryImageApiKeyEnv: string;
  retrievalLlmEnabled: boolean;
  retrievalLlmModel: string;
  retrievalLlmBaseUrl: string;
  retrievalLlmApiKeyEnv: string;
  retrievalLlmProviderFamily: LlmProviderFamily;
  retrievalLlmProtocol: LlmProviderProtocol;
}

export const DEFAULT_QUERY_IMAGE_BASE_URL = 'https://api.openai.com/v1';

export const DEFAULT_CONFIG: RuntimeConfig = {
  chunkChars: 3600,
  chunkOverlapChars: 320,
  maxItems: 12,
  maxItemChars: 5000,
  minScore: 0.01,
  conversationId: 'longmemeval-v2',
  // Official runs pass every effective auxiliary-model setting through the
  // persisted memory config. Process environment must never alter a scored run
  // behind that artifact's back.
  queryImageUnderstanding: false,
  queryImageModel: '',
  queryImageBaseUrl: DEFAULT_QUERY_IMAGE_BASE_URL,
  queryImageApiKeyEnv: 'OPENAI_API_KEY',
  retrievalLlmEnabled: false,
  retrievalLlmModel: '',
  retrievalLlmBaseUrl: DEFAULT_QUERY_IMAGE_BASE_URL,
  retrievalLlmApiKeyEnv: 'OPENAI_API_KEY',
  retrievalLlmProviderFamily: 'openai',
  retrievalLlmProtocol: 'openai-responses',
};

function asBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
}

export function normalizeRuntimeConfig(
  currentConfig: RuntimeConfig,
  config?: Partial<RuntimeConfig>,
): RuntimeConfig {
  const nextConfig = config
    ? {
        ...currentConfig,
        ...Object.fromEntries(
          Object.entries(config).filter(([, value]) => value !== undefined && value !== null),
        ),
      }
    : currentConfig;
  nextConfig.chunkChars = Math.max(800, Math.min(20_000, Math.floor(nextConfig.chunkChars)));
  nextConfig.chunkOverlapChars = Math.max(
    0,
    Math.min(nextConfig.chunkChars - 1, Math.floor(nextConfig.chunkOverlapChars)),
  );
  nextConfig.maxItems = Math.max(1, Math.min(50, Math.floor(nextConfig.maxItems)));
  nextConfig.maxItemChars = Math.max(200, Math.min(20_000, Math.floor(nextConfig.maxItemChars)));
  nextConfig.minScore = Math.max(0, Math.min(1, Number(nextConfig.minScore)));
  nextConfig.conversationId = nextConfig.conversationId.trim() || DEFAULT_CONFIG.conversationId;
  nextConfig.queryImageUnderstanding =
    asBoolean(nextConfig.queryImageUnderstanding) ?? DEFAULT_CONFIG.queryImageUnderstanding;
  nextConfig.queryImageModel = String(
    nextConfig.queryImageModel || DEFAULT_CONFIG.queryImageModel,
  ).trim();
  nextConfig.queryImageBaseUrl = String(
    nextConfig.queryImageBaseUrl || DEFAULT_CONFIG.queryImageBaseUrl,
  ).trim();
  nextConfig.queryImageApiKeyEnv = String(
    nextConfig.queryImageApiKeyEnv || DEFAULT_CONFIG.queryImageApiKeyEnv,
  ).trim();
  nextConfig.retrievalLlmEnabled =
    asBoolean(nextConfig.retrievalLlmEnabled) ?? DEFAULT_CONFIG.retrievalLlmEnabled;
  nextConfig.retrievalLlmModel = String(
    nextConfig.retrievalLlmModel || DEFAULT_CONFIG.retrievalLlmModel,
  ).trim();
  nextConfig.retrievalLlmBaseUrl = String(
    nextConfig.retrievalLlmBaseUrl || DEFAULT_CONFIG.retrievalLlmBaseUrl,
  ).trim();
  nextConfig.retrievalLlmApiKeyEnv = String(
    nextConfig.retrievalLlmApiKeyEnv || DEFAULT_CONFIG.retrievalLlmApiKeyEnv,
  ).trim();
  nextConfig.retrievalLlmProviderFamily = (nextConfig.retrievalLlmProviderFamily ||
    DEFAULT_CONFIG.retrievalLlmProviderFamily) as LlmProviderFamily;
  nextConfig.retrievalLlmProtocol = (nextConfig.retrievalLlmProtocol ||
    DEFAULT_CONFIG.retrievalLlmProtocol) as LlmProviderProtocol;
  return nextConfig;
}

export function buildRetrievalLlmConfig(
  config: RuntimeConfig,
): { provider: LlmProviderConfig; model: string } | undefined {
  if (!config.retrievalLlmEnabled) return undefined;
  const model = config.retrievalLlmModel.trim();
  const apiKey = process.env[config.retrievalLlmApiKeyEnv]?.trim() ?? '';
  if (!model || !apiKey) return undefined;
  return {
    model,
    provider: {
      id: 'longmemeval-runtime-memory-provider',
      name: 'LongMemEval Runtime Memory Provider',
      kind: 'remote',
      protocol: config.retrievalLlmProtocol,
      providerFamily: config.retrievalLlmProviderFamily,
      capabilityHints: {
        supportsStructuredOutput: true,
      },
      baseUrl: config.retrievalLlmBaseUrl,
      apiKey,
      model,
      enabled: true,
    },
  };
}
