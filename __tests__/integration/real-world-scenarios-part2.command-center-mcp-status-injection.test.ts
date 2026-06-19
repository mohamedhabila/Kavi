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
import { getSshTargetReadiness } from '../../src/services/ssh/connector';
import { buildRemoteCommandCenterSnapshot } from '../../src/services/remote/commandCenter';
import type { SshTargetConfig, McpServerConfig } from '../../src/types/remote';
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
