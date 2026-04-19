/**
 * Real-world integration scenarios — Part 2.
 *
 * Exercises the deeper production code paths:
 *   1. SSH connector TOFU flow with mocked native module
 *   2. SSH connector strict-mode rejection
 *   3. Browser jobs launch/stop flow with mocked fetch
 *   4. MCP bridge resource & image content formatting
 *   5. Settings store ↔ SSH/Browser CRUD round-trips
 *   6. Command center snapshot with MCP status injection
 *   7. Browser provider probe with mocked fetch
 */

// ---- Mocks ----
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

// ---- Imports ----
import { useRemoteStore, resetRemoteStore } from '../../src/services/remote/store';
import {
  connectSshTarget,
  getSshTargetReadiness,
  resolveSshSecrets,
} from '../../src/services/ssh/connector';
import {
  connectNativeSshWithKey,
  connectNativeSshWithPassword,
  connectNativeSshWithVerifiedKey,
  connectNativeSshWithVerifiedPassword,
  getNativeSshCapabilities,
  getNativeSshHostFingerprint,
  getSshAuthMode,
  getSshPtyType,
  supportsVerifiedSshConnections,
} from '../../src/services/ssh/native';
import { launchBrowserLiveSession, stopBrowserLiveSession } from '../../src/services/browser/jobs';
import { probeBrowserProvider } from '../../src/services/browser/providers';
import { formatMcpResult } from '../../src/services/mcp/bridge';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import { buildRemoteCommandCenterSnapshot } from '../../src/services/remote/commandCenter';
import type { SshTargetConfig, BrowserProviderConfig, McpServerConfig } from '../../src/types';

// ---- Helpers ----
function makeSshTarget(overrides: Partial<SshTargetConfig> = {}): SshTargetConfig {
  return {
    id: 'ssh-1',
    name: 'Build Server',
    host: 'build.example.com',
    port: 22,
    username: 'deployer',
    enabled: true,
    authMode: 'password',
    passwordRef: 'ssh-pwd-ref-1',
    hostKeyPolicy: 'trust-on-first-use',
    ...overrides,
  };
}

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

describe('SSH native helpers', () => {
  test('report capabilities, map auth and pty options, and trim connection parameters', async () => {
    const nativeModule = jest.requireMock('@dylankenneally/react-native-ssh-sftp') as {
      PtyType?: Record<string, string>;
    };
    const target = makeSshTarget({
      host: ' build.example.com ',
      username: ' deployer ',
      port: undefined,
      ptyType: 'vt102',
    });

    expect(getNativeSshCapabilities()).toEqual({
      verifiedPassword: true,
      verifiedKey: true,
      fingerprintLookup: true,
    });
    expect(supportsVerifiedSshConnections()).toBe(true);
    expect(getSshAuthMode({ authMode: undefined })).toBe('password');
    expect(getSshAuthMode({ authMode: 'private-key' })).toBe('private-key');
    expect(getSshPtyType(target)).toBe('vt102');

    await connectNativeSshWithPassword(target, 'my-password');
    await connectNativeSshWithVerifiedPassword(target, 'my-password', 'AA:BB');
    await connectNativeSshWithKey(target, 'PRIVATE KEY', 'passphrase');
    await connectNativeSshWithVerifiedKey(target, 'PRIVATE KEY', undefined, 'AA:BB');
    await getNativeSshHostFingerprint(target);

    expect(mockNativeConnect).toHaveBeenCalledWith(
      'build.example.com',
      22,
      'deployer',
      'my-password',
    );
    expect(mockNativeConnectVerifiedPassword).toHaveBeenCalledWith(
      'build.example.com',
      22,
      'deployer',
      'my-password',
      'AA:BB',
    );
    expect(mockNativeConnectVerifiedKey).toHaveBeenCalledWith(
      'build.example.com',
      22,
      'deployer',
      'PRIVATE KEY',
      undefined,
      'AA:BB',
    );
    expect(mockNativeGetHostFingerprint).toHaveBeenCalledWith('build.example.com', 22, 'deployer');

    const originalPtyType = nativeModule.PtyType;
    delete nativeModule.PtyType;
    expect(getSshPtyType({ ptyType: 'ansi' } as SshTargetConfig)).toBe('ansi');
    nativeModule.PtyType = originalPtyType;
  });

  test('fail closed when verified capabilities are unavailable', () => {
    const nativeModule = jest.requireMock('@dylankenneally/react-native-ssh-sftp') as {
      default: Record<string, unknown>;
    };
    const originalDefault = nativeModule.default;
    nativeModule.default = {
      connectWithPassword: mockNativeConnect,
      connectWithKey: jest.fn(),
    };

    expect(getNativeSshCapabilities()).toEqual({
      verifiedPassword: false,
      verifiedKey: false,
      fingerprintLookup: false,
    });
    expect(supportsVerifiedSshConnections()).toBe(false);

    nativeModule.default = originalDefault;
  });
});

