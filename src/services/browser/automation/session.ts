import { useSettingsStore } from '../../../store/useSettingsStore';
import type { BrowserProviderConfig } from '../../../types/remote';
import { getRemoteSessionRuntime, useRemoteStore } from '../../remote/store';
import { resolveBrowserProviderConnection, withBrowserProviderAuth } from '../providers/connection';

const DEFAULT_TIMEOUT_MS = 20_000;

export interface ResolvedBrowserSession {
  provider: BrowserProviderConfig;
  sessionId: string;
  externalId: string;
  webSocketUrl: string;
  baseUrl: string;
  authHeader: string;
  authHeaderValue: string;
}

export async function resolveBrowserAutomationSession(
  sessionId: string,
): Promise<ResolvedBrowserSession> {
  const session = useRemoteStore.getState().sessions[sessionId];
  if (!session) {
    throw new Error('browser-session-not-found');
  }

  const provider = (useSettingsStore.getState().browserProviders || []).find(
    (entry) => entry.id === session.providerId,
  );
  if (!provider) {
    throw new Error('browser-provider-not-found');
  }

  const connection = await resolveBrowserProviderConnection(provider);
  const runtime = getRemoteSessionRuntime(sessionId);
  const providerKind = provider.provider || 'browserbase';
  const headerName = providerKind === 'browserbase' ? 'X-BB-API-Key' : 'X-API-Key';
  const probe = withBrowserProviderAuth(connection.baseUrl, connection, headerName);
  const authHeaders = probe.headers || {};
  const firstHeaderName = Object.keys(authHeaders)[0] || headerName;
  const firstHeaderValue = authHeaders[firstHeaderName] || '';

  return {
    provider,
    sessionId,
    externalId: session.externalId || '',
    webSocketUrl: runtime?.webSocketUrl || '',
    baseUrl: connection.baseUrl,
    authHeader: firstHeaderName,
    authHeaderValue: firstHeaderValue || connection.token || '',
  };
}

export async function fetchBrowserProviderJson<T>(
  url: string,
  init: RequestInit & { timeoutMs?: number },
  authHeader: string,
  authHeaderValue: string,
): Promise<T> {
  const controller = new AbortController();
  const timeout = init.timeoutMs || DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeout);

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...((init.headers as Record<string, string>) || {}),
  };
  if (authHeaderValue) {
    headers[authHeader] = authHeaderValue;
  }

  try {
    const response = await fetch(url, {
      ...init,
      headers,
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Browser provider error (${response.status}): ${text.slice(0, 200)}`);
    }
    const text = await response.text();
    return text.trim() ? (JSON.parse(text) as T) : ({} as T);
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Browser request timed out after ${timeout}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function getBrowserProviderSessionBase(s: ResolvedBrowserSession): string {
  const providerKind = s.provider.provider || 'browserbase';
  return providerKind === 'browserbase'
    ? `${s.baseUrl}/v1/sessions/${encodeURIComponent(s.externalId)}`
    : s.baseUrl;
}
