// ---------------------------------------------------------------------------
// Tests — Browser Automation Client
// ---------------------------------------------------------------------------

import {
  browserNavigate,
  browserAct,
  browserScreenshot,
  browserSnapshot,
  browserSessionStatus,
} from '../../../src/services/browser/automation/actions';
import {
  browserSetCookies,
  browserClearCookies,
  browserGetCookies,
  browserStorageGet,
  browserStorageSet,
  browserStorageClear,
} from '../../../src/services/browser/automation/state';
import {
  browserConsoleMessages,
  browserPageErrors,
  browserNetworkRequests,
} from '../../../src/services/browser/automation/trace';
import {
  resetRemoteStore,
  useRemoteStore,
  setRemoteSessionRuntime,
} from '../../../src/services/remote/store';

const mockGetSecure = jest.fn().mockResolvedValue('test-api-key');

jest.mock('../../../src/services/storage/SecureStorage', () => ({
  getSecure: (...args: any[]) => mockGetSecure(...args),
}));

const browserProviders = [
  {
    id: 'prov-bb',
    name: 'Browserbase',
    provider: 'browserbase' as const,
    baseUrl: 'https://api.browserbase.com',
    authMode: 'api-key-header' as const,
    apiKeyRef: 'bb_key',
    projectId: 'proj_001',
    enabled: true,
  },
  {
    id: 'prov-bl',
    name: 'Browserless',
    provider: 'browserless' as const,
    baseUrl: 'https://chrome.browserless.io',
    authMode: 'api-key-header' as const,
    apiKeyRef: 'bl_key',
    enabled: true,
  },
];

jest.mock('../../../src/store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ browserProviders }),
  },
}));

function mockFetch(response: unknown, status = 200) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(response),
  }) as any;
}

function seedSession(providerId: string, externalId: string): string {
  const sessionId = useRemoteStore.getState().createSession({
    targetId: providerId,
    providerId,
    externalId,
    kind: 'browser-live',
    status: 'connected',
    summary: 'test',
    reconnectable: false,
  });
  setRemoteSessionRuntime(sessionId, { webSocketUrl: 'wss://example.com/ws' });
  return sessionId;
}

describe('browser automation – Browserbase provider', () => {
  let sessionId: string;

  beforeEach(() => {
    resetRemoteStore();
    jest.clearAllMocks();
    mockGetSecure.mockResolvedValue('test-api-key');
    sessionId = seedSession('prov-bb', 'ext-bb-sess-1');
  });

  it('browserNavigate sends POST to /v1/sessions/{id}/navigate', async () => {
    const expected = { ok: true, targetId: 'page1', url: 'https://example.com' };
    mockFetch(expected);

    const result = await browserNavigate(sessionId, { url: 'https://example.com' });

    expect(result.ok).toBe(true);
    expect(result.url).toBe('https://example.com');
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/v1/sessions/ext-bb-sess-1/navigate');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ url: 'https://example.com' });
  });

  it('browserAct sends POST to /v1/sessions/{id}/act', async () => {
    const expected = { ok: true, targetId: 'page1' };
    mockFetch(expected);

    const result = await browserAct(sessionId, { kind: 'click', ref: 'e1' });

    expect(result.ok).toBe(true);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/v1/sessions/ext-bb-sess-1/act');
    expect(JSON.parse(init.body)).toEqual({ kind: 'click', ref: 'e1' });
  });

  it('browserScreenshot sends POST to /v1/sessions/{id}/screenshot', async () => {
    const expected = { ok: true, imageBase64: 'abc123', targetId: 'page1' };
    mockFetch(expected);

    const result = await browserScreenshot(sessionId, { fullPage: true });

    expect(result.imageBase64).toBe('abc123');
    const [url] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/screenshot');
  });

  it('browserSnapshot sends POST to /v1/sessions/{id}/snapshot', async () => {
    const expected = { ok: true, targetId: 'page1', snapshot: '<html>snapshot</html>' };
    mockFetch(expected);

    const result = await browserSnapshot(sessionId);

    expect(result.snapshot).toBe('<html>snapshot</html>');
    const [url] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/snapshot');
  });

  it('browserConsoleMessages sends GET to /v1/sessions/{id}/console', async () => {
    const expected = { ok: true, messages: [{ type: 'log', text: 'Hello' }], targetId: 'page1' };
    mockFetch(expected);

    const result = await browserConsoleMessages(sessionId, { level: 'error' });

    expect(result.messages).toHaveLength(1);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/console?level=error');
    expect(init.method).toBe('GET');
  });

  it('browserPageErrors sends GET with query params', async () => {
    const expected = { ok: true, targetId: 'page1', errors: [{ message: 'TypeError' }] };
    mockFetch(expected);

    const result = await browserPageErrors(sessionId, { clear: true });

    expect(result.errors).toHaveLength(1);
    const [url] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/errors?clear=true');
  });

  it('browserNetworkRequests sends GET to /requests', async () => {
    const expected = {
      ok: true,
      targetId: 'page1',
      requests: [{ method: 'GET', url: 'https://api.test.com' }],
    };
    mockFetch(expected);

    const result = await browserNetworkRequests(sessionId, { filter: 'xhr' });

    expect(result.requests).toHaveLength(1);
    const [url] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/requests?filter=xhr');
  });

  it('browserSetCookies sends POST to /cookies/set', async () => {
    mockFetch({ ok: true });

    await browserSetCookies(sessionId, { cookie: { name: 'sess', value: 'abc' } });

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/cookies/set');
    expect(init.method).toBe('POST');
  });

  it('browserClearCookies sends POST to /cookies/clear', async () => {
    mockFetch({ ok: true });

    await browserClearCookies(sessionId);

    const [url] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/cookies/clear');
  });

  it('browserGetCookies sends GET to /cookies', async () => {
    mockFetch({ ok: true, targetId: 'page1', cookies: [{ name: 'test' }] });

    const result = await browserGetCookies(sessionId);

    expect(result.cookies).toHaveLength(1);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/cookies');
    expect(init.method).toBe('GET');
  });

  it('browserStorageGet sends GET to /storage/local', async () => {
    mockFetch({ ok: true, targetId: 'page1', values: { key1: 'val1' } });

    const result = await browserStorageGet(sessionId, { kind: 'local' });

    expect(result.values).toEqual({ key1: 'val1' });
    const [url] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/storage/local');
  });

  it('browserStorageSet sends POST to /storage/session/set', async () => {
    mockFetch({ ok: true });

    await browserStorageSet(sessionId, { kind: 'session', key: 'k', value: 'v' });

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/storage/session/set');
    expect(JSON.parse(init.body).key).toBe('k');
  });

  it('browserStorageClear sends POST to /storage/local/clear', async () => {
    mockFetch({ ok: true });

    await browserStorageClear(sessionId, { kind: 'local' });

    const [url] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/storage/local/clear');
  });

  it('browserSessionStatus sends GET to /v1/sessions/{id}', async () => {
    mockFetch({ id: 'ext-bb-sess-1', status: 'running', pages: 2 });

    const result = await browserSessionStatus(sessionId);

    expect(result.ok).toBe(true);
    expect(result.status).toBe('running');
    expect(result.pages).toBe(2);
  });
});