// ========================================================================
// 1. SSH CONNECTOR — TOFU FLOW
// ========================================================================
describe('SSH Connector: TOFU connect flow', () => {
  test('TOFU first connection fetches fingerprint and connects with verified method', async () => {
    mockSecureStoreData.set('ssh-pwd-ref-1', 'my-password');
    const target = makeSshTarget({ trustedHostFingerprint: undefined });

    const result = await connectSshTarget(target);
    expect(mockNativeGetHostFingerprint).toHaveBeenCalledWith('build.example.com', 22, 'deployer');
    expect(mockNativeConnectVerifiedPassword).toHaveBeenCalledWith(
      'build.example.com',
      22,
      'deployer',
      'my-password',
      'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99',
    );
    expect(result.client).toBeDefined();
    expect(result.authMode).toBe('password');

    // Cleanup
    result.disconnect();
    expect(mockNativeDisconnect).toHaveBeenCalled();
  });

  test('TOFU with pre-stored fingerprint uses it directly', async () => {
    mockSecureStoreData.set('ssh-pwd-ref-1', 'my-password');
    const target = makeSshTarget({
      trustedHostFingerprint: 'FF:EE:DD:CC:BB:AA:99:88:77:66:55:44:33:22:11:00',
    });

    const result = await connectSshTarget(target);
    // Should NOT call getHostFingerprint — fingerprint was already known
    expect(mockNativeGetHostFingerprint).not.toHaveBeenCalled();
    expect(mockNativeConnectVerifiedPassword).toHaveBeenCalledWith(
      'build.example.com',
      22,
      'deployer',
      'my-password',
      'FF:EE:DD:CC:BB:AA:99:88:77:66:55:44:33:22:11:00',
    );
    result.disconnect();
  });

  test('strict mode with fingerprint connects using verified method', async () => {
    mockSecureStoreData.set('ssh-pwd-ref-1', 'my-password');
    const target = makeSshTarget({
      hostKeyPolicy: 'strict',
      trustedHostFingerprint: 'FF:EE:DD:CC:BB:AA:99:88:77:66:55:44:33:22:11:00',
    });

    const result = await connectSshTarget(target);
    expect(mockNativeGetHostFingerprint).not.toHaveBeenCalled();
    expect(mockNativeConnectVerifiedPassword).toHaveBeenCalled();
    result.disconnect();
  });

  test('strict mode without fingerprint throws', async () => {
    mockSecureStoreData.set('ssh-pwd-ref-1', 'my-password');
    const target = makeSshTarget({
      hostKeyPolicy: 'strict',
      trustedHostFingerprint: undefined,
    });

    await expect(connectSshTarget(target)).rejects.toThrow('missing-host-fingerprint');
  });

  test('private key auth uses verified key method', async () => {
    mockSecureStoreData.set(
      'pk-ref-1',
      '-----BEGIN OPENSSH PRIVATE KEY-----\nfakekeydata\n-----END OPENSSH PRIVATE KEY-----',
    );
    const target = makeSshTarget({
      authMode: 'private-key',
      privateKeyRef: 'pk-ref-1',
      passwordRef: undefined,
      trustedHostFingerprint: 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99',
    });

    const result = await connectSshTarget(target);
    expect(mockNativeConnectVerifiedKey).toHaveBeenCalledWith(
      'build.example.com',
      22,
      'deployer',
      expect.stringContaining('BEGIN OPENSSH PRIVATE KEY'),
      undefined,
      'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99',
    );
    result.disconnect();
  });

  test('missing password secret throws missing-auth-secret', async () => {
    // Don't set the password in secure store
    const target = makeSshTarget();
    await expect(connectSshTarget(target)).rejects.toThrow('missing-auth-secret');
  });

  test('native connect failure propagates correctly', async () => {
    mockSecureStoreData.set('ssh-pwd-ref-1', 'my-password');
    mockNativeConnectVerifiedPassword.mockRejectedValue(new Error('Host key mismatch'));
    const target = makeSshTarget({
      trustedHostFingerprint: 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99',
    });

    await expect(connectSshTarget(target)).rejects.toThrow('Host key mismatch');
  });
});

