/**
 * Browser automation client for remote browser sessions.
 *
 * Handles remote browser actions for Browserbase and Browserless sessions.
 *
 * Instead of connecting to a local Playwright bridge server, this client
 * sends actions to the browser provider's HTTP/REST API endpoints. The
 * session must already be launched via jobs.ts before automation calls work.
 *
 * For Browserbase: actions route through their REST API + CDP debugger URL.
 * For Browserless: actions route through their GraphQL/REST endpoints.
 */

import { useSettingsStore } from '../../store/useSettingsStore';
import type { BrowserProviderConfig } from '../../types';
import { getRemoteSessionRuntime, useRemoteStore } from '../remote/store';
import { resolveBrowserProviderConnection, withBrowserProviderAuth } from './providers';
import type {
  BrowserActRequest,
  BrowserActResponse,
  BrowserActionOk,
  BrowserActionTabResult,
  BrowserConsoleMessage,
  BrowserNetworkRequest,
  BrowserPageError,
  BrowserSessionStatus,
  BrowserSnapshotResult,
  BrowserUploadResult,
  BrowserPdfResult,
  BrowserDialogResult,
  BrowserFormField,
} from './types';

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 20_000;

interface ResolvedSession {
  provider: BrowserProviderConfig;
  sessionId: string;
  externalId: string;
  webSocketUrl: string;
  baseUrl: string;
  authHeader: string;
  authHeaderValue: string;
}

