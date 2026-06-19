import type { BrowserConsoleMessage, BrowserNetworkRequest, BrowserPageError } from '../types';
import {
  fetchBrowserProviderJson as fetchProviderJson,
  getBrowserProviderSessionBase,
  resolveBrowserAutomationSession as resolveSession,
} from './session';

export async function browserConsoleMessages(
  sessionId: string,
  opts: { level?: string; targetId?: string } = {},
): Promise<{ ok: true; messages: BrowserConsoleMessage[]; targetId: string }> {
  const s = await resolveSession(sessionId);
  const params = new URLSearchParams();
  if (opts.level) params.set('level', opts.level);
  if (opts.targetId) params.set('targetId', opts.targetId);
  const suffix = params.toString() ? `?${params.toString()}` : '';

  const base = getBrowserProviderSessionBase(s);

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

  const base = getBrowserProviderSessionBase(s);

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

  const base = getBrowserProviderSessionBase(s);

  return fetchProviderJson(
    `${base}/requests${suffix}`,
    { method: 'GET' },
    s.authHeader,
    s.authHeaderValue,
  );
}
