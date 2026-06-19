jest.mock('@dylankenneally/react-native-ssh-sftp', () => {
  const mockClient = {
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
    disconnect: jest.fn(),
  };
  return {
    __esModule: true,
    default: {
      connectWithPassword: jest.fn().mockResolvedValue(mockClient),
      connectWithKey: jest.fn().mockResolvedValue(mockClient),
      connectWithVerifiedPassword: jest.fn().mockResolvedValue(mockClient),
      connectWithVerifiedKey: jest.fn().mockResolvedValue(mockClient),
      getHostFingerprint: jest
        .fn()
        .mockResolvedValue('AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99'),
    },
    PtyType: {
      VANILLA: 'vanilla',
      VT100: 'vt100',
      VT102: 'vt102',
      VT220: 'vt220',
      ANSI: 'ansi',
      XTERM: 'xterm',
    },
  };
});
const mockSecureStore = new Map<string, string>();
jest.mock('../../src/services/storage/SecureStorage', () => ({
  getSecure: jest.fn(async (key: string) => mockSecureStore.get(key) ?? null),
  setSecure: jest.fn(async (key: string, value: string) => {
    mockSecureStore.set(key, value);
  }),
  deleteSecure: jest.fn(async (key: string) => {
    mockSecureStore.delete(key);
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
import { resetRemoteStore } from '../../src/services/remote/store';
import { isValidBrowserProviderBaseUrl, applyBrowserProviderPreset, BROWSER_PROVIDER_PRESETS } from '../../src/services/browser/providers/registry';
import { resolveBrowserProviderConnection, withBrowserProviderAuth } from '../../src/services/browser/providers/connection';
import { getBrowserProviderReadiness } from '../../src/services/browser/providers/readiness';
import { getBrowserProviderLabel, getBrowserProviderAuthLabel, getBrowserProviderAuthHint } from '../../src/services/browser/providers/labels';
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
beforeEach(() => {
  resetRemoteStore();
  mockSecureStore.clear();
  jest.clearAllMocks();
});

describe('Browser Provider: readiness checks', () => {
  test('Browserbase requires project ID', () => {
    const config = makeBrowserProvider({ projectId: '' });
    expect(getBrowserProviderReadiness(config).reason).toBe('missing-project-id');
  });

  test('Browserbase ready with full config', () => {
    const config = makeBrowserProvider();
    expect(getBrowserProviderReadiness(config).reason).toBe('ready');
    expect(getBrowserProviderReadiness(config).launchable).toBe(true);
  });

  test('disabled provider is not launchable', () => {
    const config = makeBrowserProvider({ enabled: false });
    expect(getBrowserProviderReadiness(config).reason).toBe('disabled');
    expect(getBrowserProviderReadiness(config).launchable).toBe(false);
  });

  test('missing base URL for custom provider', () => {
    const config = makeBrowserProvider({ provider: 'custom', baseUrl: '' });
    expect(getBrowserProviderReadiness(config).reason).toBe('missing-base-url');
  });

  test('invalid base URL is caught', () => {
    const config = makeBrowserProvider({ baseUrl: 'not-a-url' });
    expect(getBrowserProviderReadiness(config).reason).toBe('invalid-base-url');
  });

  test('missing API key for non-none auth', () => {
    const config = makeBrowserProvider({ apiKeyRef: '', authMode: 'api-key-header' });
    expect(getBrowserProviderReadiness(config).reason).toBe('missing-api-key');
  });

  test('none auth does not require API key', () => {
    const config = makeBrowserProvider({ authMode: 'none', apiKeyRef: '' });
    expect(getBrowserProviderReadiness(config).reason).toBe('ready');
  });

  test('Browserless defaults fill in correctly', () => {
    const config: BrowserProviderConfig = {
      id: 'bl-1',
      name: 'BL',
      provider: 'browserless',
      apiKeyRef: 'bl-key',
      enabled: true,
    };
    const readiness = getBrowserProviderReadiness(config);
    expect(readiness.launchable).toBe(true);
  });
});

describe('Browser Provider: URL validation', () => {
  test('valid HTTPS URL', () => {
    expect(isValidBrowserProviderBaseUrl('https://api.browserbase.com')).toBe(true);
  });
  test('valid HTTP URL', () => {
    expect(isValidBrowserProviderBaseUrl('http://localhost:3000')).toBe(true);
  });
  test('empty string', () => {
    expect(isValidBrowserProviderBaseUrl('')).toBe(false);
  });
  test('ftp URL rejected', () => {
    expect(isValidBrowserProviderBaseUrl('ftp://server.com')).toBe(false);
  });
  test('bare hostname rejected', () => {
    expect(isValidBrowserProviderBaseUrl('server.com')).toBe(false);
  });
});

describe('Browser Provider: labels and hints', () => {
  test('provider labels', () => {
    expect(getBrowserProviderLabel('browserbase')).toBe('Browserbase');
    expect(getBrowserProviderLabel('browserless')).toBe('Browserless');
    expect(getBrowserProviderLabel('custom')).toBe('Custom Browser Worker');
    expect(getBrowserProviderLabel(undefined)).toBe('Browserbase');
  });

  test('auth labels', () => {
    expect(getBrowserProviderAuthLabel('none')).toBe('No auth');
    expect(getBrowserProviderAuthLabel('bearer')).toBe('Bearer token');
    expect(getBrowserProviderAuthLabel('query-token')).toBe('Query token');
    expect(getBrowserProviderAuthLabel('api-key-header')).toBe('API key header');
    expect(getBrowserProviderAuthLabel(undefined)).toBe('API key header');
  });

  test('auth hints vary by provider and mode', () => {
    const bbHint = getBrowserProviderAuthHint(makeBrowserProvider());
    expect(bbHint).toContain('X-BB-API-Key');

    const blHint = getBrowserProviderAuthHint(
      makeBrowserProvider({ provider: 'browserless', authMode: 'query-token' }),
    );
    expect(blHint).toContain('query string');

    const bearerHint = getBrowserProviderAuthHint(
      makeBrowserProvider({ provider: 'custom', authMode: 'bearer' }),
    );
    expect(bearerHint).toContain('Bearer');

    const noneHint = getBrowserProviderAuthHint(
      makeBrowserProvider({ provider: 'custom', authMode: 'none' }),
    );
    expect(noneHint).toContain('No authentication');
  });
});

describe('Browser Provider: presets', () => {
  test('all presets have required fields', () => {
    for (const preset of BROWSER_PROVIDER_PRESETS) {
      expect(preset.id).toBeTruthy();
      expect(preset.label).toBeTruthy();
      expect(preset.provider).toBeTruthy();
      expect(preset.baseUrl).toBeTruthy();
      expect(preset.authMode).toBeTruthy();
      expect(preset.name).toBeTruthy();
    }
  });

  test('applying Browserbase preset sets correct defaults', () => {
    const config: BrowserProviderConfig = {
      id: 'test',
      name: 'old',
      enabled: true,
      projectId: 'my-project',
    };
    const applied = applyBrowserProviderPreset(config, 'browserbase-default');
    expect(applied.provider).toBe('browserbase');
    expect(applied.baseUrl).toBe('https://api.browserbase.com');
    expect(applied.authMode).toBe('api-key-header');
    expect(applied.projectId).toBe('my-project'); // kept
    expect(applied.name).toBe('Primary Browserbase');
  });

  test('applying Browserless SFO preset sets query-token auth', () => {
    const config: BrowserProviderConfig = {
      id: 'test',
      name: 'old',
      enabled: true,
    };
    const applied = applyBrowserProviderPreset(config, 'browserless-sfo');
    expect(applied.provider).toBe('browserless');
    expect(applied.authMode).toBe('query-token');
    expect(applied.queryTokenParam).toBe('token');
    expect(applied.baseUrl).toContain('production-sfo');
  });

  test('applying unknown preset returns config unchanged', () => {
    const config = makeBrowserProvider();
    const applied = applyBrowserProviderPreset(config, 'nonexistent-preset');
    expect(applied).toEqual(config);
  });
});

describe('Browser Provider: connection resolution', () => {
  test('resolves Browserbase connection with API key from secure store', async () => {
    mockSecureStore.set('bb-key-ref-1', 'my-secret-key');
    const config = makeBrowserProvider();
    const conn = await resolveBrowserProviderConnection(config);
    expect(conn.provider).toBe('browserbase');
    expect(conn.authMode).toBe('api-key-header');
    expect(conn.baseUrl).toBe('https://api.browserbase.com');
    expect(conn.token).toBe('my-secret-key');
  });

  test('resolves Browserless connection with query token', async () => {
    mockSecureStore.set('bl-key', 'my-bl-token');
    const config: BrowserProviderConfig = {
      id: 'bl-1',
      name: 'Browserless',
      provider: 'browserless',
      authMode: 'query-token',
      apiKeyRef: 'bl-key',
      queryTokenParam: 'token',
      enabled: true,
    };
    const conn = await resolveBrowserProviderConnection(config);
    expect(conn.provider).toBe('browserless');
    expect(conn.authMode).toBe('query-token');
    expect(conn.token).toBe('my-bl-token');
    expect(conn.queryTokenParam).toBe('token');
  });

  test('connection with no apiKeyRef resolves token to null', async () => {
    const config = makeBrowserProvider({ apiKeyRef: undefined });
    const conn = await resolveBrowserProviderConnection(config);
    expect(conn.token).toBeNull();
  });
});

describe('Browser Provider: withBrowserProviderAuth', () => {
  test('api-key-header sets custom header', () => {
    const result = withBrowserProviderAuth(
      'https://api.browserbase.com/v1/sessions',
      { authMode: 'api-key-header', token: 'my-key', queryTokenParam: 'token' },
      'X-BB-API-Key',
    );
    expect(result.headers?.['X-BB-API-Key']).toBe('my-key');
    expect(result.url).toBe('https://api.browserbase.com/v1/sessions');
  });

  test('query-token appends to URL', () => {
    const result = withBrowserProviderAuth('https://chrome.browserless.io/session', {
      authMode: 'query-token',
      token: 'my-token',
      queryTokenParam: 'token',
    });
    expect(result.url).toContain('token=my-token');
    expect(result.headers).toBeUndefined();
  });

  test('bearer sets Authorization header', () => {
    const result = withBrowserProviderAuth('https://worker.example.com/session', {
      authMode: 'bearer',
      token: 'jwt-token',
      queryTokenParam: 'token',
    });
    expect(result.headers?.Authorization).toBe('Bearer jwt-token');
    expect(result.url).toBe('https://worker.example.com/session');
  });

  test('none auth leaves URL and headers untouched', () => {
    const result = withBrowserProviderAuth('https://worker.example.com/session', {
      authMode: 'none',
      token: null,
      queryTokenParam: 'token',
    });
    expect(result.url).toBe('https://worker.example.com/session');
    expect(result.headers).toBeUndefined();
  });

  test('query-token with no token does not add param', () => {
    const result = withBrowserProviderAuth('https://chrome.browserless.io/session', {
      authMode: 'query-token',
      token: null,
      queryTokenParam: 'token',
    });
    expect(result.url).not.toContain('token=');
  });
});