async function resolveSession(sessionId: string): Promise<ResolvedSession> {
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

  // Use withBrowserProviderAuth to correctly handle all auth modes
  // (api-key-header, bearer, query-token) instead of hardcoding a single mode.
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

async function fetchProviderJson<T>(
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

// ---------------------------------------------------------------------------
// Core actions
// ---------------------------------------------------------------------------

export async function browserNavigate(
  sessionId: string,
  opts: { url: string; targetId?: string },
): Promise<BrowserActionTabResult> {
  const s = await resolveSession(sessionId);
  const providerKind = s.provider.provider || 'browserbase';

  if (providerKind === 'browserbase') {
    const endpoint = `${s.baseUrl}/v1/sessions/${encodeURIComponent(s.externalId)}/navigate`;
    return fetchProviderJson<BrowserActionTabResult>(
      endpoint,
      { method: 'POST', body: JSON.stringify({ url: opts.url, targetId: opts.targetId }) },
      s.authHeader,
      s.authHeaderValue,
    );
  }
  // Browserless — use /navigate endpoint
  return fetchProviderJson<BrowserActionTabResult>(
    `${s.baseUrl}/navigate`,
    { method: 'POST', body: JSON.stringify({ url: opts.url, targetId: opts.targetId }) },
    s.authHeader,
    s.authHeaderValue,
  );
}

export async function browserAct(
  sessionId: string,
  req: BrowserActRequest,
): Promise<BrowserActResponse> {
  const s = await resolveSession(sessionId);
  const providerKind = s.provider.provider || 'browserbase';

  if (providerKind === 'browserbase') {
    const endpoint = `${s.baseUrl}/v1/sessions/${encodeURIComponent(s.externalId)}/act`;
    return fetchProviderJson<BrowserActResponse>(
      endpoint,
      { method: 'POST', body: JSON.stringify(req) },
      s.authHeader,
      s.authHeaderValue,
    );
  }
  return fetchProviderJson<BrowserActResponse>(
    `${s.baseUrl}/act`,
    { method: 'POST', body: JSON.stringify(req) },
    s.authHeader,
    s.authHeaderValue,
  );
}

export async function browserScreenshot(
  sessionId: string,
  opts: {
    targetId?: string;
    fullPage?: boolean;
    ref?: string;
    element?: string;
    type?: 'png' | 'jpeg';
  } = {},
): Promise<{ ok: true; imageBase64: string; targetId: string; url?: string }> {
  const s = await resolveSession(sessionId);
  const providerKind = s.provider.provider || 'browserbase';

  if (providerKind === 'browserbase') {
    const endpoint = `${s.baseUrl}/v1/sessions/${encodeURIComponent(s.externalId)}/screenshot`;
    return fetchProviderJson(
      endpoint,
      { method: 'POST', body: JSON.stringify(opts) },
      s.authHeader,
      s.authHeaderValue,
    );
  }
  return fetchProviderJson(
    `${s.baseUrl}/screenshot`,
    { method: 'POST', body: JSON.stringify(opts) },
    s.authHeader,
    s.authHeaderValue,
  );
}

export async function browserSnapshot(
  sessionId: string,
  opts: { targetId?: string; maxChars?: number } = {},
): Promise<BrowserSnapshotResult> {
  const s = await resolveSession(sessionId);
  const providerKind = s.provider.provider || 'browserbase';

  if (providerKind === 'browserbase') {
    const endpoint = `${s.baseUrl}/v1/sessions/${encodeURIComponent(s.externalId)}/snapshot`;
    return fetchProviderJson<BrowserSnapshotResult>(
      endpoint,
      { method: 'POST', body: JSON.stringify(opts) },
      s.authHeader,
      s.authHeaderValue,
    );
  }
  return fetchProviderJson<BrowserSnapshotResult>(
    `${s.baseUrl}/snapshot`,
    { method: 'POST', body: JSON.stringify(opts) },
    s.authHeader,
    s.authHeaderValue,
  );
}

// ---------------------------------------------------------------------------
// Observation
// ---------------------------------------------------------------------------

export async function browserConsoleMessages(
  sessionId: string,
  opts: { level?: string; targetId?: string } = {},
): Promise<{ ok: true; messages: BrowserConsoleMessage[]; targetId: string }> {
  const s = await resolveSession(sessionId);
  const params = new URLSearchParams();
  if (opts.level) params.set('level', opts.level);
  if (opts.targetId) params.set('targetId', opts.targetId);
  const suffix = params.toString() ? `?${params.toString()}` : '';

  const providerKind = s.provider.provider || 'browserbase';
  const base =
    providerKind === 'browserbase'
      ? `${s.baseUrl}/v1/sessions/${encodeURIComponent(s.externalId)}`
      : s.baseUrl;

  return fetchProviderJson(
    `${base}/console${suffix}`,
    { method: 'GET' },
    s.authHeader,
    s.authHeaderValue,
  );
}

export async function browserPageErrors(
  sessionId: string,
  opts: { targetId?: string; clear?: boolean } = {},
): Promise<{ ok: true; targetId: string; errors: BrowserPageError[] }> {
  const s = await resolveSession(sessionId);
  const params = new URLSearchParams();
  if (opts.targetId) params.set('targetId', opts.targetId);
  if (typeof opts.clear === 'boolean') params.set('clear', String(opts.clear));
  const suffix = params.toString() ? `?${params.toString()}` : '';

  const providerKind = s.provider.provider || 'browserbase';
  const base =
    providerKind === 'browserbase'
      ? `${s.baseUrl}/v1/sessions/${encodeURIComponent(s.externalId)}`
      : s.baseUrl;

  return fetchProviderJson(
    `${base}/errors${suffix}`,
    { method: 'GET' },
    s.authHeader,
    s.authHeaderValue,
  );
}

export async function browserNetworkRequests(
  sessionId: string,
  opts: { targetId?: string; filter?: string; clear?: boolean } = {},
): Promise<{ ok: true; targetId: string; requests: BrowserNetworkRequest[] }> {
  const s = await resolveSession(sessionId);
  const params = new URLSearchParams();
  if (opts.targetId) params.set('targetId', opts.targetId);
  if (opts.filter) params.set('filter', opts.filter);
  if (typeof opts.clear === 'boolean') params.set('clear', String(opts.clear));
  const suffix = params.toString() ? `?${params.toString()}` : '';

  const providerKind = s.provider.provider || 'browserbase';
  const base =
    providerKind === 'browserbase'
      ? `${s.baseUrl}/v1/sessions/${encodeURIComponent(s.externalId)}`
      : s.baseUrl;

  return fetchProviderJson(
    `${base}/requests${suffix}`,
    { method: 'GET' },
    s.authHeader,
    s.authHeaderValue,
  );
}

// ---------------------------------------------------------------------------
// State management
// ---------------------------------------------------------------------------

export async function browserSetCookies(
  sessionId: string,
  opts: { cookie: Record<string, unknown>; targetId?: string },
): Promise<BrowserActionOk> {
  const s = await resolveSession(sessionId);
  const providerKind = s.provider.provider || 'browserbase';
  const base =
    providerKind === 'browserbase'
      ? `${s.baseUrl}/v1/sessions/${encodeURIComponent(s.externalId)}`
      : s.baseUrl;

  return fetchProviderJson<BrowserActionOk>(
    `${base}/cookies/set`,
    { method: 'POST', body: JSON.stringify({ targetId: opts.targetId, cookie: opts.cookie }) },
    s.authHeader,
    s.authHeaderValue,
  );
}

export async function browserClearCookies(
  sessionId: string,
  opts: { targetId?: string } = {},
): Promise<BrowserActionOk> {
  const s = await resolveSession(sessionId);
  const providerKind = s.provider.provider || 'browserbase';
  const base =
    providerKind === 'browserbase'
      ? `${s.baseUrl}/v1/sessions/${encodeURIComponent(s.externalId)}`
      : s.baseUrl;

  return fetchProviderJson<BrowserActionOk>(
    `${base}/cookies/clear`,
    { method: 'POST', body: JSON.stringify({ targetId: opts.targetId }) },
    s.authHeader,
    s.authHeaderValue,
  );
}

export async function browserGetCookies(
  sessionId: string,
  opts: { targetId?: string } = {},
): Promise<{ ok: true; targetId: string; cookies: unknown[] }> {
  const s = await resolveSession(sessionId);
  const params = new URLSearchParams();
  if (opts.targetId) params.set('targetId', opts.targetId);
  const suffix = params.toString() ? `?${params.toString()}` : '';

  const providerKind = s.provider.provider || 'browserbase';
  const base =
    providerKind === 'browserbase'
      ? `${s.baseUrl}/v1/sessions/${encodeURIComponent(s.externalId)}`
      : s.baseUrl;

  return fetchProviderJson(
    `${base}/cookies${suffix}`,
    { method: 'GET' },
    s.authHeader,
    s.authHeaderValue,
  );
}

export async function browserStorageGet(
  sessionId: string,
  opts: { kind: 'local' | 'session'; key?: string; targetId?: string },
): Promise<{ ok: true; targetId: string; values: Record<string, string> }> {
  const s = await resolveSession(sessionId);
  const params = new URLSearchParams();
  if (opts.targetId) params.set('targetId', opts.targetId);
  if (opts.key) params.set('key', opts.key);
  const suffix = params.toString() ? `?${params.toString()}` : '';

  const providerKind = s.provider.provider || 'browserbase';
  const base =
    providerKind === 'browserbase'
      ? `${s.baseUrl}/v1/sessions/${encodeURIComponent(s.externalId)}`
      : s.baseUrl;

  return fetchProviderJson(
    `${base}/storage/${opts.kind}${suffix}`,
    { method: 'GET' },
    s.authHeader,
    s.authHeaderValue,
  );
}

export async function browserStorageSet(
  sessionId: string,
  opts: { kind: 'local' | 'session'; key: string; value: string; targetId?: string },
): Promise<BrowserActionOk> {
  const s = await resolveSession(sessionId);
  const providerKind = s.provider.provider || 'browserbase';
  const base =
    providerKind === 'browserbase'
      ? `${s.baseUrl}/v1/sessions/${encodeURIComponent(s.externalId)}`
      : s.baseUrl;

  return fetchProviderJson<BrowserActionOk>(
    `${base}/storage/${opts.kind}/set`,
    {
      method: 'POST',
      body: JSON.stringify({ targetId: opts.targetId, key: opts.key, value: opts.value }),
    },
    s.authHeader,
    s.authHeaderValue,
  );
}

export async function browserStorageClear(
  sessionId: string,
  opts: { kind: 'local' | 'session'; targetId?: string },
): Promise<BrowserActionOk> {
  const s = await resolveSession(sessionId);
  const providerKind = s.provider.provider || 'browserbase';
  const base =
    providerKind === 'browserbase'
      ? `${s.baseUrl}/v1/sessions/${encodeURIComponent(s.externalId)}`
      : s.baseUrl;

  return fetchProviderJson<BrowserActionOk>(
    `${base}/storage/${opts.kind}/clear`,
    { method: 'POST', body: JSON.stringify({ targetId: opts.targetId }) },
    s.authHeader,
    s.authHeaderValue,
  );
}

// ---------------------------------------------------------------------------
// Session status check
// ---------------------------------------------------------------------------

export async function browserSessionStatus(sessionId: string): Promise<BrowserSessionStatus> {
  const s = await resolveSession(sessionId);
  const providerKind = s.provider.provider || 'browserbase';

  if (providerKind === 'browserbase') {
    const endpoint = `${s.baseUrl}/v1/sessions/${encodeURIComponent(s.externalId)}`;
    const result = await fetchProviderJson<{ id: string; status: string; pages?: number }>(
      endpoint,
      { method: 'GET' },
      s.authHeader,
      s.authHeaderValue,
    );
    return {
      ok: true,
      sessionId: s.externalId,
      status: result.status || 'unknown',
      pages: result.pages,
    };
  }

  // Browserless — use the stored status URL or check via browserQL
  const runtime = getRemoteSessionRuntime(sessionId);
  if (runtime?.statusUrl) {
    const result = await fetchProviderJson<{ id?: string; status?: string }>(
      runtime.statusUrl,
      { method: 'GET' },
      s.authHeader,
      s.authHeaderValue,
    );
    return { ok: true, sessionId: s.externalId, status: result.status || 'active' };
  }

  return { ok: false, sessionId: s.externalId, status: 'unknown' };
}

// ---------------------------------------------------------------------------
// File upload
// ---------------------------------------------------------------------------

export async function browserUpload(
  sessionId: string,
  opts: { ref: string; filePath: string; filename?: string; targetId?: string },
): Promise<BrowserUploadResult> {
  const s = await resolveSession(sessionId);
  const providerKind = s.provider.provider || 'browserbase';
  const base =
    providerKind === 'browserbase'
      ? `${s.baseUrl}/v1/sessions/${encodeURIComponent(s.externalId)}`
      : s.baseUrl;

  return fetchProviderJson<BrowserUploadResult>(
    `${base}/upload`,
    {
      method: 'POST',
      body: JSON.stringify({
        ref: opts.ref,
        filePath: opts.filePath,
        filename: opts.filename,
        targetId: opts.targetId,
      }),
    },
    s.authHeader,
    s.authHeaderValue,
  );
}

// ---------------------------------------------------------------------------
// File download
// ---------------------------------------------------------------------------

export async function browserDownload(
  sessionId: string,
  opts: { url?: string; suggestedFilename?: string; targetId?: string; waitMs?: number },
): Promise<{
  ok: true;
  targetId: string;
  downloads: Array<{ url: string; suggestedFilename: string; path: string }>;
}> {
  const s = await resolveSession(sessionId);
  const providerKind = s.provider.provider || 'browserbase';
  const base =
    providerKind === 'browserbase'
      ? `${s.baseUrl}/v1/sessions/${encodeURIComponent(s.externalId)}`
      : s.baseUrl;

  return fetchProviderJson(
    `${base}/downloads`,
    {
      method: 'POST',
      body: JSON.stringify({
        url: opts.url,
        suggestedFilename: opts.suggestedFilename,
        targetId: opts.targetId,
        waitMs: opts.waitMs ?? 5000,
      }),
    },
    s.authHeader,
    s.authHeaderValue,
  );
}

// ---------------------------------------------------------------------------
// PDF generation
// ---------------------------------------------------------------------------

export async function browserPdf(
  sessionId: string,
  opts: {
    targetId?: string;
    format?: string;
    landscape?: boolean;
    printBackground?: boolean;
    scale?: number;
  },
): Promise<BrowserPdfResult> {
  const s = await resolveSession(sessionId);
  const providerKind = s.provider.provider || 'browserbase';
  const base =
    providerKind === 'browserbase'
      ? `${s.baseUrl}/v1/sessions/${encodeURIComponent(s.externalId)}`
      : s.baseUrl;

  return fetchProviderJson<BrowserPdfResult>(
    `${base}/pdf`,
    {
      method: 'POST',
      body: JSON.stringify({
        targetId: opts.targetId,
        format: opts.format || 'A4',
        landscape: opts.landscape || false,
        printBackground: opts.printBackground !== false,
        scale: opts.scale || 1,
      }),
    },
    s.authHeader,
    s.authHeaderValue,
  );
}

// ---------------------------------------------------------------------------
// Form fill
// ---------------------------------------------------------------------------

export async function browserFillForm(
  sessionId: string,
  opts: { fields: BrowserFormField[]; targetId?: string; submit?: boolean },
): Promise<BrowserActResponse> {
  return browserAct(sessionId, {
    kind: 'fill',
    fields: opts.fields,
    targetId: opts.targetId,
  } as BrowserActRequest);
}

// ---------------------------------------------------------------------------
// Dialog handling
// ---------------------------------------------------------------------------

export async function browserDialog(
  sessionId: string,
  opts: { action: 'accept' | 'dismiss'; promptText?: string; targetId?: string },
): Promise<BrowserDialogResult> {
  const s = await resolveSession(sessionId);
  const providerKind = s.provider.provider || 'browserbase';
  const base =
    providerKind === 'browserbase'
      ? `${s.baseUrl}/v1/sessions/${encodeURIComponent(s.externalId)}`
      : s.baseUrl;

  return fetchProviderJson<BrowserDialogResult>(
    `${base}/dialog`,
    {
      method: 'POST',
      body: JSON.stringify({
        action: opts.action,
        promptText: opts.promptText,
        targetId: opts.targetId,
      }),
    },
    s.authHeader,
    s.authHeaderValue,
  );
}