describe('SSH Connector: secret resolution', () => {
  test('resolves password auth secrets', async () => {
    mockSecureStoreData.set('ssh-pwd-ref-1', 'actual-password');
    const target = makeSshTarget();
    const secrets = await resolveSshSecrets(target);
    expect(secrets.authMode).toBe('password');
    expect(secrets.password).toBe('actual-password');
  });

  test('resolves private key auth secrets with passphrase', async () => {
    mockSecureStoreData.set('pk-ref-1', 'private-key-content');
    mockSecureStoreData.set('pp-ref-1', 'my-passphrase');
    const target = makeSshTarget({
      authMode: 'private-key',
      privateKeyRef: 'pk-ref-1',
      passphraseRef: 'pp-ref-1',
    });
    const secrets = await resolveSshSecrets(target);
    expect(secrets.authMode).toBe('private-key');
    expect(secrets.privateKey).toBe('private-key-content');
    expect(secrets.passphrase).toBe('my-passphrase');
  });

  test('missing private key throws', async () => {
    const target = makeSshTarget({
      authMode: 'private-key',
      privateKeyRef: 'pk-ref-missing',
    });
    await expect(resolveSshSecrets(target)).rejects.toThrow('missing-auth-secret');
  });
});

// ========================================================================
// 2. BROWSER JOBS — LAUNCH & STOP WITH MOCKED FETCH
// ========================================================================
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

// ========================================================================
// 3. BROWSER PROVIDER PROBE WITH MOCKED FETCH
// ========================================================================
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

// ========================================================================
// 4. MCP BRIDGE — RESOURCE AND IMAGE FORMATTING
// ========================================================================
describe('MCP Bridge: content formatting edge cases', () => {
  test('formats resource content with text', () => {
    const result = formatMcpResult({
      content: [
        { type: 'resource', resource: { uri: 'file://readme.md', text: 'README contents' } },
      ],
      isError: false,
    });
    expect(result).toBe('README contents');
  });

  test('formats resource content without text', () => {
    const result = formatMcpResult({
      content: [{ type: 'resource', resource: { uri: 'file://binary.dat' } }],
      isError: false,
    });
    expect(result).toBe('[Resource: file://binary.dat]');
  });

  test('formats mixed content types', () => {
    const result = formatMcpResult({
      content: [
        { type: 'text', text: 'Here is the page:' },
        { type: 'image', mimeType: 'image/jpeg' },
        { type: 'resource', resource: { uri: 'doc.pdf', text: 'PDF text' } },
      ],
      isError: false,
    });
    expect(result).toContain('Here is the page:');
    expect(result).toContain('[Image: image/jpeg]');
    expect(result).toContain('PDF text');
  });

  test('formats empty content', () => {
    const result = formatMcpResult({ content: [], isError: false });
    expect(result).toBe('');
  });

  test('error with empty content', () => {
    const result = formatMcpResult({ content: [], isError: true });
    expect(result).toBe('Error: ');
  });
});

// ========================================================================
// 5. SETTINGS STORE — SSH/BROWSER CRUD
// ========================================================================
describe('Settings Store: SSH & Browser CRUD', () => {
  afterEach(() => {
    // Clean up added items
    const state = useSettingsStore.getState();
    for (const target of state.sshTargets || []) {
      if (target.id.startsWith('test-')) {
        state.removeSshTarget(target.id);
      }
    }
    for (const provider of state.browserProviders || []) {
      if (provider.id.startsWith('test-')) {
        state.removeBrowserProvider(provider.id);
      }
    }
  });

  test('add and retrieve SSH target', () => {
    const target: SshTargetConfig = {
      id: 'test-ssh-crud',
      name: 'CRUD Test',
      host: 'test.example.com',
      port: 2222,
      username: 'tester',
      enabled: true,
      hostKeyPolicy: 'strict',
      trustedHostFingerprint: 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99',
    };
    useSettingsStore.getState().addSshTarget(target);
    const stored = useSettingsStore.getState().sshTargets?.find((t) => t.id === 'test-ssh-crud');
    expect(stored).toBeDefined();
    expect(stored?.hostKeyPolicy).toBe('strict');
    expect(stored?.trustedHostFingerprint).toBe('AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99');
  });

  test('update SSH target preserves fingerprint', () => {
    const target: SshTargetConfig = {
      id: 'test-ssh-update',
      name: 'Update Test',
      host: 'old.example.com',
      port: 22,
      username: 'user',
      enabled: true,
      trustedHostFingerprint: 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99',
    };
    useSettingsStore.getState().addSshTarget(target);
    useSettingsStore.getState().updateSshTarget({
      ...target,
      host: 'new.example.com',
    });
    const stored = useSettingsStore.getState().sshTargets?.find((t) => t.id === 'test-ssh-update');
    expect(stored?.host).toBe('new.example.com');
    expect(stored?.trustedHostFingerprint).toBe('AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99');
  });

  test('add and retrieve browser provider', () => {
    const provider: BrowserProviderConfig = {
      id: 'test-browser-crud',
      name: 'CRUD Browser',
      provider: 'browserless',
      baseUrl: 'https://test.browserless.io',
      authMode: 'query-token',
      queryTokenParam: 'token',
      enabled: true,
    };
    useSettingsStore.getState().addBrowserProvider(provider);
    const stored = useSettingsStore
      .getState()
      .browserProviders?.find((p) => p.id === 'test-browser-crud');
    expect(stored).toBeDefined();
    expect(stored?.provider).toBe('browserless');
    expect(stored?.authMode).toBe('query-token');
  });

  test('remove SSH target', () => {
    const target: SshTargetConfig = {
      id: 'test-ssh-remove',
      name: 'Remove Test',
      host: 'remove.example.com',
      port: 22,
      username: 'user',
      enabled: true,
    };
    useSettingsStore.getState().addSshTarget(target);
    expect(
      useSettingsStore.getState().sshTargets?.find((t) => t.id === 'test-ssh-remove'),
    ).toBeDefined();
    useSettingsStore.getState().removeSshTarget('test-ssh-remove');
    expect(
      useSettingsStore.getState().sshTargets?.find((t) => t.id === 'test-ssh-remove'),
    ).toBeUndefined();
  });
});

