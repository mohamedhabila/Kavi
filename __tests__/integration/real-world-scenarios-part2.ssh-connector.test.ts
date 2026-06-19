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
import { connectSshTarget, resolveSshSecrets } from '../../src/services/ssh/connector';
import { connectNativeSshWithKey, connectNativeSshWithPassword, connectNativeSshWithVerifiedKey, connectNativeSshWithVerifiedPassword, getNativeSshCapabilities, getNativeSshHostFingerprint, getSshAuthMode, getSshPtyType, supportsVerifiedSshConnections } from '../../src/services/ssh/native';
import type { SshTargetConfig } from '../../src/types/remote';
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
