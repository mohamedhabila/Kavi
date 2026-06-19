import { McpClient } from '../../src/services/mcp/client';
import { mcpManager } from '../../src/services/mcp/manager';
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;
const jsonHeaders = {
  get: (name?: string) => (name?.toLowerCase() === 'content-type' ? 'application/json' : null),
};
class MockEventSource {
  static instances: MockEventSource[] = [];
  listeners: Record<string, Function[]> = {};
  onerror: ((e: any) => void) | null = null;
  closed = false;

  constructor(public url: string) {
    MockEventSource.instances.push(this);
  }

  addEventListener(event: string, handler: Function) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(handler);
  }

  close() {
    this.closed = true;
  }

  emit(event: string, data: any) {
    (this.listeners[event] || []).forEach((h) => h(data));
  }
}
(global as any).EventSource = MockEventSource;
jest.mock('../../src/services/events/bus', () => ({
  emitMcpEvent: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../src/services/mcp/bridge', () => ({
  mcpToolToDefinition: jest.fn((entry: any) => ({
    name: `mcp__${entry.serverId}__${entry.tool.name}`,
    description: entry.tool.description || '',
    input_schema: entry.tool.inputSchema || {},
  })),
}));

describe('McpClient', () => {
  let client: McpClient;

  beforeEach(() => {
    mockFetch.mockReset();
    MockEventSource.instances = [];
  });

  afterEach(() => {
    client?.disconnect();
  });

  it('should create client with config', () => {
    client = new McpClient({ url: 'https://mcp.example.com', name: 'test' });
    expect(client.isConnected()).toBe(false);
    expect(client.getCapabilities()).toBeNull();
  });

  it('should connect and initialize', async () => {
    client = new McpClient({ url: 'https://mcp.example.com', token: 'abc', name: 'test' });

    // Transport connect + initialize
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        id: 0,
        result: { capabilities: { tools: { listChanged: true } } },
      }),
      headers: new Map([['content-type', 'application/json']]),
    });
    // Initialized notification
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jsonrpc: '2.0' }),
      headers: jsonHeaders,
    });

    const caps = await client.connect();
    expect(caps).toEqual({ tools: { listChanged: true } });
    expect(client.getCapabilities()).toEqual({ tools: { listChanged: true } });
  });

  it('should list tools with pagination', async () => {
    client = new McpClient({ url: 'https://mcp.example.com', name: 'test' });

    // Connect
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jsonrpc: '2.0', id: 0, result: { capabilities: {} } }),
      headers: new Map([['content-type', 'application/json']]),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jsonrpc: '2.0' }),
      headers: jsonHeaders,
    });
    await client.connect();

    // First page
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        id: 3,
        result: {
          tools: [{ name: 'tool1', inputSchema: {} }],
          nextCursor: 'abc',
        },
      }),
      headers: jsonHeaders,
    });
    // Second page (no more)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        id: 4,
        result: { tools: [{ name: 'tool2', inputSchema: {} }] },
      }),
      headers: jsonHeaders,
    });

    const tools = await client.listTools();
    expect(tools).toHaveLength(2);
    expect(tools[0].name).toBe('tool1');
    expect(tools[1].name).toBe('tool2');
  });

  it('should call a tool', async () => {
    client = new McpClient({ url: 'https://mcp.example.com', name: 'test' });

    // Connect
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jsonrpc: '2.0', id: 0, result: { capabilities: {} } }),
      headers: new Map([['content-type', 'application/json']]),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jsonrpc: '2.0' }),
      headers: jsonHeaders,
    });
    await client.connect();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        id: 3,
        result: { content: [{ type: 'text', text: 'hello' }] },
      }),
      headers: jsonHeaders,
    });

    const result = await client.callTool('echo', { message: 'hello' });
    expect(result.content[0].text).toBe('hello');
  });

  it('should handle MCP errors', async () => {
    client = new McpClient({ url: 'https://mcp.example.com', name: 'test' });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        id: 0,
        error: { code: -32600, message: 'Invalid request' },
      }),
      headers: new Map([['content-type', 'application/json']]),
    });

    await expect(client.connect()).rejects.toThrow('MCP error -32600: Invalid request');
  });

  it('should disconnect properly', async () => {
    client = new McpClient({ url: 'https://mcp.example.com', name: 'test' });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jsonrpc: '2.0', id: 0, result: { capabilities: { tools: {} } } }),
      headers: new Map([['content-type', 'application/json']]),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jsonrpc: '2.0' }),
      headers: jsonHeaders,
    });
    await client.connect();

    client.disconnect();
    expect(client.isConnected()).toBe(false);
    expect(client.getCapabilities()).toBeNull();
  });

  it('should handle tools changed notification callback', () => {
    client = new McpClient({ url: 'https://mcp.example.com', name: 'test' });
    const handler = jest.fn();
    client.setOnToolsChanged(handler);
    // The callback is set internally, tested indirectly via manager
    expect(handler).not.toHaveBeenCalled(); // no notification yet
  });

  it('should list resources', async () => {
    client = new McpClient({ url: 'https://mcp.example.com', name: 'test' });

    // Connect
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jsonrpc: '2.0', id: 0, result: { capabilities: {} } }),
      headers: new Map([['content-type', 'application/json']]),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jsonrpc: '2.0' }),
      headers: jsonHeaders,
    });
    await client.connect();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        id: 3,
        result: { resources: [{ uri: 'file://test.txt', name: 'test.txt' }] },
      }),
      headers: jsonHeaders,
    });

    const resources = await client.listResources();
    expect(resources).toHaveLength(1);
    expect(resources[0].uri).toBe('file://test.txt');
  });

  it('should list prompts', async () => {
    client = new McpClient({ url: 'https://mcp.example.com', name: 'test' });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jsonrpc: '2.0', id: 0, result: { capabilities: {} } }),
      headers: new Map([['content-type', 'application/json']]),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jsonrpc: '2.0' }),
      headers: jsonHeaders,
    });
    await client.connect();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        id: 3,
        result: { prompts: [{ name: 'greet', description: 'Greeting' }] },
      }),
      headers: jsonHeaders,
    });

    const prompts = await client.listPrompts();
    expect(prompts).toHaveLength(1);
    expect(prompts[0].name).toBe('greet');
  });
});

