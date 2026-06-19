import {
  makeBrowserProvider,
  makeMcpServer,
  makeSshTarget,
  makeWorkspaceTarget,
  mockSecureStore,
} from '../helpers/realWorldIntegrationHarness';
import {
  isValidBrowserProviderBaseUrl,
  BROWSER_PROVIDER_PRESETS,
  applyBrowserProviderPreset,
} from '../../src/services/browser/providers/registry';
import { withBrowserProviderAuth } from '../../src/services/browser/providers/connection';
import { getBrowserProviderLabel } from '../../src/services/browser/providers/labels';
import { getBrowserProviderReadiness } from '../../src/services/browser/providers/readiness';
import {
  getSshTargetReadiness,
  getSshHostKeyPolicy,
  getSshHostKeyPolicyLabel,
} from '../../src/services/ssh/connector';
import {
  getWorkspaceTargetReadiness,
  buildWorkspaceLaunchUrl,
  getWorkspaceProviderLabel,
  isValidWorkspaceBaseUrl,
} from '../../src/services/workspaces/connector';
import { targetSupportsConfigPath } from '../../src/services/skills/eligibility';
import { buildRemoteCommandCenterSnapshot } from '../../src/services/remote/commandCenter';
import {
  useRemoteStore,
  resetRemoteStore,
  startRemoteJob,
  openRemoteSession,
  closeRemoteSession,
} from '../../src/services/remote/store';
import type { SshTargetConfig } from '../../src/types/remote';

describe('SSH connector with realistic configs', () => {
  beforeEach(() => {
    mockSecureStore.clear();
  });

  it('validates readiness for all auth modes', () => {
    const passwordTarget = makeSshTarget({ authMode: 'password', passwordRef: 'pwd-ref' });
    mockSecureStore.set('pwd-ref', 'secret123');
    expect(getSshTargetReadiness(passwordTarget).launchable).toBe(true);

    const keyTarget = makeSshTarget({ authMode: 'private-key', privateKeyRef: 'key-ref' });
    mockSecureStore.set('key-ref', 'ssh-rsa AAAA...');
    expect(getSshTargetReadiness(keyTarget)).toBeDefined();

    const disabledTarget = makeSshTarget({ enabled: false });
    expect(getSshTargetReadiness(disabledTarget).launchable).toBe(false);
    expect(getSshTargetReadiness(disabledTarget).reason).toBe('disabled');
  });

  it('validates readiness for targets missing required fields', () => {
    const noHost = makeSshTarget({ host: '' });
    expect(getSshTargetReadiness(noHost).launchable).toBe(false);
    expect(getSshTargetReadiness(noHost).reason).toBe('missing-host');

    const noUsername = makeSshTarget({ username: '' });
    expect(getSshTargetReadiness(noUsername).launchable).toBe(false);
    expect(getSshTargetReadiness(noUsername).reason).toBe('missing-username');
  });

  it('host-key policies resolve correctly', () => {
    const tofuPolicy = getSshHostKeyPolicy({ hostKeyPolicy: 'trust-on-first-use' });
    expect(tofuPolicy).toBeDefined();
    expect(getSshHostKeyPolicyLabel({ hostKeyPolicy: 'trust-on-first-use' })).toBeTruthy();

    const strictPolicy = getSshHostKeyPolicy({ hostKeyPolicy: 'strict' });
    expect(strictPolicy).toBeDefined();
    expect(getSshHostKeyPolicyLabel({ hostKeyPolicy: 'strict' })).toBeTruthy();

    const defaultPolicy = getSshHostKeyPolicy({} as any);
    expect(defaultPolicy).toBeDefined();
  });

  it('handles realistic production SSH configs', () => {
    const configs: SshTargetConfig[] = [
      makeSshTarget({
        id: 'prod-1',
        name: 'Production Web',
        host: 'web1.prod.example.com',
        port: 22,
        username: 'deploy',
        authMode: 'private-key',
        privateKeyRef: 'prod-key',
        hostKeyPolicy: 'strict',
        trustedHostFingerprint: 'SHA256:abc123...',
      }),
      makeSshTarget({
        id: 'dev-1',
        name: 'Dev Server',
        host: '192.168.1.100',
        port: 2222,
        username: 'developer',
        authMode: 'password',
        passwordRef: 'dev-pwd',
        hostKeyPolicy: 'trust-on-first-use',
      }),
      makeSshTarget({
        id: 'bastion',
        name: 'Bastion Host',
        host: 'bastion.corp.com',
        port: 22,
        username: 'admin',
        authMode: 'private-key',
        privateKeyRef: 'bastion-key',
        hostKeyPolicy: 'strict',
        trustedHostFingerprint: 'SHA256:xyz789...',
      }),
    ];

    for (const config of configs) {
      const readiness = getSshTargetReadiness(config);
      expect(readiness).toBeDefined();
      // key auth targets should be launchable regardless of secret store in sync readiness
      expect(typeof readiness.launchable).toBe('boolean');
      expect(typeof readiness.reason).toBe('string');
    }
  });
});

