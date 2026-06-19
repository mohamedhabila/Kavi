import type { BrowserProviderConfig } from '../../../types/remote';

export type BrowserProviderKind = NonNullable<BrowserProviderConfig['provider']>;
export type BrowserProviderAuthMode = NonNullable<BrowserProviderConfig['authMode']>;

export interface BrowserProviderPreset {
  id: string;
  label: string;
  description: string;
  provider: BrowserProviderKind;
  baseUrl: string;
  authMode: BrowserProviderAuthMode;
  queryTokenParam?: string;
  name: string;
}

export const DEFAULT_BROWSERBASE_API_URL = 'https://api.browserbase.com';
export const DEFAULT_BROWSERLESS_API_URL = 'https://production-sfo.browserless.io';
export const DEFAULT_BROWSERLESS_QUERY_TOKEN = 'token';

export const BROWSER_PROVIDER_OPTIONS: BrowserProviderKind[] = [
  'browserbase',
  'browserless',
  'custom',
];

export const BROWSER_PROVIDER_AUTH_OPTIONS: BrowserProviderAuthMode[] = [
  'none',
  'api-key-header',
  'bearer',
  'query-token',
];

export const BROWSER_PROVIDER_PRESETS: BrowserProviderPreset[] = [
  {
    id: 'browserbase-default',
    label: 'Browserbase',
    description: 'Managed Browserbase sessions with API key header auth.',
    provider: 'browserbase',
    baseUrl: DEFAULT_BROWSERBASE_API_URL,
    authMode: 'api-key-header',
    name: 'Primary Browserbase',
  },
  {
    id: 'browserless-sfo',
    label: 'Browserless SFO',
    description: 'Browserless cloud in the San Francisco region using token query auth.',
    provider: 'browserless',
    baseUrl: DEFAULT_BROWSERLESS_API_URL,
    authMode: 'query-token',
    queryTokenParam: DEFAULT_BROWSERLESS_QUERY_TOKEN,
    name: 'Browserless SFO',
  },
  {
    id: 'browserless-lon',
    label: 'Browserless LON',
    description: 'Browserless cloud in the London region using token query auth.',
    provider: 'browserless',
    baseUrl: 'https://production-lon.browserless.io',
    authMode: 'query-token',
    queryTokenParam: DEFAULT_BROWSERLESS_QUERY_TOKEN,
    name: 'Browserless LON',
  },
  {
    id: 'browserless-ams',
    label: 'Browserless AMS',
    description: 'Browserless cloud in the Amsterdam region using token query auth.',
    provider: 'browserless',
    baseUrl: 'https://production-ams.browserless.io',
    authMode: 'query-token',
    queryTokenParam: DEFAULT_BROWSERLESS_QUERY_TOKEN,
    name: 'Browserless AMS',
  },
  {
    id: 'custom-query-worker',
    label: 'Custom Query Worker',
    description: 'Browserless-compatible worker using token query auth.',
    provider: 'custom',
    baseUrl: 'https://browser-worker.example.com',
    authMode: 'query-token',
    queryTokenParam: DEFAULT_BROWSERLESS_QUERY_TOKEN,
    name: 'Custom Browser Worker',
  },
  {
    id: 'custom-bearer-worker',
    label: 'Custom Bearer Worker',
    description: 'Custom worker using bearer token auth for REST endpoints.',
    provider: 'custom',
    baseUrl: 'https://browser-worker.example.com',
    authMode: 'bearer',
    name: 'Custom Browser Worker',
  },
];

export function normalizeBrowserProvider(
  provider?: BrowserProviderConfig['provider'],
): BrowserProviderKind {
  return provider || 'browserbase';
}

export function normalizeBrowserProviderAuthMode(
  config: BrowserProviderConfig,
): BrowserProviderAuthMode {
  if (config.authMode) {
    return config.authMode;
  }
  return normalizeBrowserProvider(config.provider) === 'browserbase'
    ? 'api-key-header'
    : 'query-token';
}

export function normalizeBrowserProviderBaseUrl(config: BrowserProviderConfig): string {
  const provider = normalizeBrowserProvider(config.provider);
  const fallback =
    provider === 'browserbase'
      ? DEFAULT_BROWSERBASE_API_URL
      : provider === 'browserless'
        ? DEFAULT_BROWSERLESS_API_URL
        : '';
  return (config.baseUrl || fallback).trim().replace(/\/+$/g, '');
}

export function getBrowserProviderPreset(presetId: string): BrowserProviderPreset | undefined {
  return BROWSER_PROVIDER_PRESETS.find((preset) => preset.id === presetId);
}

export function applyBrowserProviderPreset(
  config: BrowserProviderConfig,
  presetId: string,
): BrowserProviderConfig {
  const preset = getBrowserProviderPreset(presetId);
  if (!preset) {
    return config;
  }

  return {
    ...config,
    name: preset.name,
    provider: preset.provider,
    baseUrl: preset.baseUrl,
    authMode: preset.authMode,
    queryTokenParam: preset.queryTokenParam,
    projectId: preset.provider === 'browserbase' ? config.projectId : undefined,
  };
}

export function isValidBrowserProviderBaseUrl(baseUrl?: string): boolean {
  const normalized = (baseUrl || '').trim();
  if (!normalized) {
    return false;
  }

  try {
    const parsed = new URL(normalized);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
