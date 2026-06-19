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
import { useRemoteStore, resetRemoteStore, startRemoteJob, openRemoteSession } from '../../src/services/remote/store';
import { executeMcpTool } from '../../src/services/mcp/bridge';
import { getSshHostKeyPolicy, getSshHostKeyPolicyLabel, getSshHostFingerprint } from '../../src/services/ssh/connector';
import { buildRemoteCommandCenterSnapshot } from '../../src/services/remote/commandCenter';
import { resolveSkillExecutionPlan } from '../../src/services/skills/routing';
import { buildSkillEligibilityContext } from '../../src/services/skills/eligibility';
import type { SshTargetConfig, BrowserProviderConfig, McpServerConfig } from '../../src/types/remote';
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
function makeMcpServer(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: 'mcp-1',
    name: 'Test MCP Server',
    url: 'https://mcp.example.com',
    enabled: true,
    ...overrides,
  } as McpServerConfig;
}
beforeEach(() => {
  resetRemoteStore();
  mockSecureStore.clear();
  jest.clearAllMocks();
});

describe('SSH Connector: host key policy helpers', () => {
  test('getSshHostKeyPolicy defaults to TOFU', () => {
    expect(getSshHostKeyPolicy({})).toBe('trust-on-first-use');
    expect(getSshHostKeyPolicy({ hostKeyPolicy: 'strict' })).toBe('strict');
  });

  test('getSshHostKeyPolicyLabel returns human labels', () => {
    expect(getSshHostKeyPolicyLabel({})).toBe('Trust on first use');
    expect(getSshHostKeyPolicyLabel({ hostKeyPolicy: 'strict' })).toBe('Strict fingerprint');
  });

  test('getSshHostFingerprint calls native and normalizes', async () => {
    const fingerprint = await getSshHostFingerprint({
      host: 'build.example.com',
      port: 22,
      username: 'deployer',
    });
    expect(fingerprint).toBe('AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99');
  });
});

describe('Remote Command Center: snapshot building', () => {
  test('builds correct snapshot with all target types', () => {
    const settings = {
      mcpServers: [makeMcpServer()],
      sshTargets: [makeSshTarget()],
      workspaceTargets: [],
      browserProviders: [makeBrowserProvider()],
    };
    const snapshot = buildRemoteCommandCenterSnapshot(settings);
    expect(snapshot.targets.length).toBe(3);
    expect(snapshot.targets.find((t) => t.kind === 'mcp-server')).toBeDefined();
    expect(snapshot.targets.find((t) => t.kind === 'ssh-host')).toBeDefined();
    expect(snapshot.targets.find((t) => t.kind === 'browser-provider')).toBeDefined();
    // MCP with no status object → setup-required (not yet connected)
    expect(snapshot.readyCounts.mcp).toBe(0);
    expect(snapshot.readyCounts.ssh).toBe(1);
    expect(snapshot.readyCounts.browser).toBe(1);
    expect(snapshot.enabledCounts.mcp).toBe(1);
    expect(snapshot.enabledCounts.ssh).toBe(1);
    expect(snapshot.enabledCounts.browser).toBe(1);
  });

  test('disabled targets show correct readiness', () => {
    const settings = {
      mcpServers: [makeMcpServer({ enabled: false })],
      sshTargets: [makeSshTarget({ enabled: false })],
      workspaceTargets: [],
      browserProviders: [makeBrowserProvider({ enabled: false })],
    };
    const snapshot = buildRemoteCommandCenterSnapshot(settings);
    expect(snapshot.readyCounts.mcp).toBe(0);
    expect(snapshot.readyCounts.ssh).toBe(0);
    expect(snapshot.readyCounts.browser).toBe(0);
  });

  test('empty settings produces empty snapshot', () => {
    const snapshot = buildRemoteCommandCenterSnapshot({
      mcpServers: [],
      sshTargets: [],
      workspaceTargets: [],
      browserProviders: [],
    });
    expect(snapshot.targets).toHaveLength(0);
    expect(snapshot.sessions).toHaveLength(0);
  });

  test('SSH target with strict mode and missing fingerprint shows setup-required', () => {
    const target = makeSshTarget({
      hostKeyPolicy: 'strict',
      trustedHostFingerprint: undefined,
    });
    const snapshot = buildRemoteCommandCenterSnapshot({
      mcpServers: [],
      sshTargets: [target],
      workspaceTargets: [],
      browserProviders: [],
    });
    const sshRecord = snapshot.targets.find((t) => t.kind === 'ssh-host');
    expect(sshRecord?.readiness).toBe('setup-required');
    expect(sshRecord?.launchable).toBe(false);
  });

  test('browser provider with missing API key shows setup-required', () => {
    const provider = makeBrowserProvider({ apiKeyRef: '' });
    const snapshot = buildRemoteCommandCenterSnapshot({
      mcpServers: [],
      sshTargets: [],
      workspaceTargets: [],
      browserProviders: [provider],
    });
    const record = snapshot.targets.find((t) => t.kind === 'browser-provider');
    expect(record?.readiness).toBe('setup-required');
  });
});

