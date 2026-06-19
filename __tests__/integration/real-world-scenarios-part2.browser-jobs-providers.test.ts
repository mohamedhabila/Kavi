const mockNativeConnect = jest.fn();
const mockNativeConnectVerifiedPassword = jest.fn();
const mockNativeConnectVerifiedKey = jest.fn();
const mockNativeGetHostFingerprint = jest.fn();
const mockNativeDisconnect = jest.fn();
function makeMockNativeClient() {
  return {
    on: jest.fn(),
    execute: jest.fn().mockResolvedValue('/home/user'),
    startShell: jest.fn().mockResolvedValue('shell-id'),
    writeToShell: jest.fn().mockResolvedValue('ok'),
    closeShell: jest.fn(),
    sftpLs: jest.fn().mockResolvedValue([]),
    sftpRename: jest.fn().mockResolvedValue(undefined),
    sftpMkdir: jest.fn().mockResolvedValue(undefined),
    sftpRm: jest.fn().mockResolvedValue(undefined),
    sftpRmdir: jest.fn().mockResolvedValue(undefined),
    sftpUpload: jest.fn().mockResolvedValue(undefined),
    sftpDownload: jest.fn().mockResolvedValue('/tmp/file'),
    disconnect: mockNativeDisconnect,
  };
}
jest.mock('@dylankenneally/react-native-ssh-sftp', () => ({
  __esModule: true,
  default: {
    connectWithPassword: mockNativeConnect,
    connectWithKey: jest.fn(),
    connectWithVerifiedPassword: mockNativeConnectVerifiedPassword,
    connectWithVerifiedKey: mockNativeConnectVerifiedKey,
    getHostFingerprint: mockNativeGetHostFingerprint,
  },
  PtyType: {
    VANILLA: 'vanilla',
    VT100: 'vt100',
    VT102: 'vt102',
    VT220: 'vt220',
    ANSI: 'ansi',
    XTERM: 'xterm',
  },
}));
const mockSecureStoreData = new Map<string, string>();
jest.mock('../../src/services/storage/SecureStorage', () => ({
  getSecure: jest.fn(async (key: string) => mockSecureStoreData.get(key) ?? null),
  setSecure: jest.fn(async (key: string, value: string) => {
    mockSecureStoreData.set(key, value);
  }),
  deleteSecure: jest.fn(async (key: string) => {
    mockSecureStoreData.delete(key);
  }),
}));
jest.mock('expo-file-system', () => ({
  Directory: class MockDirectory {
    constructor(..._args: unknown[]) {}
    create() {}
  },
  File: class MockFile {
    name = 'mock.txt';
    uri = '/tmp/mock.txt';
    exists = false;
    constructor(..._args: unknown[]) {}
    write() {}
    text() {
      return '';
    }
    delete() {}
  },
  Paths: { cache: '/tmp/cache', document: '/tmp/doc' },
}));
import { useRemoteStore, resetRemoteStore } from '../../src/services/remote/store';
import { launchBrowserLiveSession, stopBrowserLiveSession } from '../../src/services/browser/jobs';
import { probeBrowserProvider } from '../../src/services/browser/providers/probe';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import type { BrowserProviderConfig } from '../../src/types/remote';
function makeBrowserProvider(
  overrides: Partial<BrowserProviderConfig> = {},
): BrowserProviderConfig {
  return {
    id: 'browser-1',
    name: 'Primary Browserbase',
    provider: 'browserbase',
    baseUrl: 'https://api.browserbase.com',
    authMode: 'api-key-header',
    apiKeyRef: 'bb-key-ref-1',
    projectId: 'bb_test_project',
    enabled: true,
    ...overrides,
  };
}
const originalFetch = global.fetch;
beforeEach(() => {
  resetRemoteStore();
  mockSecureStoreData.clear();
  jest.clearAllMocks();
  global.fetch = originalFetch;
  mockNativeConnectVerifiedPassword.mockResolvedValue(makeMockNativeClient());
  mockNativeConnectVerifiedKey.mockResolvedValue(makeMockNativeClient());
  mockNativeGetHostFingerprint.mockResolvedValue('AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99');
});
afterAll(() => {
  global.fetch = originalFetch;
});

