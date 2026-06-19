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
import { getSshTargetReadiness } from '../../src/services/ssh/connector';
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
beforeEach(() => {
  resetRemoteStore();
  mockSecureStore.clear();
  jest.clearAllMocks();
});

describe('SSH Connector: readiness checks', () => {
  test('enabled target with password is ready', () => {
    const target = makeSshTarget();
    const result = getSshTargetReadiness(target);
    expect(result.launchable).toBe(true);
    expect(result.reason).toBe('ready');
  });

  test('disabled target is not launchable', () => {
    const result = getSshTargetReadiness(makeSshTarget({ enabled: false }));
    expect(result.launchable).toBe(false);
    expect(result.reason).toBe('disabled');
  });

  test('missing host', () => {
    const result = getSshTargetReadiness(makeSshTarget({ host: '' }));
    expect(result.reason).toBe('missing-host');
  });

  test('missing username', () => {
    const result = getSshTargetReadiness(makeSshTarget({ username: '' }));
    expect(result.reason).toBe('missing-username');
  });

  test('strict mode without fingerprint is not ready', () => {
    const result = getSshTargetReadiness(
      makeSshTarget({
        hostKeyPolicy: 'strict',
        trustedHostFingerprint: undefined,
      }),
    );
    expect(result.launchable).toBe(false);
    expect(result.reason).toBe('missing-host-fingerprint');
  });

  test('strict mode with fingerprint is ready', () => {
    const result = getSshTargetReadiness(
      makeSshTarget({
        hostKeyPolicy: 'strict',
        trustedHostFingerprint: 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99',
      }),
    );
    expect(result.launchable).toBe(true);
    expect(result.reason).toBe('ready');
  });

  test('TOFU mode without fingerprint is still ready', () => {
    const result = getSshTargetReadiness(
      makeSshTarget({
        hostKeyPolicy: 'trust-on-first-use',
        trustedHostFingerprint: undefined,
      }),
    );
    expect(result.launchable).toBe(true);
    expect(result.reason).toBe('ready');
  });

  test('missing password ref for password auth', () => {
    const result = getSshTargetReadiness(
      makeSshTarget({ authMode: 'password', passwordRef: undefined }),
    );
    expect(result.reason).toBe('missing-auth-secret');
  });

  test('missing private key ref for key auth', () => {
    const result = getSshTargetReadiness(
      makeSshTarget({ authMode: 'private-key', privateKeyRef: undefined }),
    );
    expect(result.reason).toBe('missing-auth-secret');
  });

  test('private key auth with ref is ready', () => {
    const result = getSshTargetReadiness(
      makeSshTarget({
        authMode: 'private-key',
        privateKeyRef: 'pk-ref-1',
      }),
    );
    expect(result.launchable).toBe(true);
  });
});
