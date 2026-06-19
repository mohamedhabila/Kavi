import { KNOWN_PROVIDERS } from '../../constants/api';
import { ON_DEVICE_PROVIDER_NAME } from '../../services/localLlm/catalog';
import type { WebSearchProvider } from '../../types/tool';

type ProviderPreset = (typeof KNOWN_PROVIDERS)[number];
export type Step = 'welcome' | 'provider' | 'providerKey' | 'tools' | 'features' | 'done';

export interface ProviderGuide {
  id: string;
  title: string;
  summary: string;
  setup: string;
  freeAccess: string;
  docsUrl?: string;
  requiresKey: boolean;
  preset?: ProviderPreset;
}

export interface ServiceGuide {
  storageKey: string;
  title: string;
  category: string;
  unlocks: string;
  setup: string;
  freeAccess: string;
  placeholder: string;
  docsUrl?: string;
  /** Which web search provider selection makes this service essential */
  webProvider?: WebSearchProvider;
  /** Always show in the primary (non-collapsed) list */
  essential?: boolean;
}

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

export const buildProviderGuides = (t: TranslateFn): ProviderGuide[] => [
  {
    id: 'openai',
    title: t('onboarding.providers.openai.title'),
    summary: t('onboarding.providers.openai.summary'),
    setup: t('onboarding.providers.openai.setup'),
    freeAccess: t('onboarding.providers.openai.freeAccess'),
    docsUrl: 'https://platform.openai.com/api-keys',
    requiresKey: true,
    preset: KNOWN_PROVIDERS.find((provider) => provider.name === 'OpenAI'),
  },
  {
    id: 'anthropic',
    title: t('onboarding.providers.anthropic.title'),
    summary: t('onboarding.providers.anthropic.summary'),
    setup: t('onboarding.providers.anthropic.setup'),
    freeAccess: t('onboarding.providers.anthropic.freeAccess'),
    docsUrl: 'https://platform.claude.com/settings/keys',
    requiresKey: true,
    preset: KNOWN_PROVIDERS.find((provider) => provider.name === 'Anthropic'),
  },
  {
    id: 'gemini',
    title: t('onboarding.providers.gemini.title'),
    summary: t('onboarding.providers.gemini.summary'),
    setup: t('onboarding.providers.gemini.setup'),
    freeAccess: t('onboarding.providers.gemini.freeAccess'),
    docsUrl: 'https://docs.cloud.google.com/vertex-ai/generative-ai/docs/start/api-keys',
    requiresKey: true,
    preset: KNOWN_PROVIDERS.find((provider) => provider.name === 'Gemini'),
  },
  {
    id: 'openrouter',
    title: t('onboarding.providers.openrouter.title'),
    summary: t('onboarding.providers.openrouter.summary'),
    setup: t('onboarding.providers.openrouter.setup'),
    freeAccess: t('onboarding.providers.openrouter.freeAccess'),
    docsUrl: 'https://openrouter.ai/settings/keys',
    requiresKey: true,
    preset: KNOWN_PROVIDERS.find((provider) => provider.name === 'OpenRouter'),
  },
  {
    id: 'ollama',
    title: t('onboarding.providers.ollama.title'),
    summary: t('onboarding.providers.ollama.summary'),
    setup: t('onboarding.providers.ollama.setup'),
    freeAccess: t('onboarding.providers.ollama.freeAccess'),
    docsUrl: 'https://ollama.com/',
    requiresKey: false,
    preset: KNOWN_PROVIDERS.find((provider) => provider.name === 'Ollama (local)'),
  },
  {
    id: 'gemma-local',
    title: t('onboarding.providers.gemmaLocal.title'),
    summary: t('onboarding.providers.gemmaLocal.summary'),
    setup: t('onboarding.providers.gemmaLocal.setup'),
    freeAccess: t('onboarding.providers.gemmaLocal.freeAccess'),
    docsUrl: 'https://ai.google.dev/edge/mediapipe/solutions/genai/llm_inference',
    requiresKey: false,
    preset: KNOWN_PROVIDERS.find((provider) => provider.name === ON_DEVICE_PROVIDER_NAME),
  },
  {
    id: 'custom',
    title: t('onboarding.providers.custom.title'),
    summary: t('onboarding.providers.custom.summary'),
    setup: t('onboarding.providers.custom.setup'),
    freeAccess: t('onboarding.providers.custom.freeAccess'),
    requiresKey: true,
  },
];

export const buildWebProviderOptions = (
  t: TranslateFn,
): Array<{ value: WebSearchProvider; title: string; detail: string }> => [
  {
    value: 'auto',
    title: t('onboarding.webProviders.auto.title'),
    detail: t('onboarding.webProviders.auto.detail'),
  },
  {
    value: 'brave',
    title: t('onboarding.webProviders.brave.title'),
    detail: t('onboarding.webProviders.brave.detail'),
  },
  {
    value: 'gemini',
    title: t('onboarding.webProviders.gemini.title'),
    detail: t('onboarding.webProviders.gemini.detail'),
  },
  {
    value: 'perplexity',
    title: t('onboarding.webProviders.perplexity.title'),
    detail: t('onboarding.webProviders.perplexity.detail'),
  },
  {
    value: 'grok',
    title: t('onboarding.webProviders.grok.title'),
    detail: t('onboarding.webProviders.grok.detail'),
  },
  {
    value: 'kimi',
    title: t('onboarding.webProviders.kimi.title'),
    detail: t('onboarding.webProviders.kimi.detail'),
  },
];