// ========================================================================
// 6. COMMAND CENTER — WITH MCP STATUS
// ========================================================================
describe('Command Center: MCP status injection', () => {
  test('connected MCP server shows tools count and connected status', () => {
    const settings = {
      mcpServers: [
        {
          id: 'mcp-1',
          name: 'Test MCP',
          url: 'https://mcp.example.com',
          enabled: true,
        } as McpServerConfig,
      ],
      sshTargets: [],
      workspaceTargets: [],
      browserProviders: [],
    };
    const snapshot = buildRemoteCommandCenterSnapshot(settings, {
      mcpStatuses: [
        {
          id: 'mcp-1',
          state: 'connected',
          tools: [{ name: 'tool1' }, { name: 'tool2' }] as any,
          lastConnected: Date.now(),
        } as any,
      ],
    });
    const mcpTarget = snapshot.targets.find((t) => t.kind === 'mcp-server');
    expect(mcpTarget?.statusLabel).toBe('Connected');
    expect(mcpTarget?.activitySummary).toBe('2 tools online');
    expect(mcpTarget?.readiness).toBe('ready');
  });

  test('error state MCP server shows attention required', () => {
    const settings = {
      mcpServers: [
        {
          id: 'mcp-err',
          name: 'Error MCP',
          url: 'https://mcp.example.com',
          enabled: true,
        } as McpServerConfig,
      ],
      sshTargets: [],
      workspaceTargets: [],
      browserProviders: [],
    };
    const snapshot = buildRemoteCommandCenterSnapshot(settings, {
      mcpStatuses: [
        {
          id: 'mcp-err',
          state: 'error',
          error: 'Connection refused',
          tools: [],
        } as any,
      ],
    });
    const mcpTarget = snapshot.targets.find((t) => t.kind === 'mcp-server');
    expect(mcpTarget?.statusLabel).toBe('Attention required');
    expect(mcpTarget?.readiness).toBe('error');
    expect(mcpTarget?.error).toBe('Connection refused');
  });
});

// ========================================================================
// 7. FINGERPRINT NORMALIZATION EDGE CASES
// ========================================================================
describe('SSH: fingerprint normalization edge cases', () => {
  test('fingerprint with dashes is normalized to colons', () => {
    const target = makeSshTarget({
      hostKeyPolicy: 'strict',
      trustedHostFingerprint: 'aa-bb-cc-dd-ee-ff-00-11-22-33-44-55-66-77-88-99',
    });
    const readiness = getSshTargetReadiness(target);
    expect(readiness.launchable).toBe(true);
  });

  test('fingerprint with lowercase is still valid', () => {
    const target = makeSshTarget({
      hostKeyPolicy: 'strict',
      trustedHostFingerprint: 'aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:99',
    });
    const readiness = getSshTargetReadiness(target);
    expect(readiness.launchable).toBe(true);
  });

  test('empty fingerprint string treated as missing', () => {
    const target = makeSshTarget({
      hostKeyPolicy: 'strict',
      trustedHostFingerprint: '   ',
    });
    const readiness = getSshTargetReadiness(target);
    expect(readiness.launchable).toBe(false);
    expect(readiness.reason).toBe('missing-host-fingerprint');
  });
});
