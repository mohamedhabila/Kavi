/**
 * Real-world integration scenarios for Phase 2 implementation.
 *
 * These tests exercise the actual production code paths with realistic
 * inputs and verify the full end-to-end behavior of:
 *   1. Remote job/session store lifecycle
 *   2. MCP bridge remote job tracking
 *   3. Browser provider auth resolution & readiness
 *   4. Browser provider presets & connection building
 *   5. SSH host-key policy & connector readiness
 *   6. Remote command center snapshot building
 *   7. Skill routing with real settings configs
 *   8. Edge cases: concurrent jobs, store trimming, error paths
 */

// ---- Mock native SSH before anything imports it ----
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

// ---- Mock SecureStorage ----
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

// ---- Imports (after mocks) ----
import {
  useRemoteStore,
  resetRemoteStore,
  startRemoteJob,
  updateRemoteJob,
  addRemoteArtifact,
  openRemoteSession,
  closeRemoteSession,
  updateRemoteSession,
} from '../../src/services/remote/store';
import {
  executeMcpTool,
  parseMcpToolName,
  formatMcpResult,
  mcpToolToDefinition,
} from '../../src/services/mcp/bridge';
import {
  getBrowserProviderReadiness,
  isValidBrowserProviderBaseUrl,
  getBrowserProviderLabel,
  getBrowserProviderAuthLabel,
  getBrowserProviderAuthHint,
  applyBrowserProviderPreset,
  BROWSER_PROVIDER_PRESETS,
  resolveBrowserProviderConnection,
  withBrowserProviderAuth,
  probeBrowserProvider,
} from '../../src/services/browser/providers';
import {
  getSshTargetReadiness,
  getSshHostKeyPolicy,
  getSshHostKeyPolicyLabel,
  getSshHostFingerprint,
} from '../../src/services/ssh/connector';
import { buildRemoteCommandCenterSnapshot } from '../../src/services/remote/commandCenter';
import { resolveSkillExecutionPlan } from '../../src/services/skills/routing';
import { buildSkillEligibilityContext } from '../../src/services/skills/eligibility';
import type {
  SshTargetConfig,
  BrowserProviderConfig,
  McpServerConfig,
  RemoteJobRecord,
} from '../../src/types';

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

