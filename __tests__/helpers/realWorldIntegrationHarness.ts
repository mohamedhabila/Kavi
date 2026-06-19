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

export const mockSecureStore = new Map<string, string>();
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
    get exists() {
      return true;
    }
    list() {
      return [];
    }
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

import type {
  SshTargetConfig,
  BrowserProviderConfig,
  McpServerConfig,
  WorkspaceTargetConfig,
} from '../../src/types/remote';
import type { SkillMetadata, SkillEntry } from '../../src/services/skills/types';

export function makeSshTarget(overrides: Partial<SshTargetConfig> = {}): SshTargetConfig {
  return {
    id: 'ssh-test',
    name: 'Test Server',
    host: 'server.example.com',
    port: 22,
    username: 'deploy',
    enabled: true,
    authMode: 'password',
    passwordRef: 'ssh-pwd-ref',
    hostKeyPolicy: 'trust-on-first-use',
    ...overrides,
  };
}

export function makeBrowserProvider(
  overrides: Partial<BrowserProviderConfig> = {},
): BrowserProviderConfig {
  return {
    id: 'bb-test',
    name: 'Browserbase Test',
    provider: 'browserbase',
    enabled: true,
    baseUrl: 'https://api.browserbase.com',
    authMode: 'api-key-header',
    apiKeyRef: 'bb-key-ref',
    projectId: 'test-project-id',
    ...overrides,
  };
}

export function makeWorkspaceTarget(
  overrides: Partial<WorkspaceTargetConfig> = {},
): WorkspaceTargetConfig {
  return {
    id: 'ws-test',
    name: 'Dev Workspace',
    enabled: true,
    provider: 'code-server',
    baseUrl: 'https://code.example.com',
    rootPath: '/home/user/project',
    authMode: 'bearer',
    accessTokenRef: 'ws-token-ref',
    ...overrides,
  };
}

export function makeMcpServer(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: 'mcp-test',
    name: 'Test MCP',
    url: 'https://mcp.example.com/sse',
    enabled: true,
    tools: [],
    allowedTools: [],
    ...overrides,
  };
}

export function makeSkillMetadata(overrides: Partial<SkillMetadata> = {}): SkillMetadata {
  return {
    name: 'test-skill',
    description: 'A test skill',
    version: '1.0.0',
    ...overrides,
  } as SkillMetadata;
}

export function makeSkillEntry(overrides: Partial<SkillEntry> = {}): SkillEntry {
  return {
    id: 'skill-entry-test',
    enabled: true,
    metadata: makeSkillMetadata(),
    systemPrompt: 'You are a test skill assistant.',
    source: { kind: 'manual' },
    installedAt: Date.now(),
    ...overrides,
  } as SkillEntry;
}
