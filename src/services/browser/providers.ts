import { getSecure } from '../storage/SecureStorage';
import { i18n } from '../../i18n';
import type { BrowserProviderConfig } from '../../types';

export type BrowserProviderKind = NonNullable<BrowserProviderConfig['provider']>;
export type BrowserProviderAuthMode = NonNullable<BrowserProviderConfig['authMode']>;

export interface BrowserProviderReadiness {
  launchable: boolean;
  reason:
    | 'ready'
    | 'disabled'
    | 'missing-base-url'
    | 'invalid-base-url'
    | 'missing-api-key'
    | 'missing-project-id';
}

export interface BrowserProviderProbeResult {
  ok: boolean;
  status?: number;
  message: string;
  checkedAt: number;
}

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

export interface BrowserProviderConnection {
  provider: BrowserProviderKind;
  authMode: BrowserProviderAuthMode;
  baseUrl: string;
  token: string | null;
  queryTokenParam?: string;
}

const DEFAULT_BROWSERBASE_API_URL = 'https://api.browserbase.com';
const DEFAULT_BROWSERLESS_API_URL = 'https://production-sfo.browserless.io';
const DEFAULT_BROWSERLESS_QUERY_TOKEN = 'token';

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

function normalizeProvider(provider?: BrowserProviderConfig['provider']): BrowserProviderKind {
  return provider || 'browserbase';
}

function normalizeAuthMode(config: BrowserProviderConfig): BrowserProviderAuthMode {
  if (config.authMode) {
    return config.authMode;
  }
  return normalizeProvider(config.provider) === 'browserbase' ? 'api-key-header' : 'query-token';
}

function normalizeBaseUrl(config: BrowserProviderConfig): string {
  const provider = normalizeProvider(config.provider);
  const fallback =
    provider === 'browserbase'
      ? DEFAULT_BROWSERBASE_API_URL
      : provider === 'browserless'
        ? DEFAULT_BROWSERLESS_API_URL
        : '';
  return (config.baseUrl || fallback).trim().replace(/\/+$/g, '');
}

export function getBrowserProviderAuthLabel(authMode?: BrowserProviderConfig['authMode']): string {
  switch (authMode || 'api-key-header') {
    case 'none':
      return i18n.t('settings.browserAuthNone');
    case 'bearer':
      return i18n.t('settings.workspaceAuthBearer');
    case 'query-token':
      return i18n.t('settings.workspaceAuthQueryToken');
    case 'api-key-header':
    default:
      return i18n.t('settings.browserAuthApiKeyHeader');
  }
}