// ========================================================================
// 1. REMOTE JOB/SESSION STORE — FULL LIFECYCLE
// ========================================================================
describe('Remote Store: full lifecycle', () => {
  test('create → update → add artifacts → close', () => {
    const jobId = startRemoteJob({
      jobType: 'mcp-job',
      targetId: 'server-1',
      status: 'running',
      requestedBy: 'agent',
      executionSurface: 'mcp',
      summary: 'Call tool foo',
      progressText: 'In progress',
    });
    expect(jobId).toMatch(/^remote-job-/);

    const state1 = useRemoteStore.getState();
    expect(state1.jobs[jobId]).toBeDefined();
    expect(state1.jobs[jobId].status).toBe('running');
    expect(state1.jobs[jobId].summary).toBe('Call tool foo');

    updateRemoteJob(jobId, { status: 'completed', progressText: 'Done' });
    const state2 = useRemoteStore.getState();
    expect(state2.jobs[jobId].status).toBe('completed');
    expect(state2.jobs[jobId].progressText).toBe('Done');

    const artId = addRemoteArtifact(jobId, {
      kind: 'log-snippet',
      title: 'MCP result',
      value: 'The answer is 42',
    });
    expect(artId).toMatch(/^remote-artifact-/);
    const state3 = useRemoteStore.getState();
    expect(state3.jobs[jobId].artifacts).toHaveLength(1);
    expect(state3.jobs[jobId].artifacts[0].value).toBe('The answer is 42');
  });

  test('session lifecycle: open → update → close', () => {
    const sessionId = openRemoteSession({
      targetId: 'server-1',
      kind: 'mcp-operation-stream',
      status: 'connecting',
      summary: 'Running tool',
      reconnectable: false,
    });
    expect(sessionId).toMatch(/^remote-session-/);

    updateRemoteSession(sessionId, { status: 'connected', summary: 'Tool active' });
    const state1 = useRemoteStore.getState();
    expect(state1.sessions[sessionId].status).toBe('connected');
    expect(state1.sessions[sessionId].summary).toBe('Tool active');

    closeRemoteSession(sessionId, 'closed');
    const state2 = useRemoteStore.getState();
    expect(state2.sessions[sessionId].status).toBe('closed');
  });

  test('error session close carries error message', () => {
    const sessionId = openRemoteSession({
      targetId: 'x',
      kind: 'browser-live',
      status: 'connecting',
      summary: 'Browser',
      reconnectable: true,
    });
    closeRemoteSession(sessionId, 'error', 'Connection refused');
    const state = useRemoteStore.getState();
    expect(state.sessions[sessionId].status).toBe('error');
    expect(state.sessions[sessionId].error).toBe('Connection refused');
  });

  test('store trims jobs when exceeding MAX', () => {
    for (let i = 0; i < 65; i++) {
      startRemoteJob({
        jobType: 'mcp-job',
        status: 'completed',
        requestedBy: 'agent',
        executionSurface: 'mcp',
        summary: `Job ${i}`,
      });
    }
    const state = useRemoteStore.getState();
    expect(Object.keys(state.jobs).length).toBeLessThanOrEqual(60);
  });

  test('store trims sessions when exceeding MAX', () => {
    for (let i = 0; i < 30; i++) {
      openRemoteSession({
        targetId: 'x',
        kind: 'ssh-shell',
        status: 'connected',
        summary: `Session ${i}`,
        reconnectable: false,
      });
    }
    const state = useRemoteStore.getState();
    expect(Object.keys(state.sessions).length).toBeLessThanOrEqual(24);
  });

  test('addArtifact to nonexistent job returns null', () => {
    const result = addRemoteArtifact('nonexistent-job', {
      kind: 'log-snippet',
      title: 'Orphan',
      value: 'hello',
    });
    expect(result).toBeNull();
  });

  test('updateJob for nonexistent job is a no-op', () => {
    updateRemoteJob('nonexistent', { status: 'failed' });
    const state = useRemoteStore.getState();
    expect(Object.keys(state.jobs)).toHaveLength(0);
  });

  test('closeSession for nonexistent session is a no-op', () => {
    closeRemoteSession('nonexistent', 'closed');
    const state = useRemoteStore.getState();
    expect(Object.keys(state.sessions)).toHaveLength(0);
  });

  test('clearJob removes a specific job', () => {
    const jobId = startRemoteJob({
      jobType: 'browser-job',
      status: 'completed',
      requestedBy: 'user',
      executionSurface: 'browser-job',
      summary: 'Browser job',
    });
    expect(useRemoteStore.getState().jobs[jobId]).toBeDefined();
    useRemoteStore.getState().clearJob(jobId);
    expect(useRemoteStore.getState().jobs[jobId]).toBeUndefined();
  });

  test('clearSession removes a specific session', () => {
    const sessionId = openRemoteSession({
      targetId: 'x',
      kind: 'browser-live',
      status: 'connected',
      summary: 'Live',
      reconnectable: true,
    });
    expect(useRemoteStore.getState().sessions[sessionId]).toBeDefined();
    useRemoteStore.getState().clearSession(sessionId);
    expect(useRemoteStore.getState().sessions[sessionId]).toBeUndefined();
  });

  test('artifacts are capped at 8 per job', () => {
    const jobId = startRemoteJob({
      jobType: 'mcp-job',
      status: 'running',
      requestedBy: 'agent',
      executionSurface: 'mcp',
      summary: 'Lots of artifacts',
    });
    for (let i = 0; i < 12; i++) {
      addRemoteArtifact(jobId, {
        kind: 'log-snippet',
        title: `Artifact ${i}`,
        value: `value-${i}`,
      });
    }
    const job = useRemoteStore.getState().jobs[jobId];
    expect(job.artifacts.length).toBeLessThanOrEqual(8);
  });
});

