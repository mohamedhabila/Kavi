const mockExpoFetch = jest.fn();

jest.mock('expo/fetch', () => ({
  fetch: (...args: unknown[]) => mockExpoFetch(...args),
}));

import { McpTransport } from '../../src/services/mcp/transport';
import {
  createMcpHttpError,
  formatTransportError,
  hasConfiguredMcpAuth,
  McpTransportError,
  shouldFallbackToLegacySse,
} from '../../src/services/mcp/transportErrors';
import {
  parseJsonOrSsePayload,
  parseSseStreamPayload,
  readSseJsonRpcResponse,
} from '../../src/services/mcp/transportFraming';
import { connectMcpSseTransport } from '../../src/services/mcp/transportSseConnection';

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

class MockEventSource {
  static instances: MockEventSource[] = [];
  listeners: Record<string, Array<(event: { data: string }) => void>> = {};
  onerror: ((event: unknown) => void) | null = null;
  closed = false;

  constructor(public url: string) {
    MockEventSource.instances.push(this);
  }

  addEventListener(event: string, handler: (event: { data: string }) => void) {
    this.listeners[event] = [...(this.listeners[event] ?? []), handler];
  }

  close() {
    this.closed = true;
  }

  emit(event: string, data: string) {
    for (const handler of this.listeners[event] ?? []) {
      handler({ data });
    }
  }
}

const originalEventSource = (global as any).EventSource;

function responseHeaders(values: Record<string, string> = {}) {
  const normalized = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return {
    get: (name?: string) => (name ? (normalized[name.toLowerCase()] ?? null) : null),
  };
}

function jsonResponse(body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: responseHeaders({ 'content-type': 'application/json', ...headers }),
  };
}

function textResponse(text: string, headers: Record<string, string> = {}) {
  return {
    ok: true,
    status: 200,
    text: async () => text,
    json: async () => JSON.parse(text),
    headers: responseHeaders(headers),
  };
}

function errorResponse(status: number, text: string, headers: Record<string, string> = {}) {
  return {
    ok: false,
    status,
    statusText: `HTTP ${status}`,
    text: async () => text,
    headers: responseHeaders(headers),
  } as Response;
}