describe('browser automation – Browserless provider', () => {
  let sessionId: string;

  beforeEach(() => {
    resetRemoteStore();
    jest.clearAllMocks();
    mockGetSecure.mockResolvedValue('test-api-key');
    sessionId = seedSession('prov-bl', 'ext-bl-sess-1');
  });

  it('browserNavigate routes to /navigate (no /v1/sessions prefix)', async () => {
    mockFetch({ ok: true, targetId: 'page1', url: 'https://example.com' });

    await browserNavigate(sessionId, { url: 'https://example.com' });

    const [url] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://chrome.browserless.io/navigate');
  });

  it('browserAct routes to /act', async () => {
    mockFetch({ ok: true, targetId: 'page1' });

    await browserAct(sessionId, { kind: 'type', ref: 'e2', text: 'hello' });

    const [url] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://chrome.browserless.io/act');
  });

  it('browserSnapshot routes to /snapshot', async () => {
    mockFetch({ ok: true, targetId: 'page1', snapshot: '<snap>' });

    await browserSnapshot(sessionId);

    const [url] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://chrome.browserless.io/snapshot');
  });

  it('browserConsoleMessages routes to /console', async () => {
    mockFetch({ ok: true, messages: [], targetId: 'page1' });

    await browserConsoleMessages(sessionId);

    const [url] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://chrome.browserless.io/console');
  });

  it('browserSessionStatus uses runtime statusUrl', async () => {
    setRemoteSessionRuntime(sessionId, {
      webSocketUrl: 'wss://example.com/ws',
      statusUrl: 'https://chrome.browserless.io/session/ext-bl-sess-1/status',
    });
    mockFetch({ id: 'ext-bl-sess-1', status: 'active' });

    const result = await browserSessionStatus(sessionId);

    expect(result.status).toBe('active');
    const [url] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/session/ext-bl-sess-1/status');
  });

  it('browserSessionStatus returns unknown when no statusUrl', async () => {
    const result = await browserSessionStatus(sessionId);

    expect(result.ok).toBe(false);
    expect(result.status).toBe('unknown');
    // No fetch should have been made for status
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('browser automation – error handling', () => {
  beforeEach(() => {
    resetRemoteStore();
    jest.clearAllMocks();
    mockGetSecure.mockResolvedValue('test-api-key');
  });

  it('throws when session not found', async () => {
    await expect(browserNavigate('nonexistent', { url: 'https://example.com' })).rejects.toThrow(
      'browser-session-not-found',
    );
  });

  it('throws when provider not found', async () => {
    useRemoteStore.getState().createSession({
      targetId: 'unknown-provider',
      providerId: 'unknown-provider',
      kind: 'browser-live',
      status: 'connected',
      summary: 'test',
      reconnectable: false,
    });
    const sessionId = Object.keys(useRemoteStore.getState().sessions)[0];

    await expect(browserNavigate(sessionId, { url: 'https://example.com' })).rejects.toThrow(
      'browser-provider-not-found',
    );
  });

  it('throws on non-ok HTTP response', async () => {
    const sessionId = seedSession('prov-bb', 'ext-err-1');
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    }) as any;

    await expect(browserNavigate(sessionId, { url: 'https://example.com' })).rejects.toThrow(
      /Browser provider error \(500\)/,
    );
  });

  it('includes auth header in requests', async () => {
    const sessionId = seedSession('prov-bb', 'ext-auth-1');
    mockFetch({ ok: true, targetId: 'page1', url: 'https://example.com' });

    await browserNavigate(sessionId, { url: 'https://example.com' });

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.headers['X-BB-API-Key']).toBe('test-api-key');
  });
});