// ========================================================================
// 2. MCP BRIDGE — REAL EXECUTION TRACKING
// ========================================================================
describe('MCP Bridge: tool execution tracking', () => {
  test('parseMcpToolName parses correctly', () => {
    expect(parseMcpToolName('mcp__my_server__do_thing')).toEqual({
      serverId: 'my_server',
      toolName: 'do_thing',
    });
    expect(parseMcpToolName('not-mcp-tool')).toBeNull();
    expect(parseMcpToolName('mcp____empty')).toBeNull();
  });

  test('mcpToolToDefinition generates correct name and schema', () => {
    const def = mcpToolToDefinition({
      serverId: 'test-srv',
      serverName: 'Test Server',
      tool: {
        name: 'get_data',
        description: 'Fetches data',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
    });
    expect(def.name).toBe('mcp__test-srv__get_data');
    expect(def.description).toContain('[Test Server]');
    expect((def.input_schema as any).properties.query.type).toBe('string');
  });

  test('formatMcpResult handles text and error content', () => {
    const result = formatMcpResult({
      content: [
        { type: 'text', text: 'Hello world' },
        { type: 'image', mimeType: 'image/png' },
      ],
      isError: false,
    });
    expect(result).toContain('Hello world');
    expect(result).toContain('[Image: image/png]');

    const errResult = formatMcpResult({
      content: [{ type: 'text', text: 'something broke' }],
      isError: true,
    });
    expect(errResult).toBe('Error: something broke');
  });

  test('executeMcpTool creates tracked job + session on success', async () => {
    const mockClient = {
      isConnected: () => true,
      callTool: jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'result data' }],
        isError: false,
      }),
    };
    const clients = new Map([['test-server', mockClient as any]]);

    const result = await executeMcpTool(clients, 'mcp__test-server__my_tool', '{"key":"value"}');
    expect(result).toBe('result data');

    const state = useRemoteStore.getState();
    const jobs = Object.values(state.jobs);
    const sessions = Object.values(state.sessions);

    expect(jobs.length).toBe(1);
    expect(jobs[0].jobType).toBe('mcp-job');
    expect(jobs[0].status).toBe('completed');
    expect(jobs[0].artifacts.length).toBeGreaterThanOrEqual(1);
    expect(jobs[0].artifacts[0].value).toContain('result data');

    expect(sessions.length).toBe(1);
    expect(sessions[0].kind).toBe('mcp-operation-stream');
    expect(sessions[0].status).toBe('closed');
  });

  test('executeMcpTool creates tracked job + session on failure', async () => {
    const mockClient = {
      isConnected: () => true,
      callTool: jest.fn().mockRejectedValue(new Error('timeout')),
    };
    const clients = new Map([['fail-server', mockClient as any]]);

    const result = await executeMcpTool(clients, 'mcp__fail-server__broken_tool', '{}');
    expect(result).toContain('timeout');

    const state = useRemoteStore.getState();
    const jobs = Object.values(state.jobs);
    expect(jobs[0].status).toBe('failed');
    expect(jobs[0].error).toContain('timeout');

    const sessions = Object.values(state.sessions);
    expect(sessions[0].status).toBe('error');
  });

  test('executeMcpTool with disconnected server returns error without creating a crash', async () => {
    const mockClient = {
      isConnected: () => false,
      callTool: jest.fn(),
    };
    const clients = new Map([['dc-server', mockClient as any]]);

    const result = await executeMcpTool(clients, 'mcp__dc-server__tool', '{}');
    expect(result).toContain('disconnected');
    expect(mockClient.callTool).not.toHaveBeenCalled();
  });

  test('executeMcpTool with bad JSON args returns error', async () => {
    const mockClient = {
      isConnected: () => true,
      callTool: jest.fn(),
    };
    const clients = new Map([['json-server', mockClient as any]]);

    const result = await executeMcpTool(clients, 'mcp__json-server__tool', 'not-json');
    expect(result).toContain('invalid tool arguments');
    expect(mockClient.callTool).not.toHaveBeenCalled();
  });

  test('executeMcpTool with unknown server returns error', async () => {
    const result = await executeMcpTool(new Map(), 'mcp__unknown__tool', '{}');
    expect(result).toContain('not connected');
  });

  test('executeMcpTool with invalid tool name returns error', async () => {
    const result = await executeMcpTool(new Map(), 'bad_name', '{}');
    expect(result).toContain('invalid MCP tool name');
  });
});

// ========================================================================
// 3. BROWSER PROVIDER — AUTH, READINESS, CONNECTIONS
// ========================================================================
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

// ========================================================================
// 4. SSH CONNECTOR — HOST KEY POLICY & READINESS
// ========================================================================
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

// ========================================================================
// 5. REMOTE COMMAND CENTER SNAPSHOT
// ========================================================================
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

// ========================================================================
// 6. SKILL ROUTING — WITH REAL SETTINGS
// ========================================================================
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

// ========================================================================
// 7. SKILL ELIGIBILITY — CONTEXT BUILDING
// ========================================================================
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

// ========================================================================
// 8. CONCURRENT / EDGE CASES
// ========================================================================
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
