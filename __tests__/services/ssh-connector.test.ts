const mockSecureValues: Record<string, string> = {};
const mockFileStore: Record<string, string> = {};
const mockDirectoryStore = new Set<string>();

function createExpoFileSystemMock() {
  class MockDirectory {
    uri: string;
    name: string;

    constructor(...parts: any[]) {
      const normalized = parts
        .map((part) => {
          if (typeof part === 'string') return part;
          if (part && typeof part.uri === 'string') return part.uri;
          return '';
        })
        .filter(Boolean);
      this.uri = normalized.join('/').replace(/\/+/g, '/');
      this.name = this.uri.split('/').pop() || 'dir';
    }

    get exists() {
      return mockDirectoryStore.has(this.uri);
    }

    create() {
      mockDirectoryStore.add(this.uri);
    }

    delete() {
      mockDirectoryStore.delete(this.uri);
      Object.keys(mockFileStore).forEach((key) => {
        if (key === this.uri || key.startsWith(`${this.uri}/`)) {
          delete mockFileStore[key];
        }
      });
    }
  }

  class MockFile {
    uri: string;
    name: string;

    constructor(...parts: any[]) {
      const normalized = parts
        .map((part) => {
          if (typeof part === 'string') return part;
          if (part && typeof part.uri === 'string') return part.uri;
          return '';
        })
        .filter(Boolean);
      this.uri = normalized.join('/').replace(/\/+/g, '/');
      this.name = this.uri.split('/').pop() || 'file';
    }

    get exists() {
      return Object.prototype.hasOwnProperty.call(mockFileStore, this.uri);
    }

    async text() {
      return mockFileStore[this.uri] || '';
    }

    write(content: string) {
      mockFileStore[this.uri] = content;
    }

    delete() {
      delete mockFileStore[this.uri];
    }
  }

  return {
    Paths: { cache: { uri: 'file:///mock/cache' } },
    Directory: MockDirectory,
    File: MockFile,
    __resetStore: () => {
      Object.keys(mockFileStore).forEach((key) => delete mockFileStore[key]);
      mockDirectoryStore.clear();
    },
    __getStore: () => mockFileStore,
  };
}

const mockConnectWithPassword = jest.fn();
const mockConnectWithKey = jest.fn();
const mockGetHostFingerprint = jest.fn();
const shellHandlers: Record<string, ((event: any) => void) | undefined> = {};

jest.mock('../../src/services/ssh/native', () => ({
  connectNativeSshWithPassword: (...args: any[]) => mockConnectWithPassword(...args),
  connectNativeSshWithKey: (...args: any[]) => mockConnectWithKey(...args),
  connectNativeSshWithVerifiedPassword: (...args: any[]) => mockConnectWithPassword(...args),
  connectNativeSshWithVerifiedKey: (...args: any[]) => mockConnectWithKey(...args),
  getNativeSshHostFingerprint: (...args: any[]) => mockGetHostFingerprint(...args),
  getSshAuthMode: (target: any) => target.authMode || 'password',
  getSshPtyType: (target: any) => target.ptyType || 'xterm',
  isNativeSshSupported: () => true,
  supportsVerifiedSshConnections: () => true,
  SSH_SHELL_EVENT: 'Shell',
}));

jest.mock('../../src/services/storage/SecureStorage', () => ({
  getSecure: jest.fn(async (key: string) => mockSecureValues[key] || ''),
  deleteSecure: jest.fn(async (key: string) => {
    delete mockSecureValues[key];
  }),
}));

jest.mock('../../src/store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      sshTargets: [
        {
          id: 'ssh-1',
          name: 'Build box',
          host: 'ssh.example.com',
          port: 22,
          username: 'developer',
          authMode: 'password',
          passwordRef: 'ssh_password_ssh-1',
          enabled: true,
        },
      ],
    }),
  },
}));

type SshConnectorModule = typeof import('../../src/services/ssh/connector');
type ExpoFileSystemMock = ReturnType<typeof createExpoFileSystemMock>;

let connectSshTarget: SshConnectorModule['connectSshTarget'];
let executeSshCommand: SshConnectorModule['executeSshCommand'];
let getSshTargetReadiness: SshConnectorModule['getSshTargetReadiness'];
let listSshDirectory: SshConnectorModule['listSshDirectory'];
let openSshShell: SshConnectorModule['openSshShell'];
let readSshTextFile: SshConnectorModule['readSshTextFile'];
let resolveSshTarget: SshConnectorModule['resolveSshTarget'];
let writeSshTextFile: SshConnectorModule['writeSshTextFile'];
let expoFileSystem: ExpoFileSystemMock;