describe('Browser provider with realistic configs', () => {
  beforeEach(() => {
    mockSecureStore.clear();
  });

  it('validates all provider presets', () => {
    for (const preset of BROWSER_PROVIDER_PRESETS) {
      expect(preset.id).toBeTruthy();
      expect(preset.label).toBeTruthy();
      expect(preset.provider).toBeTruthy();
      expect(['browserbase', 'browserless', 'custom']).toContain(preset.provider);
    }
  });

  it('applies presets to empty config', () => {
    for (const preset of BROWSER_PROVIDER_PRESETS) {
      const config = applyBrowserProviderPreset(
        {
          id: 'test-apply',
          name: 'Test',
          provider: 'browserbase',
          enabled: true,
        } as BrowserProviderConfig,
        preset.id,
      );

      expect(config.provider).toBe(preset.provider);
      expect(config.baseUrl).toBeTruthy();
      expect(config.authMode).toBeTruthy();
    }
  });

  it('validates base URLs correctly', () => {
    expect(isValidBrowserProviderBaseUrl('https://api.browserbase.com')).toBe(true);
    expect(isValidBrowserProviderBaseUrl('https://chrome.browserless.io/v2')).toBe(true);
    expect(isValidBrowserProviderBaseUrl('http://localhost:3000')).toBe(true);
    expect(isValidBrowserProviderBaseUrl('')).toBe(false);
    expect(isValidBrowserProviderBaseUrl('not-a-url')).toBe(false);
    expect(isValidBrowserProviderBaseUrl('ftp://invalid.com')).toBe(false);
  });

  it('readiness checks for all auth modes', () => {
    const apiKeyConfig = makeBrowserProvider({ authMode: 'api-key-header', apiKeyRef: 'bb-key' });
    mockSecureStore.set('bb-key', 'test-api-key');
    const apiKeyReadiness = getBrowserProviderReadiness(apiKeyConfig);
    expect(apiKeyReadiness).toBeDefined();

    const bearerConfig = makeBrowserProvider({ authMode: 'bearer', apiKeyRef: 'bearer-token-ref' });
    mockSecureStore.set('bearer-token-ref', 'test-bearer-token');
    const bearerReadiness = getBrowserProviderReadiness(bearerConfig);
    expect(bearerReadiness).toBeDefined();

    const queryConfig = makeBrowserProvider({
      authMode: 'query-token',
      apiKeyRef: 'qt-ref',
      queryTokenParam: 'token',
    });
    mockSecureStore.set('qt-ref', 'test-qt');
    const queryReadiness = getBrowserProviderReadiness(queryConfig);
    expect(queryReadiness).toBeDefined();

    const noAuthConfig = makeBrowserProvider({
      provider: 'custom',
      authMode: 'none',
      baseUrl: 'https://custom.example.com',
    });
    const noAuthReadiness = getBrowserProviderReadiness(noAuthConfig);
    expect(noAuthReadiness.launchable).toBe(true);
  });

  it('withBrowserProviderAuth handles all auth modes', async () => {
    const apiKeyConn = {
      baseUrl: 'https://api.browserbase.com',
      token: 'test-key-123',
      authMode: 'api-key-header' as const,
    };
    const apiKeyResult = withBrowserProviderAuth(apiKeyConn.baseUrl, apiKeyConn, 'X-BB-API-Key');
    expect(apiKeyResult.headers?.['X-BB-API-Key']).toBe('test-key-123');
    expect(apiKeyResult.url).toContain('api.browserbase.com');

    const bearerConn = {
      baseUrl: 'https://api.browserbase.com',
      token: 'bearer-token-456',
      authMode: 'bearer' as const,
    };
    const bearerResult = withBrowserProviderAuth(bearerConn.baseUrl, bearerConn, 'Authorization');
    expect(bearerResult.headers?.['Authorization']).toContain('Bearer');
    expect(bearerResult.url).toContain('api.browserbase.com');

    const queryConn = {
      baseUrl: 'https://chrome.browserless.io/v2',
      token: 'qt-789',
      authMode: 'query-token' as const,
      queryTokenParam: 'token',
    };
    const queryResult = withBrowserProviderAuth(queryConn.baseUrl, queryConn, 'X-API-Key');
    expect(queryResult.url).toContain('token=qt-789');
  });

  it('getBrowserProviderLabel returns correct names', () => {
    expect(getBrowserProviderLabel('browserbase')).toBeTruthy();
    expect(getBrowserProviderLabel('browserless')).toBeTruthy();
  });
});

