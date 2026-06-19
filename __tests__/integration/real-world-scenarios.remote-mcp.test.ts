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
import { useRemoteStore, resetRemoteStore, startRemoteJob, updateRemoteJob, addRemoteArtifact, openRemoteSession, closeRemoteSession, updateRemoteSession } from '../../src/services/remote/store';
import { executeMcpTool, parseMcpToolName, formatMcpResult, mcpToolToDefinition } from '../../src/services/mcp/bridge';
beforeEach(() => {
  resetRemoteStore();
  mockSecureStore.clear();
  jest.clearAllMocks();
});

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
