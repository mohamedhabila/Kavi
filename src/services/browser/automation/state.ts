import type { BrowserActionOk } from '../types';
import {
  fetchBrowserProviderJson as fetchProviderJson,
  getBrowserProviderSessionBase,
  resolveBrowserAutomationSession as resolveSession,
} from './session';

export async function browserSetCookies(
  sessionId: string,
  opts: { cookie: Record<string, unknown>; targetId?: string },
): Promise<BrowserActionOk> {
  const s = await resolveSession(sessionId);
  const base = getBrowserProviderSessionBase(s);

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
  const base = getBrowserProviderSessionBase(s);

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

  const base = getBrowserProviderSessionBase(s);

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

  const base = getBrowserProviderSessionBase(s);

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
  const base = getBrowserProviderSessionBase(s);

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
  const base = getBrowserProviderSessionBase(s);

  return fetchProviderJson<BrowserActionOk>(
    `${base}/storage/${opts.kind}/clear`,
    { method: 'POST', body: JSON.stringify({ targetId: opts.targetId }) },
    s.authHeader,
    s.authHeaderValue,
  );
}