export function getBrowserProviderAuthHint(config: BrowserProviderConfig): string {
  const provider = normalizeProvider(config.provider);
  const authMode = normalizeAuthMode(config);

  if (provider === 'browserbase') {
    return i18n.t('settings.browserAuthHintBrowserbase');
  }
  if (provider === 'browserless' && authMode === 'query-token') {
    return i18n.t('settings.browserAuthHintBrowserlessQueryToken');
  }
  if (authMode === 'bearer') {
    return i18n.t('settings.browserAuthHintBearer');
  }
  if (authMode === 'api-key-header') {
    return i18n.t('settings.browserAuthHintApiKeyHeader');
  }
  if (authMode === 'query-token') {
    return i18n.t('settings.browserAuthHintQueryToken');
  }
  return i18n.t('settings.browserAuthHintNone');
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

export function getBrowserProviderLabel(provider?: BrowserProviderConfig['provider']): string {
  switch (normalizeProvider(provider)) {
    case 'browserless':
      return i18n.t('remoteWork.providerBrowserless');
    case 'custom':
      return i18n.t('remoteWork.providerCustomBrowserWorker');
    case 'browserbase':
    default:
      return i18n.t('remoteWork.providerBrowserbase');
  }
}

export function getBrowserProviderReadiness(
  config: BrowserProviderConfig,
  apiKey?: string | null,
): BrowserProviderReadiness {
  if (!config.enabled) {
    return { launchable: false, reason: 'disabled' };
  }

  const baseUrl = normalizeBaseUrl(config);
  if (!baseUrl) {
    return { launchable: false, reason: 'missing-base-url' };
  }

  if (!isValidBrowserProviderBaseUrl(baseUrl)) {
    return { launchable: false, reason: 'invalid-base-url' };
  }

  const provider = normalizeProvider(config.provider);
  const authMode = normalizeAuthMode(config);
  const hasToken = Boolean((apiKey || '').trim() || (config.apiKeyRef || '').trim());

  if (provider === 'browserbase' && !(config.projectId || '').trim()) {
    return { launchable: false, reason: 'missing-project-id' };
  }

  if (authMode !== 'none' && !hasToken) {
    return { launchable: false, reason: 'missing-api-key' };
  }

  return { launchable: true, reason: 'ready' };
}

export async function resolveBrowserProviderToken(
  config: BrowserProviderConfig,
): Promise<string | null> {
  if (!config.apiKeyRef) {
    return null;
  }
  const token = await getSecure(config.apiKeyRef);
  return token?.trim() || null;
}

export async function resolveBrowserProviderConnection(
  config: BrowserProviderConfig,
): Promise<BrowserProviderConnection> {
  return {
    provider: normalizeProvider(config.provider),
    authMode: normalizeAuthMode(config),
    baseUrl: normalizeBaseUrl(config),
    token: await resolveBrowserProviderToken(config),
    queryTokenParam:
      (config.queryTokenParam || DEFAULT_BROWSERLESS_QUERY_TOKEN).trim() ||
      DEFAULT_BROWSERLESS_QUERY_TOKEN,
  };
}

export function withBrowserProviderAuth(
  url: string,
  connection: Pick<BrowserProviderConnection, 'authMode' | 'token' | 'queryTokenParam'>,
  headerName = 'X-API-Key',
): { url: string; headers?: Record<string, string> } {
  const parsed = new URL(url);
  const headers: Record<string, string> = {};

  if (connection.authMode === 'query-token' && connection.token) {
    parsed.searchParams.set(
      connection.queryTokenParam || DEFAULT_BROWSERLESS_QUERY_TOKEN,
      connection.token,
    );
  } else if (connection.authMode === 'bearer' && connection.token) {
    headers.Authorization = `Bearer ${connection.token}`;
  } else if (connection.authMode === 'api-key-header' && connection.token) {
    headers[headerName] = connection.token;
  }

  return {
    url: parsed.toString(),
    headers: Object.keys(headers).length > 0 ? headers : undefined,
  };
}

function buildProbeRequest(
  config: BrowserProviderConfig,
  token?: string | null,
): { url: string; headers?: Record<string, string> } {
  const provider = normalizeProvider(config.provider);
  const authMode = normalizeAuthMode(config);
  const headers: Record<string, string> = {};

  if (provider === 'browserbase') {
    const projectId = (config.projectId || '').trim();
    const baseUrl = normalizeBaseUrl(config);
    const url = `${baseUrl}/v1/projects/${encodeURIComponent(projectId)}`;
    if (token) {
      headers['X-BB-API-Key'] = token;
    }
    return { url, headers };
  }

  const baseUrl = normalizeBaseUrl(config);
  const parsed = new URL(`${baseUrl}/json/version`);
  if (authMode === 'query-token' && token) {
    parsed.searchParams.set(
      (config.queryTokenParam || DEFAULT_BROWSERLESS_QUERY_TOKEN).trim() ||
        DEFAULT_BROWSERLESS_QUERY_TOKEN,
      token,
    );
  } else if (authMode === 'bearer' && token) {
    headers.Authorization = `Bearer ${token}`;
  } else if (authMode === 'api-key-header' && token) {
    headers['X-API-Key'] = token;
  }
  return { url: parsed.toString(), headers: Object.keys(headers).length > 0 ? headers : undefined };
}

export async function probeBrowserProvider(
  config: BrowserProviderConfig,
): Promise<BrowserProviderProbeResult> {
  const checkedAt = Date.now();

  try {
    const token = await resolveBrowserProviderToken(config);
    const readiness = getBrowserProviderReadiness(config, token);
    if (!readiness.launchable) {
      return {
        ok: false,
        message: readiness.reason,
        checkedAt,
      };
    }

    const request = buildProbeRequest(config, token);
    const response = await fetch(request.url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(request.headers || {}),
      },
    });

    return {
      ok: response.ok,
      status: response.status,
      message: response.ok ? `Ready (${response.status})` : `HTTP ${response.status}`,
      checkedAt,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'browser-provider-probe-failed',
      checkedAt,
    };
  }
}