export const buildServiceGuides = (t: TranslateFn): ServiceGuide[] => [
  {
    storageKey: 'BRAVE_API_KEY',
    title: t('onboarding.services.brave.title'),
    category: t('onboarding.services.brave.category'),
    unlocks: t('onboarding.services.brave.unlocks'),
    setup: t('onboarding.services.brave.setup'),
    freeAccess: t('onboarding.services.brave.freeAccess'),
    placeholder: 'BSA...',
    docsUrl: 'https://api-dashboard.search.brave.com/app/documentation/web-search/get-started',
    webProvider: 'brave',
  },
  {
    storageKey: 'GOOGLE_API_KEY',
    title: t('onboarding.services.gemini.title'),
    category: t('onboarding.services.gemini.category'),
    unlocks: t('onboarding.services.gemini.unlocks'),
    setup: t('onboarding.services.gemini.setup'),
    freeAccess: t('onboarding.services.gemini.freeAccess'),
    placeholder: 'AIza...',
    docsUrl: 'https://ai.google.dev/gemini-api/docs/api-key',
    webProvider: 'gemini',
  },
  {
    storageKey: 'PERPLEXITY_API_KEY',
    title: t('onboarding.services.perplexity.title'),
    category: t('onboarding.services.perplexity.category'),
    unlocks: t('onboarding.services.perplexity.unlocks'),
    setup: t('onboarding.services.perplexity.setup'),
    freeAccess: t('onboarding.services.perplexity.freeAccess'),
    placeholder: 'pplx-...',
    docsUrl: 'https://docs.perplexity.ai/guides/getting-started',
    webProvider: 'perplexity',
  },
  {
    storageKey: 'XAI_API_KEY',
    title: t('onboarding.services.xai.title'),
    category: t('onboarding.services.xai.category'),
    unlocks: t('onboarding.services.xai.unlocks'),
    setup: t('onboarding.services.xai.setup'),
    freeAccess: t('onboarding.services.xai.freeAccess'),
    placeholder: 'xai-...',
    docsUrl: 'https://docs.x.ai/developers/quickstart',
    webProvider: 'grok',
  },
  {
    storageKey: 'KIMI_API_KEY',
    title: t('onboarding.services.kimi.title'),
    category: t('onboarding.services.kimi.category'),
    unlocks: t('onboarding.services.kimi.unlocks'),
    setup: t('onboarding.services.kimi.setup'),
    freeAccess: t('onboarding.services.kimi.freeAccess'),
    placeholder: 'sk-...',
    docsUrl: 'https://platform.moonshot.ai/',
    webProvider: 'kimi',
  },
  {
    storageKey: 'FIRECRAWL_API_KEY',
    title: t('onboarding.services.firecrawl.title'),
    category: t('onboarding.services.firecrawl.category'),
    unlocks: t('onboarding.services.firecrawl.unlocks'),
    setup: t('onboarding.services.firecrawl.setup'),
    freeAccess: t('onboarding.services.firecrawl.freeAccess'),
    placeholder: 'fc-...',
    docsUrl: 'https://www.firecrawl.dev/pricing',
  },
  {
    storageKey: 'OPENWEATHER_API_KEY',
    title: t('onboarding.services.openweather.title'),
    category: t('onboarding.services.openweather.category'),
    unlocks: t('onboarding.services.openweather.unlocks'),
    setup: t('onboarding.services.openweather.setup'),
    freeAccess: t('onboarding.services.openweather.freeAccess'),
    placeholder: 'weather-key',
    docsUrl: 'https://openweathermap.org/price',
    essential: true,
  },
  {
    storageKey: 'GITHUB_TOKEN',
    title: t('onboarding.services.github.title'),
    category: t('onboarding.services.github.category'),
    unlocks: t('onboarding.services.github.unlocks'),
    setup: t('onboarding.services.github.setup'),
    freeAccess: t('onboarding.services.github.freeAccess'),
    placeholder: 'github_pat_...',
    docsUrl:
      'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens',
    essential: true,
  },
  {
    storageKey: 'ALPHA_VANTAGE_API_KEY',
    title: t('onboarding.services.alphaVantage.title'),
    category: t('onboarding.services.alphaVantage.category'),
    unlocks: t('onboarding.services.alphaVantage.unlocks'),
    setup: t('onboarding.services.alphaVantage.setup'),
    freeAccess: t('onboarding.services.alphaVantage.freeAccess'),
    placeholder: 'alpha-vantage-key',
    docsUrl: 'https://www.alphavantage.co/support/#api-key',
  },
];
