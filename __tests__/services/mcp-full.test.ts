// ---------------------------------------------------------------------------
// MCP Client, Transport & Manager — comprehensive tests
// ---------------------------------------------------------------------------

import { McpTransport, JsonRpcRequest } from '../../src/services/mcp/transport';
import { McpClient } from '../../src/services/mcp/client';
import { mcpManager } from '../../src/services/mcp/manager';

// ── Mock fetch ───────────────────────────────────────────────────────────

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

const jsonHeaders = {
  get: (name?: string) => (name?.toLowerCase() === 'content-type' ? 'application/json' : null),
};

const sseHeaders = {
  get: (name?: string) => (name?.toLowerCase() === 'content-type' ? 'text/event-stream' : null),
};

// ── Mock EventSource ─────────────────────────────────────────────────────

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

// ── Mock events/bus ──────────────────────────────────────────────────────

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

// ═══════════════════════════════════════════════════════════════════════════
// McpTransport
// ═══════════════════════════════════════════════════════════════════════════

describe('McpTransport', () => {
  let transport: McpTransport;

  beforeEach(() => {
    mockFetch.mockReset();
    MockEventSource.instances = [];
    transport = new McpTransport({ url: 'https://example.com/mcp', timeout: 5000 });
    transport.setHandlers({
      onMessage: jest.fn(),
      onError: jest.fn(),
      onClose: jest.fn(),
    });
  });

  afterEach(() => {
    transport.disconnect();
  });

  it('should start disconnected', () => {
    expect(transport.isConnected()).toBe(false);
  });

  it('should connect via streamable HTTP', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        id: 0,
        result: { protocolVersion: '2025-06-18', capabilities: {} },
      }),
      headers: new Map([['content-type', 'application/json']]),
    });
    await transport.connect();
    expect(transport.isConnected()).toBe(true);
    expect(transport.getTransportType()).toBe('streamable-http');
  });

  it('should connect via streamable HTTP without AbortSignal.timeout support', async () => {
    const originalAbortSignal = (global as any).AbortSignal;
    (global as any).AbortSignal = undefined;

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        id: 0,
        result: { protocolVersion: '2025-06-18', capabilities: {} },
      }),
      headers: new Map([['content-type', 'application/json']]),
    });

    await transport.connect();

    expect(transport.isConnected()).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/mcp',
      expect.objectContaining({ signal: expect.any(Object) }),
    );

    (global as any).AbortSignal = originalAbortSignal;
  });

  it('should fallback to SSE if streamable HTTP fails', async () => {
    // streamable HTTP fails
    mockFetch.mockRejectedValueOnce(new Error('not supported'));

    // SSE will be attempted via EventSource
    const connectPromise = transport.connect();

    // Simulate SSE endpoint event
    await new Promise((r) => setTimeout(r, 10));
    const es = MockEventSource.instances[0];
    expect(es).toBeDefined();
    es.emit('endpoint', { data: '/mcp/message' });

    await connectPromise;
    expect(transport.isConnected()).toBe(true);
    expect(transport.getTransportType()).toBe('sse');
  });

  it('clears the SSE fallback timeout after a successful endpoint handshake', async () => {
    jest.useFakeTimers();
    transport.disconnect();
    transport = new McpTransport({
      url: 'https://example.com/mcp',
      timeout: 5000,
      transportPreference: 'sse',
    });

    try {
      const connectPromise = transport.connect();
      const es = MockEventSource.instances[0];
      expect(es).toBeDefined();

      es.emit('endpoint', { data: '/mcp/message' });
      await connectPromise;

      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('should throw if both transports fail', async () => {
    mockFetch.mockRejectedValueOnce(new Error('not supported'));

    const connectPromise = transport.connect().catch((err) => err as Error);

    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 10));
      const es = MockEventSource.instances[i];
      if (es?.onerror) es.onerror({});
    }

    const error = await connectPromise;
    expect(error.message).toContain('Failed to connect via both streamable HTTP and SSE');
  });

  it('should report SSE runtime support errors clearly', async () => {
    const originalEventSource = (global as any).EventSource;
    delete (global as any).EventSource;
    mockFetch.mockRejectedValueOnce(new Error('not supported'));

    await expect(transport.connect()).rejects.toThrow(
      'SSE transport is not available in this runtime',
    );

    (global as any).EventSource = originalEventSource;
  });

  it('should not fallback to SSE on authentication errors', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => JSON.stringify({ error: { message: 'Unauthorized' } }),
      headers: jsonHeaders,
    });

    await expect(transport.connect()).rejects.toThrow('MCP authentication required');
    expect(MockEventSource.instances).toHaveLength(0);
  });

  it('should send requests successfully', async () => {
    // Connect first
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        id: 0,
        result: { protocolVersion: '2025-06-18', capabilities: {} },
      }),
      headers: new Map([['content-type', 'application/json']]),
    });
    await transport.connect();

    // Send a request
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jsonrpc: '2.0', id: 1, result: { tools: [] } }),
      headers: jsonHeaders,
    });

    const req: JsonRpcRequest = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
    const res = await transport.send(req);
    expect(res.result).toEqual({ tools: [] });
    expect(mockFetch).toHaveBeenLastCalledWith(
      'https://example.com/mcp',
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': '2025-06-18',
        }),
      }),
    );
  });

  it('should throw if not connected when sending', async () => {
    const req: JsonRpcRequest = { jsonrpc: '2.0', id: 1, method: 'test', params: {} };
    await expect(transport.send(req)).rejects.toThrow('Transport not connected');
  });

  it('should handle SSE response format', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        id: 0,
        result: { protocolVersion: '2025-06-18', capabilities: {} },
      }),
      headers: new Map([['content-type', 'application/json']]),
    });
    await transport.connect();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => 'data: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n',
      headers: sseHeaders,
    });

    const res = await transport.send({ jsonrpc: '2.0', id: 1, method: 'test', params: {} });
    expect(res.result).toEqual({ ok: true });
  });

  it('should throw on failed HTTP responses', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        id: 0,
        result: { protocolVersion: '2025-06-18', capabilities: {} },
      }),
      headers: new Map([['content-type', 'application/json']]),
    });
    await transport.connect();

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 406,
      text: async () =>
        JSON.stringify({
          jsonrpc: '2.0',
          id: 'server-error',
          error: {
            code: -32600,
            message:
              'Not Acceptable: Client must accept both application/json and text/event-stream',
          },
        }),
      statusText: 'Not Acceptable',
      headers: jsonHeaders,
    });

    await expect(
      transport.send({ jsonrpc: '2.0', id: 1, method: 'test', params: {} }),
    ).rejects.toThrow('Client must accept both application/json and text/event-stream');
  });

  it('should disconnect and clean up', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        id: 0,
        result: { protocolVersion: '2025-06-18', capabilities: {} },
      }),
      headers: new Map([['content-type', 'application/json']]),
    });
    await transport.connect();
    expect(transport.isConnected()).toBe(true);

    transport.disconnect();
    expect(transport.isConnected()).toBe(false);
  });

  it('should handle SSE messages via onMessage callback', async () => {
    const onMessage = jest.fn();
    transport.setHandlers({ onMessage, onError: jest.fn(), onClose: jest.fn() });

    // Fail streamable HTTP to use SSE
    mockFetch.mockRejectedValueOnce(new Error('not supported'));
    const connectPromise = transport.connect();

    await new Promise((r) => setTimeout(r, 10));
    const es = MockEventSource.instances[0];
    es.emit('endpoint', { data: '/mcp/message' });
    await connectPromise;

    // Now simulate incoming SSE message
    es.emit('message', { data: '{"jsonrpc":"2.0","method":"notification","params":{}}' });
    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ method: 'notification' }));
  });

  it('should handle malformed SSE messages gracefully', async () => {
    const onMessage = jest.fn();
    transport.setHandlers({ onMessage, onError: jest.fn(), onClose: jest.fn() });

    mockFetch.mockRejectedValueOnce(new Error('not supported'));
    const connectPromise = transport.connect();

    await new Promise((r) => setTimeout(r, 10));
    const es = MockEventSource.instances[0];
    es.emit('endpoint', { data: '/mcp/message' });
    await connectPromise;

    // Send malformed JSON
    es.emit('message', { data: 'not valid json' });
    expect(onMessage).not.toHaveBeenCalled();
  });

  it('should handle absolute URL in SSE endpoint event', async () => {
    mockFetch.mockRejectedValueOnce(new Error('not supported'));
    const connectPromise = transport.connect();

    await new Promise((r) => setTimeout(r, 10));
    const es = MockEventSource.instances[0];
    es.emit('endpoint', { data: 'https://alt-server.com/mcp/message' });
    await connectPromise;

    expect(transport.isConnected()).toBe(true);
  });

  it('should throw on SSE response with no valid data lines', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: '2.0',
        id: 0,
        result: { protocolVersion: '2025-06-18', capabilities: {} },
      }),
      headers: new Map([['content-type', 'application/json']]),
    });
    await transport.connect();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => 'event: heartbeat\n\n',
      headers: sseHeaders,
    });

    await expect(
      transport.send({ jsonrpc: '2.0', id: 1, method: 'test', params: {} }),
    ).rejects.toThrow('No valid JSON-RPC response');
  });

  it('should handle streamable HTTP non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: async () => '',
      headers: jsonHeaders,
    });
    // Should fallback to SSE
    const connectPromise = transport.connect();

    await new Promise((r) => setTimeout(r, 10));
    const es = MockEventSource.instances[0];
    if (es) {
      es.emit('endpoint', { data: '/mcp/msg' });
      await connectPromise;
      expect(transport.getTransportType()).toBe('sse');
    } else {
      // If no EventSource created, connect fails
      await expect(connectPromise).rejects.toThrow();
    }
  });

  it('should disconnect SSE EventSource on disconnect', async () => {
    mockFetch.mockRejectedValueOnce(new Error('not supported'));
    const connectPromise = transport.connect();

    await new Promise((r) => setTimeout(r, 10));
    const es = MockEventSource.instances[0];
    es.emit('endpoint', { data: '/mcp/message' });
    await connectPromise;

    expect(es.closed).toBe(false);
    transport.disconnect();
    expect(es.closed).toBe(true);
    expect(transport.isConnected()).toBe(false);
  });

  it('does not reconnect after an explicit disconnect if a stale SSE error arrives later', async () => {
    jest.useFakeTimers();
    transport.disconnect();
    transport = new McpTransport({
      url: 'https://example.com/mcp',
      timeout: 5000,
      transportPreference: 'sse',
    });
    transport.setHandlers({ onMessage: jest.fn(), onError: jest.fn(), onClose: jest.fn() });

    try {
      const connectPromise = transport.connect();
      const es = MockEventSource.instances[0];
      expect(es).toBeDefined();

      es.emit('endpoint', { data: '/mcp/message' });
      await connectPromise;

      transport.disconnect();
      es.onerror?.({});
      jest.advanceTimersByTime(5000);

      expect(MockEventSource.instances).toHaveLength(1);
      expect(jest.getTimerCount()).toBe(0);
      expect(transport.isConnected()).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// McpClient
// ═══════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════
// McpConnectionManager (singleton mcpManager)
// ═══════════════════════════════════════════════════════════════════════════

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