describe('Browser Jobs: Browserbase launch flow', () => {
  test('launches Browserbase session and creates job + session records', async () => {
    mockSecureStoreData.set('bb-key-ref-1', 'bb-api-key');
    const config = makeBrowserProvider();

    // Mock fetch for session create and debug lookup
    let fetchCallCount = 0;
    global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      fetchCallCount++;
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;

      if (urlStr.includes('/v1/sessions') && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'bb-session-123' }), { status: 200 });
      }
      if (urlStr.includes('/v1/sessions/bb-session-123/debug')) {
        return new Response(
          JSON.stringify({
            debuggerFullscreenUrl: 'https://debug.browserbase.com/live/bb-session-123',
            wsUrl: 'wss://ws.browserbase.com/bb-session-123',
          }),
          { status: 200 },
        );
      }
      return new Response('not found', { status: 404 });
    }) as jest.Mock;

    const sessionId = await launchBrowserLiveSession(config);
    expect(sessionId).toMatch(/^remote-session-/);
    expect(fetchCallCount).toBe(2);

    const state = useRemoteStore.getState();
    const jobs = Object.values(state.jobs);
    const sessions = Object.values(state.sessions);

    expect(jobs.length).toBe(1);
    expect(jobs[0].status).toBe('completed');
    expect(jobs[0].jobType).toBe('browser-job');
    expect(jobs[0].externalId).toBe('bb-session-123');
    expect(jobs[0].artifacts.length).toBeGreaterThan(0);

    expect(sessions.length).toBe(1);
    expect(sessions[0].status).toBe('connected');
    expect(sessions[0].liveViewUrl).toBe('https://debug.browserbase.com/live/bb-session-123');
    expect(sessions[0].externalId).toBe('bb-session-123');
  });

  test('Browserbase launch failure marks job as failed', async () => {
    mockSecureStoreData.set('bb-key-ref-1', 'bb-api-key');
    const config = makeBrowserProvider();

    global.fetch = jest.fn(async () => {
      return new Response('unauthorized', { status: 401 });
    }) as jest.Mock;

    await expect(launchBrowserLiveSession(config)).rejects.toThrow(
      'Browserbase session failed (401)',
    );

    const jobs = Object.values(useRemoteStore.getState().jobs);
    expect(jobs.length).toBe(1);
    expect(jobs[0].status).toBe('failed');
    expect(jobs[0].error).toContain('401');
  });

  test('disabled provider throws before making any requests', async () => {
    const config = makeBrowserProvider({ enabled: false });

    global.fetch = jest.fn() as jest.Mock;
    await expect(launchBrowserLiveSession(config)).rejects.toThrow('disabled');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('Browser Jobs: Browserless launch flow', () => {
  test('launches Browserless session with reconnect mutation', async () => {
    mockSecureStoreData.set('bl-key', 'bl-token');
    const config: BrowserProviderConfig = {
      id: 'bl-1',
      name: 'Browserless SFO',
      provider: 'browserless',
      baseUrl: 'https://production-sfo.browserless.io',
      authMode: 'query-token',
      queryTokenParam: 'token',
      apiKeyRef: 'bl-key',
      enabled: true,
    };

    let fetchCalls: Array<{ url: string; method?: string }> = [];
    global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
      fetchCalls.push({ url: urlStr, method: init?.method });

      if (urlStr.includes('/session') && init?.method === 'POST' && !urlStr.includes('bql')) {
        return new Response(
          JSON.stringify({
            id: 'bl-session-456',
            browserQL: 'https://production-sfo.browserless.io/bql/bl-session-456',
          }),
          { status: 200 },
        );
      }
      if (urlStr.includes('/bql/') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            data: {
              reconnect: {
                devtoolsFrontendUrl: 'https://devtools.browserless.io/bl-session-456',
                browserWSEndpoint: 'wss://ws.browserless.io/bl-session-456',
              },
            },
          }),
          { status: 200 },
        );
      }
      return new Response('not found', { status: 404 });
    }) as jest.Mock;

    const sessionId = await launchBrowserLiveSession(config);
    expect(sessionId).toMatch(/^remote-session-/);
    expect(fetchCalls.length).toBe(2);
    // Verify token was appended to URLs
    expect(fetchCalls[0].url).toContain('token=bl-token');

    const state = useRemoteStore.getState();
    const sessions = Object.values(state.sessions);
    expect(sessions[0].liveViewUrl).toBe('https://devtools.browserless.io/bl-session-456');
    expect(sessions[0].externalId).toBe('bl-session-456');
  });
});