describe('Workspace connector with realistic configs', () => {
  beforeEach(() => {
    mockSecureStore.clear();
  });

  it('validates workspace readiness for different providers', () => {
    const codeServer = makeWorkspaceTarget({ provider: 'code-server' });
    mockSecureStore.set('ws-token-ref', 'test-token');
    const readiness1 = getWorkspaceTargetReadiness(codeServer, 'test-token');
    expect(readiness1.launchable).toBe(true);
    expect(readiness1.reason).toBe('ready');

    const openVscode = makeWorkspaceTarget({
      provider: 'openvscode-server',
      baseUrl: 'https://vscode.example.com',
    });
    const readiness2 = getWorkspaceTargetReadiness(openVscode, 'test-token');
    expect(readiness2.launchable).toBe(true);

    const custom = makeWorkspaceTarget({ provider: 'custom', baseUrl: 'https://custom.dev' });
    const readiness3 = getWorkspaceTargetReadiness(custom, 'test-token');
    expect(readiness3.launchable).toBe(true);
  });

  it('rejects incomplete workspace configs', () => {
    const noRoot = makeWorkspaceTarget({ rootPath: '' });
    expect(getWorkspaceTargetReadiness(noRoot).launchable).toBe(false);
    expect(getWorkspaceTargetReadiness(noRoot).reason).toBe('missing-root-path');

    const noUrl = makeWorkspaceTarget({ baseUrl: '' });
    expect(getWorkspaceTargetReadiness(noUrl).launchable).toBe(false);
    expect(getWorkspaceTargetReadiness(noUrl).reason).toBe('missing-base-url');

    const invalidUrl = makeWorkspaceTarget({ baseUrl: 'not-a-url' });
    expect(getWorkspaceTargetReadiness(invalidUrl).launchable).toBe(false);
    expect(getWorkspaceTargetReadiness(invalidUrl).reason).toBe('invalid-base-url');

    const disabled = makeWorkspaceTarget({ enabled: false });
    expect(getWorkspaceTargetReadiness(disabled).launchable).toBe(false);
    expect(getWorkspaceTargetReadiness(disabled).reason).toBe('disabled');
  });

  it('builds launch URLs correctly for all providers', () => {
    const codeServer = makeWorkspaceTarget({
      provider: 'code-server',
      baseUrl: 'https://code.example.com',
      rootPath: '/home/user/project',
      authMode: 'query-token',
      queryTokenParam: 'tkn',
    });

    const url = buildWorkspaceLaunchUrl(codeServer, 'my-secret-token');
    expect(url).toContain('code.example.com');
    expect(url).toContain('folder=%2Fhome%2Fuser%2Fproject');
    expect(url).toContain('tkn=my-secret-token');
  });

  it('builds launch URL with {rootPath} template', () => {
    const custom = makeWorkspaceTarget({
      provider: 'custom',
      baseUrl: 'https://devbox.example.com/workspace/{rootPath}',
      rootPath: '/srv/app',
      authMode: 'query-token',
      queryTokenParam: 'token',
    });

    const url = buildWorkspaceLaunchUrl(custom, 'tok-123');
    expect(url).toContain('workspace/%2Fsrv%2Fapp');
    expect(url).toContain('token=tok-123');
  });

  it('validates base URLs correctly', () => {
    expect(isValidWorkspaceBaseUrl('https://code.example.com')).toBe(true);
    expect(isValidWorkspaceBaseUrl('http://localhost:8080')).toBe(true);
    expect(isValidWorkspaceBaseUrl('')).toBe(false);
    expect(isValidWorkspaceBaseUrl('ftp://invalid.com')).toBe(false);
    expect(isValidWorkspaceBaseUrl('not-valid')).toBe(false);
  });

  it('provides correct labels for all providers', () => {
    expect(getWorkspaceProviderLabel('code-server')).toBe('code-server');
    expect(getWorkspaceProviderLabel('openvscode-server')).toBe('OpenVSCode');
    expect(getWorkspaceProviderLabel('custom')).toBe('Custom');
    expect(getWorkspaceProviderLabel(undefined)).toBe('code-server');
  });

  it('targetSupportsConfigPath checks bidirectional prefix matching', () => {
    const target = makeWorkspaceTarget({
      rootPath: '/home/user/project',
      configRoots: ['/home/user/project/.github', '/home/user/config'],
    });

    expect(targetSupportsConfigPath(target, '/home/user/project')).toBe(true);
    expect(targetSupportsConfigPath(target, '/home/user/project/src')).toBe(true);
    expect(targetSupportsConfigPath(target, '/home/user/project/.github')).toBe(true);
    expect(targetSupportsConfigPath(target, '/completely/different/path')).toBe(false);
    expect(targetSupportsConfigPath(target, '')).toBe(false);
  });
});