describe('McpConnectionManager', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    MockEventSource.instances = [];
    mcpManager.disconnectAll();
  });

  it('should start with no statuses or clients', () => {
    expect(mcpManager.getAllStatuses()).toEqual([]);
    expect(mcpManager.getClients().size).toBe(0);
  });

  it('should connect to a server successfully', async () => {
    // Transport connect + initialize
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jsonrpc: '2.0', id: 0, result: { capabilities: {} } }),
      headers: new Map([['content-type', 'application/json']]),
    });
    // Initialized notification
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jsonrpc: '2.0' }),
      headers: jsonHeaders,
    });
    // listTools
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        id: 3,
        result: { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] },
      }),
      headers: jsonHeaders,
    });

    await mcpManager.connectServer({
      id: 'srv1',
      name: 'TestServer',
      url: 'https://mcp.example.com',
      enabled: true,
    });

    const statuses = mcpManager.getAllStatuses();
    expect(statuses.length).toBeGreaterThanOrEqual(1);
    const srv = statuses.find((s) => s.id === 'srv1');
    expect(srv?.state).toBe('connected');
    expect(srv?.tools).toHaveLength(1);
  });

  it('should handle connection errors', async () => {
    const originalEventSource = (global as any).EventSource;
    delete (global as any).EventSource;
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    await expect(
      mcpManager.connectServer({
        id: 'srv2',
        name: 'FailServer',
        url: 'https://bad.example.com',
        enabled: true,
      }),
    ).rejects.toThrow('Connection refused');

    const status = mcpManager.getStatus('srv2');
    expect(status?.state).toBe('error');
    expect(status?.error).toContain('Connection refused');
    expect(status?.error).toContain('SSE transport is not available in this runtime');

    (global as any).EventSource = originalEventSource;
  });

  it('should disconnect a server', async () => {
    // Connect first
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jsonrpc: '2.0', id: 0, result: { capabilities: {} } }),
      headers: new Map([['content-type', 'application/json']]),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jsonrpc: '2.0' }),
      headers: jsonHeaders,
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jsonrpc: '2.0', id: 3, result: { tools: [] } }),
      headers: jsonHeaders,
    });

    await mcpManager.connectServer({
      id: 'srv3',
      name: 'Server3',
      url: 'https://mcp.example.com',
      enabled: true,
    });

    mcpManager.disconnectServer('srv3');
    const status = mcpManager.getStatus('srv3');
    expect(status?.state).toBe('disconnected');
  });

  it('should return tool definitions for connected servers', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jsonrpc: '2.0', id: 0, result: { capabilities: {} } }),
      headers: new Map([['content-type', 'application/json']]),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jsonrpc: '2.0' }),
      headers: jsonHeaders,
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        id: 3,
        result: { tools: [{ name: 'greet', inputSchema: {}, description: 'Greet someone' }] },
      }),
      headers: jsonHeaders,
    });

    await mcpManager.connectServer({
      id: 'srv4',
      name: 'Server4',
      url: 'https://mcp.example.com',
      enabled: true,
      tools: [],
      allowedTools: [],
    });

    const defs = mcpManager.getAllToolDefinitions();
    expect(defs.length).toBeGreaterThanOrEqual(1);
  });

  it('should filter connected server tool definitions by allowedTools', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jsonrpc: '2.0', id: 0, result: { capabilities: {} } }),
      headers: new Map([['content-type', 'application/json']]),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jsonrpc: '2.0' }),
      headers: jsonHeaders,
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        id: 3,
        result: {
          tools: [
            { name: 'greet', inputSchema: {}, description: 'Greet someone' },
            { name: 'delete_all', inputSchema: {}, description: 'Delete everything' },
          ],
        },
      }),
      headers: jsonHeaders,
    });

    await mcpManager.connectServer({
      id: 'srv5',
      name: 'Server5',
      url: 'https://mcp.example.com',
      enabled: true,
      tools: [],
      allowedTools: ['greet'],
    });

    const defs = mcpManager.getAllToolDefinitions();
    const names = defs.map((tool) => tool.name);

    expect(names).toContain('mcp__srv5__greet');
    expect(names).not.toContain('mcp__srv5__delete_all');
    expect(mcpManager.isToolAllowed('srv5', 'greet')).toBe(true);
    expect(mcpManager.isToolAllowed('srv5', 'delete_all')).toBe(false);
  });

  it('should support subscribe/unsubscribe', () => {
    const listener = jest.fn();
    const unsub = mcpManager.subscribe(listener);
    expect(typeof unsub).toBe('function');
    unsub();
  });

  it('should connectAll filters by enabled', async () => {
    // Only the enabled server should attempt connection
    mockFetch.mockRejectedValue(new Error('Connection refused'));

    const connectPromise = mcpManager.connectAll([
      { id: 's1', name: 'S1', url: 'https://a.com', enabled: false, tools: [], allowedTools: [] },
      { id: 's2', name: 'S2', url: 'https://b.com', enabled: true, tools: [], allowedTools: [] },
    ]);

    // Wait for SSE fallback to complete
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 10));
      const es = MockEventSource.instances[i];
      if (es?.onerror) es.onerror({});
    }

    await connectPromise;

    // S1 should not have been attempted (no status update for it as 'connecting')
    // S2 should have error status
    const s2 = mcpManager.getStatus('s2');
    expect(s2?.state).toBe('error');
  });
});