describe('ssh connector', () => {
  const mockClient = {
    on: jest.fn((eventName: string, handler: (event: any) => void) => {
      shellHandlers[eventName] = handler;
    }),
    execute: jest.fn(),
    startShell: jest.fn().mockResolvedValue(''),
    writeToShell: jest.fn().mockResolvedValue(''),
    closeShell: jest.fn(),
    sftpLs: jest.fn(),
    sftpDownload: jest.fn(),
    sftpUpload: jest.fn(),
    sftpRename: jest.fn(),
    sftpRm: jest.fn(),
    sftpRmdir: jest.fn(),
    disconnect: jest.fn(),
  };

  beforeEach(() => {
    jest.resetModules();
    expoFileSystem = jest.requireMock('expo-file-system') as ExpoFileSystemMock;
    ({
      connectSshTarget,
      executeSshCommand,
      getSshTargetReadiness,
      listSshDirectory,
      openSshShell,
      readSshTextFile,
      resolveSshTarget,
      writeSshTextFile,
    } = require('../../src/services/ssh/connector') as SshConnectorModule);
    jest.clearAllMocks();
    Object.keys(shellHandlers).forEach((key) => {
      delete shellHandlers[key];
    });
    expoFileSystem.__resetStore?.();
    Object.keys(mockSecureValues).forEach((key) => delete mockSecureValues[key]);
    mockSecureValues.ssh_password_ssh_1 = 'wrong';
    mockSecureValues['ssh_password_ssh-1'] = 'top-secret';
    mockGetHostFingerprint.mockResolvedValue('AA:BB:CC:DD');
    mockConnectWithPassword.mockResolvedValue(mockClient);
    mockConnectWithKey.mockResolvedValue(mockClient);
    mockClient.execute.mockResolvedValue('/home/user\n');
    mockClient.sftpLs.mockResolvedValue([]);
    mockClient.sftpDownload.mockResolvedValue('');
    mockClient.sftpUpload.mockResolvedValue(undefined);
    mockClient.sftpRename.mockResolvedValue(undefined);
  });

  it('requires configured credentials for readiness', () => {
    expect(
      getSshTargetReadiness({
        id: 'ssh-2',
        name: 'No secret',
        host: 'host',
        port: 22,
        username: 'user',
        authMode: 'password',
        enabled: true,
      }),
    ).toEqual({ launchable: false, reason: 'missing-auth-secret' });
  });

  it('fails closed when verified fingerprint transport support is unavailable', () => {
    const nativeModule = jest.requireMock('../../src/services/ssh/native');
    nativeModule.supportsVerifiedSshConnections = () => false;

    expect(
      getSshTargetReadiness({
        id: 'ssh-2',
        name: 'No verified transport',
        host: 'host',
        port: 22,
        username: 'user',
        authMode: 'password',
        passwordRef: 'ssh_password_ssh-2',
        enabled: true,
      }),
    ).toEqual({ launchable: false, reason: 'missing-verified-transport' });

    nativeModule.supportsVerifiedSshConnections = () => true;
  });

  it('connects with password auth', async () => {
    const target = await resolveSshTarget('ssh-1');
    const connection = await connectSshTarget(target);
    expect(mockGetHostFingerprint).toHaveBeenCalledWith(target);
    expect(mockConnectWithPassword).toHaveBeenCalledWith(target, 'top-secret', 'AA:BB:CC:DD');
    connection.disconnect();
    expect(mockClient.disconnect).toHaveBeenCalled();
  });

  it('requires a fingerprint in strict mode', () => {
    expect(
      getSshTargetReadiness({
        id: 'ssh-2',
        name: 'Strict host',
        host: 'host',
        port: 22,
        username: 'user',
        authMode: 'password',
        passwordRef: 'ssh_password_ssh-2',
        hostKeyPolicy: 'strict',
        enabled: true,
      }),
    ).toEqual({ launchable: false, reason: 'missing-host-fingerprint' });
  });

  it('executes remote commands through a shell wrapper', async () => {
    const target = await resolveSshTarget('ssh-1');
    const output = await executeSshCommand(target, 'pwd', '/srv/app');
    expect(mockClient.execute).toHaveBeenCalledWith(expect.stringContaining('/srv/app'));
    expect(mockClient.execute).toHaveBeenCalledWith(expect.stringContaining('pwd'));
    expect(output).toContain('/home/user');
    expect(mockClient.disconnect).toHaveBeenCalled();
  });

  it('uploads files to the parent directory and renames them into place', async () => {
    const target = await resolveSshTarget('ssh-1');
    await writeSshTextFile(target, '/srv/app/.env', 'TOKEN=1');

    expect(mockClient.execute).toHaveBeenCalledWith(expect.stringContaining('mkdir -p'));
    expect(mockClient.execute).toHaveBeenCalledWith(expect.stringContaining('/srv/app'));
    expect(mockClient.sftpUpload).toHaveBeenCalledWith(
      expect.stringMatching(/^\/mock\/cache\/ssh\/.*-\.env$/),
      '/srv/app',
    );
    expect(mockClient.sftpRename).toHaveBeenCalledWith(
      expect.stringMatching(/\/srv\/app\/.*-\.env$/),
      '/srv/app/.env',
    );
    expect(mockClient.disconnect).toHaveBeenCalled();
  });

  it('downloads remote text files into a temp directory using native local paths', async () => {
    mockClient.sftpDownload.mockImplementation(
      async (remotePath: string, localFilePath: string) => {
        new expoFileSystem.File(localFilePath).write('TOKEN=1');
        return localFilePath;
      },
    );

    const target = await resolveSshTarget('ssh-1');
    const content = await readSshTextFile(target, '/srv/app/.env');

    expect(mockClient.sftpDownload).toHaveBeenCalledWith(
      '/srv/app/.env',
      expect.stringMatching(/^\/mock\/cache\/ssh\/[^\s]+\/\.env$/),
    );
    expect(content).toBe('TOKEN=1');
    expect(mockClient.disconnect).toHaveBeenCalled();
  });

  it('normalizes SSH directory listings for the file browser', async () => {
    mockClient.sftpLs.mockResolvedValue([
      {
        filename: '.',
        isDirectory: true,
        modificationDate: '',
        lastAccess: '',
        fileSize: 0,
        ownerUserID: 0,
        ownerGroupID: 0,
        flags: 0,
      },
      {
        filename: '..',
        isDirectory: true,
        modificationDate: '',
        lastAccess: '',
        fileSize: 0,
        ownerUserID: 0,
        ownerGroupID: 0,
        flags: 0,
      },
      {
        filename: 'src/',
        isDirectory: true,
        modificationDate: '',
        lastAccess: '',
        fileSize: 0,
        ownerUserID: 0,
        ownerGroupID: 0,
        flags: 0,
      },
      {
        filename: 'App.tsx',
        isDirectory: false,
        modificationDate: '',
        lastAccess: '',
        fileSize: 12,
        ownerUserID: 0,
        ownerGroupID: 0,
        flags: 0,
      },
    ]);

    const target = await resolveSshTarget('ssh-1');
    const entries = await listSshDirectory(target, '.');

    expect(entries.map((entry) => entry.filename)).toEqual(['src', 'App.tsx']);
  });

  it('treats root-level relative SSH paths as home-relative when saving', async () => {
    const target = await resolveSshTarget('ssh-1');
    await writeSshTextFile(target, 'App.tsx', 'console.log(1);');

    expect(mockClient.execute).toHaveBeenCalledWith(expect.stringContaining('mkdir -p'));
    expect(mockClient.sftpUpload).toHaveBeenCalledWith(
      expect.stringMatching(/^\/mock\/cache\/ssh\/.*-App\.tsx$/),
      '.',
    );
    expect(mockClient.sftpRename).toHaveBeenCalledWith(
      expect.stringMatching(/^\.\/.*-App\.tsx$/),
      'App.tsx',
    );
  });

  it('opens interactive shells with streamed output and best-effort cleanup', async () => {
    const target = await resolveSshTarget('ssh-1');
    const onData = jest.fn();
    const shell = await openSshShell(target, onData);

    expect(mockClient.on).toHaveBeenCalledWith('Shell', expect.any(Function));
    expect(mockClient.startShell).toHaveBeenCalledWith('xterm');

    shellHandlers.Shell?.({ value: 'pwd\n' });
    expect(onData).toHaveBeenCalledWith('pwd\n');

    await shell.write('ls\n');
    expect(mockClient.writeToShell).toHaveBeenCalledWith('ls\n');

    shell.close();
    expect(mockClient.closeShell).toHaveBeenCalled();
    expect(mockClient.disconnect).toHaveBeenCalled();
  });

  it('requires a target id when multiple SSH targets are enabled', async () => {
    const module = jest.requireMock('../../src/store/useSettingsStore');
    module.useSettingsStore.getState = () => ({
      sshTargets: [
        {
          id: 'a',
          name: 'A',
          host: 'a',
          port: 22,
          username: 'u',
          authMode: 'password',
          passwordRef: 'a',
          enabled: true,
        },
        {
          id: 'b',
          name: 'B',
          host: 'b',
          port: 22,
          username: 'u',
          authMode: 'password',
          passwordRef: 'b',
          enabled: true,
        },
      ],
    });

    await expect(resolveSshTarget()).rejects.toThrow('ssh-target-id-required');
  });
});