describe('Command center snapshot with realistic mixed configs', () => {
  beforeEach(() => {
    mockSecureStore.clear();
    resetRemoteStore();
  });

  it('builds snapshot with all target types', () => {
    mockSecureStore.set('ssh-pwd', 'password123');
    mockSecureStore.set('bb-key', 'browserbase-api-key');
    mockSecureStore.set('ws-token', 'workspace-access-token');

    const settings = {
      sshTargets: [
        makeSshTarget({ id: 'ssh-1', name: 'Production', passwordRef: 'ssh-pwd', enabled: true }),
        makeSshTarget({ id: 'ssh-2', name: 'Staging', enabled: false }),
      ],
      browserProviders: [
        makeBrowserProvider({ id: 'bb-1', name: 'Browserbase Prod', apiKeyRef: 'bb-key' }),
      ],
      workspaceTargets: [
        makeWorkspaceTarget({ id: 'ws-1', name: 'Main Workspace', accessTokenRef: 'ws-token' }),
      ],
      mcpServers: [
        makeMcpServer({ id: 'mcp-1', name: 'GitHub MCP', enabled: true }),
        makeMcpServer({ id: 'mcp-2', name: 'Disabled MCP', enabled: false }),
      ],
    };

    const snapshot = buildRemoteCommandCenterSnapshot(settings);
    expect(snapshot).toBeDefined();
    expect(snapshot.targets.length).toBeGreaterThan(0);

    const typeSet = new Set(snapshot.targets.map((t) => t.kind));
    expect(typeSet.has('ssh-host')).toBe(true);
    expect(typeSet.has('browser-provider')).toBe(true);
    expect(typeSet.has('workspace')).toBe(true);
    expect(typeSet.has('mcp-server')).toBe(true);

    const disabledSsh = snapshot.targets.find((t) => t.id === 'ssh-2');
    if (disabledSsh) {
      expect(disabledSsh.readiness).toBe('disabled');
    }

    const disabledMcp = snapshot.targets.find((t) => t.id === 'mcp-2');
    if (disabledMcp) {
      expect(disabledMcp.readiness).toBe('disabled');
    }
  });

  it('correctly counts readiness states', () => {
    const settings = {
      sshTargets: [
        makeSshTarget({ id: 'ssh-ready', enabled: true }),
        makeSshTarget({ id: 'ssh-disabled', enabled: false }),
      ],
      browserProviders: [
        makeBrowserProvider({ id: 'bb-ready', authMode: 'none', enabled: true }),
        makeBrowserProvider({
          id: 'bb-no-key',
          authMode: 'api-key-header',
          apiKeyRef: '',
          enabled: true,
        }),
      ],
      workspaceTargets: [
        makeWorkspaceTarget({ id: 'ws-ready', authMode: 'none', enabled: true }),
        makeWorkspaceTarget({ id: 'ws-no-url', baseUrl: '', enabled: true }),
      ],
      mcpServers: [makeMcpServer({ id: 'mcp-enabled', enabled: true })],
    };

    const snapshot = buildRemoteCommandCenterSnapshot(settings);
    expect(snapshot.targets.length).toBeGreaterThan(0);

    const readyCounts: Record<string, number> = {};
    for (const target of snapshot.targets) {
      readyCounts[target.readiness] = (readyCounts[target.readiness] || 0) + 1;
    }

    expect(Object.keys(readyCounts).length).toBeGreaterThan(0);
  });

  it('snapshot includes active jobs and sessions', () => {
    resetRemoteStore();

    const jobId = startRemoteJob({
      jobType: 'mcp-job',
      targetId: 'mcp-1',
      providerId: 'mcp-1',
      status: 'running',
      requestedBy: 'agent',
      executionSurface: 'mcp',
      summary: 'Running GitHub tool',
    });

    const sessionId = openRemoteSession({
      targetId: 'mcp-1',
      providerId: 'mcp-1',
      kind: 'mcp-operation-stream',
      status: 'connected',
      summary: 'Tool executing',
      reconnectable: false,
    });

    const settings = {
      sshTargets: [],
      browserProviders: [],
      workspaceTargets: [],
      mcpServers: [makeMcpServer({ id: 'mcp-1', name: 'GitHub MCP' })],
    };

    const storeState = useRemoteStore.getState();
    expect(storeState.jobs[jobId]).toBeDefined();
    expect(storeState.sessions[sessionId]).toBeDefined();
    const snapshot = buildRemoteCommandCenterSnapshot(settings, {
      remoteJobs: Object.values(storeState.jobs),
      remoteSessions: Object.values(storeState.sessions),
    });
    expect(snapshot.activeCounts.jobs).toBeGreaterThanOrEqual(1);
    expect(snapshot.activeCounts.sessions).toBeGreaterThanOrEqual(1);

    closeRemoteSession(sessionId);
  });
});