describe('Browser Jobs: stop flow', () => {
  test('stopBrowserLiveSession sends DELETE and closes session', async () => {
    mockSecureStoreData.set('bb-key-ref-1', 'bb-api-key');

    // First set up settings store with the browser provider
    const config = makeBrowserProvider();
    useSettingsStore.getState().addBrowserProvider(config);

    // Create a session directly
    const sessionId = useRemoteStore.getState().createSession({
      targetId: 'browser-1',
      providerId: 'browser-1',
      kind: 'browser-live',
      status: 'connected',
      summary: 'Live view',
      reconnectable: true,
      externalId: 'bb-session-to-stop',
    });

    let fetchCalls: Array<{ url: string; method?: string }> = [];
    global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
      fetchCalls.push({ url: urlStr, method: init?.method });
      return new Response('', { status: 200 });
    }) as jest.Mock;

    await stopBrowserLiveSession(sessionId);

    const session = useRemoteStore.getState().sessions[sessionId];
    expect(session.status).toBe('closed');
    expect(fetchCalls.length).toBe(1);
    expect(fetchCalls[0].method).toBe('DELETE');
    expect(fetchCalls[0].url).toContain('bb-session-to-stop');

    // Cleanup
    useSettingsStore.getState().removeBrowserProvider('browser-1');
  });

  test('stopBrowserLiveSession for nonexistent session throws', async () => {
    await expect(stopBrowserLiveSession('nonexistent')).rejects.toThrow(
      'browser-session-not-found',
    );
  });

  test('stopBrowserLiveSession with no matching provider still closes', async () => {
    const sessionId = useRemoteStore.getState().createSession({
      targetId: 'orphan',
      providerId: 'orphan',
      kind: 'browser-live',
      status: 'connected',
      summary: 'Orphan session',
      reconnectable: true,
    });

    global.fetch = jest.fn() as jest.Mock;
    await stopBrowserLiveSession(sessionId);
    expect(useRemoteStore.getState().sessions[sessionId].status).toBe('closed');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('Browser Provider: probe', () => {
  test('successful Browserbase probe returns ok', async () => {
    mockSecureStoreData.set('bb-key-ref-1', 'bb-api-key');
    const config = makeBrowserProvider();

    global.fetch = jest.fn(async (url: string | URL | Request) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
      expect(urlStr).toContain('/v1/projects/bb_test_project');
      return new Response('{"name":"test"}', { status: 200 });
    }) as jest.Mock;

    const result = await probeBrowserProvider(config);
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.message).toContain('Ready');
  });

  test('failed probe returns error info', async () => {
    mockSecureStoreData.set('bb-key-ref-1', 'bb-api-key');
    const config = makeBrowserProvider();

    global.fetch = jest.fn(async () => new Response('bad', { status: 403 })) as jest.Mock;

    const result = await probeBrowserProvider(config);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(result.message).toContain('403');
  });

  test('probe with network error returns error message', async () => {
    mockSecureStoreData.set('bb-key-ref-1', 'bb-api-key');
    const config = makeBrowserProvider();

    global.fetch = jest.fn(async () => {
      throw new Error('Network error');
    }) as jest.Mock;

    const result = await probeBrowserProvider(config);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('Network error');
  });

  test('probe on disabled provider returns not launchable', async () => {
    const config = makeBrowserProvider({ enabled: false });
    const result = await probeBrowserProvider(config);
    expect(result.ok).toBe(false);
    expect(result.message).toBe('disabled');
  });

  test('Browserless probe hits /json/version with query token', async () => {
    mockSecureStoreData.set('bl-key', 'test-token');
    const config: BrowserProviderConfig = {
      id: 'bl-1',
      name: 'BL',
      provider: 'browserless',
      authMode: 'query-token',
      apiKeyRef: 'bl-key',
      queryTokenParam: 'token',
      enabled: true,
    };

    let capturedUrl = '';
    global.fetch = jest.fn(async (url: string | URL | Request) => {
      capturedUrl = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
      return new Response('{"version":"1.0"}', { status: 200 });
    }) as jest.Mock;

    const result = await probeBrowserProvider(config);
    expect(result.ok).toBe(true);
    expect(capturedUrl).toContain('/json/version');
    expect(capturedUrl).toContain('token=test-token');
  });
});