function streamFromText(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

async function waitForMicrotasks(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('MCP transport framing helpers', () => {
  it('parses JSON and SSE payloads without exposing malformed blocks', async () => {
    expect(parseJsonOrSsePayload('{"ok":true}')).toEqual({ ok: true });
    expect(parseJsonOrSsePayload('event: ping\n\ndata: {"ok":true}\n\n')).toEqual({ ok: true });
    expect(parseJsonOrSsePayload('event: ping\n\n')).toBeNull();

    expect(parseSseStreamPayload('data: {"jsonrpc":"2.0","method":"notice"}')).toEqual({
      parsed: true,
      value: { jsonrpc: '2.0', method: 'notice' },
    });
    expect(parseSseStreamPayload('data: not-json')).toEqual({ parsed: false });

    await expect(
      readSseJsonRpcResponse(
        textResponse('event: ping\n\ndata: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n\n', {
          'content-type': 'text/event-stream',
        }) as Response,
      ),
    ).resolves.toMatchObject({ result: { ok: true } });
  });
});

describe('MCP transport error helpers', () => {
  it('normalizes authentication and server response errors', async () => {
    await expect(
      createMcpHttpError('MCP initialize failed', errorResponse(401, '{}'), {
        hasConfiguredAuth: true,
      }),
    ).resolves.toMatchObject({
      message: 'MCP authentication failed. Check the configured token or custom auth headers.',
      requiresAuthentication: true,
      statusCode: 401,
    });

    await expect(
      createMcpHttpError('MCP request failed', errorResponse(403, '{}'), {
        hasConfiguredAuth: false,
      }),
    ).resolves.toMatchObject({
      message: 'MCP access forbidden. Check the configured scopes, token, or custom auth headers.',
      requiresAuthentication: true,
      statusCode: 403,
    });

    await expect(
      createMcpHttpError(
        'MCP request failed',
        errorResponse(500, JSON.stringify({ message: 'server unavailable' })),
        { hasConfiguredAuth: false },
      ),
    ).resolves.toMatchObject({
      message: 'MCP request failed: HTTP 500 - server unavailable',
      shouldFallbackToSse: false,
    });

    await expect(
      createMcpHttpError('MCP request failed', errorResponse(404, 'missing'), {
        hasConfiguredAuth: false,
      }),
    ).resolves.toMatchObject({
      message: 'MCP request failed: HTTP 404 - missing',
      shouldFallbackToSse: true,
    });
  });

  it('detects configured auth and formats fallback decisions', () => {
    expect(hasConfiguredMcpAuth({ Authorization: 'Bearer token' })).toBe(true);
    expect(hasConfiguredMcpAuth({ 'X-Api-Key': 'key' })).toBe(true);
    expect(hasConfiguredMcpAuth({ Accept: 'application/json' })).toBe(false);

    expect(shouldFallbackToLegacySse(new McpTransportError('nope'))).toBe(false);
    expect(
      shouldFallbackToLegacySse(new McpTransportError('missing', { shouldFallbackToSse: true })),
    ).toBe(true);
    expect(shouldFallbackToLegacySse(new Error('network'))).toBe(true);
    expect(formatTransportError('plain')).toBe('plain');
  });
});

describe('MCP SSE connection helper', () => {
  beforeEach(() => {
    (global as any).EventSource = MockEventSource;
    MockEventSource.instances = [];
  });

  afterEach(() => {
    (global as any).EventSource = originalEventSource;
    jest.useRealTimers();
  });

  it('tries candidate endpoints until the SSE handshake succeeds', async () => {
    jest.useFakeTimers();
    const connection = connectMcpSseTransport({
      config: { url: 'https://example.com/mcp', timeout: 50 },
      onMessage: jest.fn(),
      onDisconnect: jest.fn(),
    });

    expect(MockEventSource.instances[0]?.url).toBe('https://example.com/mcp');
    jest.advanceTimersByTime(50);
    await Promise.resolve();
    expect(MockEventSource.instances[0]?.closed).toBe(true);
    expect(MockEventSource.instances[1]?.url).toBe('https://example.com/mcp/sse');

    MockEventSource.instances[1].emit('endpoint', '/message');
    await expect(connection).resolves.toMatchObject({
      eventSource: MockEventSource.instances[1],
      messageEndpoint: 'https://example.com/message',
    });
  });
});

describe('McpTransport focused lifecycle coverage', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockExpoFetch.mockReset();
    (global as any).EventSource = MockEventSource;
    MockEventSource.instances = [];
  });

  afterEach(() => {
    (global as any).EventSource = originalEventSource;
    jest.useRealTimers();
  });

  it('honors explicit transport preferences', async () => {
    const httpTransport = new McpTransport({
      url: 'https://example.com/mcp',
      transportPreference: 'streamable-http',
    });
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ jsonrpc: '2.0', id: 0, result: { capabilities: {} } }),
    );

    await httpTransport.connect();
    expect(httpTransport.getTransportType()).toBe('streamable-http');

    const sseTransport = new McpTransport({
      url: 'https://example.com/mcp',
      transportPreference: 'sse',
    });
    const sseConnect = sseTransport.connect();
    MockEventSource.instances[0].emit('endpoint', '/message');

    await sseConnect;
    expect(sseTransport.getTransportType()).toBe('sse');
    httpTransport.disconnect();
    sseTransport.disconnect();
  });

  it('uses dynamic auth headers, session headers, and streamable standalone events', async () => {
    const onMessage = jest.fn();
    const transport = new McpTransport({
      url: 'https://example.com/mcp',
      authHeadersProvider: async () => ({ Authorization: 'Bearer dynamic' }),
    });
    transport.setHandlers({ onMessage, onError: jest.fn(), onClose: jest.fn() });
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse(
          {
            jsonrpc: '2.0',
            id: 0,
            result: { protocolVersion: '2025-06-18', capabilities: {} },
          },
          { 'mcp-session-id': 'session-1' },
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ jsonrpc: '2.0' }));
    mockExpoFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: streamFromText('data: {"jsonrpc":"2.0","method":"notifications/tools/list_changed"}\n\n'),
      headers: responseHeaders({ 'mcp-session-id': 'session-2' }),
    });

    await transport.connect();
    await transport.send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
    await waitForMicrotasks();

    expect(mockFetch).toHaveBeenLastCalledWith(
      'https://example.com/mcp',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer dynamic',
          'Mcp-Session-Id': 'session-1',
          'MCP-Protocol-Version': '2025-06-18',
        }),
      }),
    );
    expect(mockExpoFetch).toHaveBeenCalledWith(
      'https://example.com/mcp',
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'text/event-stream',
          Authorization: 'Bearer dynamic',
          'Mcp-Session-Id': 'session-1',
        }),
      }),
    );
    expect(onMessage).toHaveBeenCalledWith({
      jsonrpc: '2.0',
      method: 'notifications/tools/list_changed',
    });

    transport.disconnect();
  });

  it('reconnects after an established SSE connection reports an error', async () => {
    jest.useFakeTimers();
    const onClose = jest.fn();
    const transport = new McpTransport({
      url: 'https://example.com/mcp',
      transportPreference: 'sse',
    });
    transport.setHandlers({ onMessage: jest.fn(), onError: jest.fn(), onClose });

    const initialConnect = transport.connect();
    MockEventSource.instances[0].emit('endpoint', '/message');
    await initialConnect;

    MockEventSource.instances[0].onerror?.({});
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(MockEventSource.instances[0].closed).toBe(true);

    jest.advanceTimersByTime(1000);
    await Promise.resolve();
    expect(MockEventSource.instances[1]).toBeDefined();

    MockEventSource.instances[1].emit('endpoint', '/message');
    await Promise.resolve();
    await Promise.resolve();
    expect(transport.isConnected()).toBe(true);

    transport.disconnect();
  });
});
