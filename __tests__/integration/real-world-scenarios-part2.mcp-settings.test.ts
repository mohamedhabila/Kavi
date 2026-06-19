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
import { resetRemoteStore } from '../../src/services/remote/store';
import { formatMcpResult } from '../../src/services/mcp/bridge';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import type { SshTargetConfig, BrowserProviderConfig } from '../../src/types/remote';
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