describe('Skill Routing: real configuration scenarios', () => {
  const baseSettings = {
    mcpServers: [makeMcpServer()],
    sshTargets: [makeSshTarget()],
    workspaceTargets: [],
    browserProviders: [makeBrowserProvider()],
  };

  test('skill requiring browser-job surfaces routes to browser provider', () => {
    const metadata = {
      id: 'web-scrape',
      name: 'Web Scraper',
      version: '1.0.0',
      description: 'Scrapes web pages',
      surfaces: ['browser-job' as const],
    };
    const plan = resolveSkillExecutionPlan(metadata, baseSettings);
    expect(plan.selectedRoute).toBeDefined();
    expect(plan.selectedRoute?.surface).toBe('browser-job');
    expect(plan.selectedRoute?.targetId).toBe('browser-1');
  });

  test('skill requiring ssh surfaces routes to SSH target', () => {
    const metadata = {
      id: 'deploy',
      name: 'Deployer',
      version: '1.0.0',
      description: 'Remote deploy',
      surfaces: ['ssh' as const],
    };
    const plan = resolveSkillExecutionPlan(metadata, baseSettings);
    expect(plan.selectedRoute).toBeDefined();
    expect(plan.selectedRoute?.surface).toBe('ssh');
    expect(plan.selectedRoute?.targetName).toBe('Build Server');
  });

  test('skill with multiple surfaces picks first available', () => {
    const metadata = {
      id: 'multi',
      name: 'Multi',
      version: '1.0.0',
      description: 'Multi surface',
      surfaces: ['local-mobile' as const, 'ssh' as const, 'browser-job' as const],
    };
    const plan = resolveSkillExecutionPlan(metadata, baseSettings);
    expect(plan.selectedRoute).toBeDefined();
    expect(plan.selectedRoute?.surface).toBe('local-mobile');
    expect(plan.fallbackRoutes.length).toBeGreaterThan(0);
  });

  test('skill with no matching surface gets no route', () => {
    const emptySettings = {
      mcpServers: [],
      sshTargets: [],
      workspaceTargets: [],
      browserProviders: [],
    };
    const metadata = {
      id: 'needs-browser',
      name: 'Browser Only',
      version: '1.0.0',
      description: 'Needs a browser',
      surfaces: ['browser-job' as const],
    };
    const plan = resolveSkillExecutionPlan(metadata, emptySettings);
    // Should still get the skill but with no concrete route
    expect(plan.selectedRoute).toBeNull();
  });
});

describe('Skill Eligibility: context construction', () => {
  test('context includes all configured surface types', () => {
    const ctx = buildSkillEligibilityContext({
      mcpServers: [makeMcpServer()],
      sshTargets: [makeSshTarget()],
      workspaceTargets: [],
      browserProviders: [makeBrowserProvider()],
    });
    expect(ctx.availableSurfaces).toContain('local-mobile');
    expect(ctx.availableSurfaces).toContain('mcp');
    expect(ctx.availableSurfaces).toContain('ssh');
    expect(ctx.availableSurfaces).toContain('browser-job');
  });

  test('disabled targets do not add surfaces', () => {
    const ctx = buildSkillEligibilityContext({
      mcpServers: [],
      sshTargets: [makeSshTarget({ enabled: false })],
      workspaceTargets: [],
      browserProviders: [makeBrowserProvider({ enabled: false })],
    });
    expect(ctx.availableSurfaces).toContain('local-mobile');
    expect(ctx.availableSurfaces).not.toContain('ssh');
    expect(ctx.availableSurfaces).not.toContain('browser-job');
  });

  test('strict SSH without fingerprint does not add ssh surface', () => {
    const ctx = buildSkillEligibilityContext({
      mcpServers: [],
      sshTargets: [makeSshTarget({ hostKeyPolicy: 'strict', trustedHostFingerprint: undefined })],
      workspaceTargets: [],
      browserProviders: [],
    });
    expect(ctx.availableSurfaces).not.toContain('ssh');
  });

  test('browser provider without API key does not add browser-job surface', () => {
    const ctx = buildSkillEligibilityContext({
      mcpServers: [],
      sshTargets: [],
      workspaceTargets: [],
      browserProviders: [makeBrowserProvider({ apiKeyRef: '' })],
    });
    expect(ctx.availableSurfaces).not.toContain('browser-job');
  });
});

describe('Edge Cases: concurrent operations and data integrity', () => {
  test('multiple concurrent job creations produce unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      ids.add(
        startRemoteJob({
          jobType: 'mcp-job',
          status: 'running',
          requestedBy: 'agent',
          executionSurface: 'mcp',
          summary: `Concurrent job ${i}`,
        }),
      );
    }
    expect(ids.size).toBe(50);
  });

  test('MCP bridge with tool returning isError:true marks job failed', async () => {
    const mockClient = {
      isConnected: () => true,
      callTool: jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Permission denied' }],
        isError: true,
      }),
    };
    const clients = new Map([['err-srv', mockClient as any]]);

    const result = await executeMcpTool(clients, 'mcp__err-srv__denied_tool', '{}');
    expect(result).toContain('Permission denied');

    const jobs = Object.values(useRemoteStore.getState().jobs);
    expect(jobs[0].status).toBe('failed');
    expect(jobs[0].error).toContain('Permission denied');
  });

  test('resetting remote store clears everything', () => {
    startRemoteJob({
      jobType: 'mcp-job',
      status: 'running',
      requestedBy: 'agent',
      executionSurface: 'mcp',
      summary: 'test',
    });
    openRemoteSession({
      targetId: 'x',
      kind: 'ssh-shell',
      status: 'connected',
      summary: 'test',
      reconnectable: false,
    });
    expect(Object.keys(useRemoteStore.getState().jobs).length).toBe(1);
    expect(Object.keys(useRemoteStore.getState().sessions).length).toBe(1);

    resetRemoteStore();
    expect(Object.keys(useRemoteStore.getState().jobs).length).toBe(0);
    expect(Object.keys(useRemoteStore.getState().sessions).length).toBe(0);
  });
});