describe('Remote store edge cases', () => {
  beforeEach(() => {
    resetRemoteStore();
  });

  it('handles rapid job creation', () => {
    const jobIds: string[] = [];
    for (let i = 0; i < 50; i++) {
      const id = startRemoteJob({
        jobType: 'mcp-job',
        targetId: `target-${i}`,
        providerId: `provider-${i}`,
        status: 'running',
        requestedBy: 'agent',
        executionSurface: 'mcp',
        summary: `Job ${i}`,
      });
      jobIds.push(id);
    }

    const state = useRemoteStore.getState();
    expect(Object.keys(state.jobs).length).toBeGreaterThan(0);
    expect(Object.keys(state.jobs).length).toBeLessThanOrEqual(50);

    const lastJobId = jobIds[jobIds.length - 1];
    expect(state.jobs[lastJobId]).toBeDefined();
  });

  it('handles session lifecycle correctly', () => {
    const sessionId = openRemoteSession({
      targetId: 'test-target',
      providerId: 'test-provider',
      kind: 'mcp-operation-stream',
      status: 'connected',
      summary: 'Test session',
      reconnectable: false,
    });

    let session = useRemoteStore.getState().sessions[sessionId];
    expect(session).toBeDefined();
    expect(session.status).toBe('connected');

    closeRemoteSession(sessionId, 'closed');
    session = useRemoteStore.getState().sessions[sessionId];
    expect(session.status).toBe('closed');
    expect(session.lastActivityAt).toBeDefined();

    // Double-close should not throw
    expect(() => closeRemoteSession(sessionId, 'closed')).not.toThrow();
  });
});
