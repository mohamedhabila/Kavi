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

import type {
  BrowserActRequest,
  BrowserActResponse,
  BrowserActionTabResult,
  BrowserSessionStatus,
  BrowserSnapshotResult,
  BrowserFormField,
} from '../types';
import { getRemoteSessionRuntime } from '../../remote/store';
import {
  fetchBrowserProviderJson as fetchProviderJson,
  resolveBrowserAutomationSession as resolveSession,
} from './session';

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
