import type { BrowserProviderConfig } from '../../../types/remote';
import { getSecure } from '../../storage/SecureStorage';
import {
  DEFAULT_BROWSERLESS_QUERY_TOKEN,
  normalizeBrowserProvider,
  normalizeBrowserProviderAuthMode,
  normalizeBrowserProviderBaseUrl,
  type BrowserProviderAuthMode,
  type BrowserProviderKind,
} from './registry';

export interface BrowserProviderConnection {
  provider: BrowserProviderKind;
  authMode: BrowserProviderAuthMode;
  baseUrl: string;
  token: string | null;
  queryTokenParam?: string;
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
    provider: normalizeBrowserProvider(config.provider),
    authMode: normalizeBrowserProviderAuthMode(config),
    baseUrl: normalizeBrowserProviderBaseUrl(config),
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
