// ---------------------------------------------------------------------------
// Gateway Client — tests
// ---------------------------------------------------------------------------

jest.mock('../../src/utils/id', () => ({
  generateId: jest.fn().mockReturnValue('mock-gw-id'),
}));

// Mock the protocol module
jest.mock('../../src/services/gateway/protocol', () => ({
  createRequest: jest.fn().mockImplementation((method: string, params?: any) => ({
    jsonrpc: '2.0',
    id: `req-${Date.now()}`,
    method,
    params: params ?? {},
  })),
  createResponse: jest.fn().mockImplementation((id: any, result: any) => ({
    jsonrpc: '2.0',
    id,
    result,
  })),
  createErrorResponse: jest.fn().mockImplementation((id: any, code: number, msg: string) => ({
    jsonrpc: '2.0',
    id,
    error: { code, message: msg },
  })),
  createNotification: jest.fn().mockImplementation((method: string, params?: any) => ({
    jsonrpc: '2.0',
    method,
    params: params ?? {},
  })),
  parseMessage: jest.fn().mockImplementation((data: string) => JSON.parse(data)),
  isRequest: jest.fn().mockImplementation((msg: any) => !!msg.method && msg.id != null),
  isResponse: jest
    .fn()
    .mockImplementation((msg: any) => msg.result !== undefined || msg.error !== undefined),
  GATEWAY_METHODS: {
    AUTH: 'auth',
    PING: 'ping',
    NODE_REGISTER: 'node.register',
    NODE_LIST: 'node.list',
    NODE_INVOKE: 'node.invoke',
    PAIRING_REQUEST: 'pairing.request',
  },
  RPC_ERRORS: {
    PARSE_ERROR: -32700,
    INVALID_REQUEST: -32600,
    METHOD_NOT_FOUND: -32601,
    INTERNAL_ERROR: -32603,
  },
}));

const mockSend = jest.fn();
const mockClose = jest.fn();
let mockOnOpen: (() => void) | null = null;
let mockOnMessage: ((e: { data: string }) => void) | null = null;
let mockOnClose: ((e: any) => void) | null = null;
let mockOnError: ((e: any) => void) | null = null;

class MockWebSocket {
  static OPEN = 1;
  url: string;
  readyState = 1;
  constructor(url: string) {
    this.url = url;
    setTimeout(() => mockOnOpen?.(), 0);
  }
  send = mockSend;
  close = mockClose;
  set onopen(fn: any) {
    mockOnOpen = fn;
  }
  set onmessage(fn: any) {
    mockOnMessage = fn;
  }
  set onclose(fn: any) {
    mockOnClose = fn;
  }
  set onerror(fn: any) {
    mockOnError = fn;
  }
}

(global as any).WebSocket = MockWebSocket;

import {
  GatewayClient,
  createGatewayClient,
  getGatewayClient,
  disconnectGateway,
} from '../../src/services/gateway/client';

const defaultConfig = { url: 'ws://test', token: 'test-token' };

describe('Gateway Client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    disconnectGateway();
    mockOnOpen = null;
    mockOnMessage = null;
    mockOnClose = null;
    mockOnError = null;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('GatewayClient constructor', () => {
    it('creates with config and defaults', () => {
      const client = new GatewayClient(defaultConfig);
      expect(client.getState()).toBe('disconnected');
      expect(client.getNodeId()).toContain('mobile-');
      expect(client.isConnected()).toBe(false);
    });
  });

  describe('connect', () => {
    it('sets state to connecting', () => {
      const client = new GatewayClient(defaultConfig);
      client.connect();
      expect(client.getState()).toBe('connecting');
    });

    it('does not connect twice', () => {
      const client = new GatewayClient(defaultConfig);
      client.connect();
      client.connect(); // second call should be no-op
      expect(client.getState()).toBe('connecting');
    });

    it('does not connect after disconnect (destroyed)', () => {
      const client = new GatewayClient(defaultConfig);
      client.connect();
      client.disconnect();
      client.connect(); // should be no-op since destroyed
      expect(client.getState()).toBe('disconnected');
    });
  });

  describe('onStateChange subscriber', () => {
    it('notifies on state transitions', () => {
      const client = new GatewayClient(defaultConfig);
      const states: string[] = [];
      client.onStateChange((s) => states.push(s));
      client.connect();
      expect(states).toContain('connecting');
    });

    it('returns unsubscribe function', () => {
      const client = new GatewayClient(defaultConfig);
      const cb = jest.fn();
      const unsub = client.onStateChange(cb);
      unsub();
      client.connect();
      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe('disconnect', () => {
    it('closes websocket and sets state', () => {
      const client = new GatewayClient(defaultConfig);
      client.connect();
      client.disconnect();
      expect(client.getState()).toBe('disconnected');
    });
  });

  describe('setCapabilities', () => {
    it('sets capabilities', () => {
      const client = new GatewayClient(defaultConfig);
      client.setCapabilities([{ name: 'chat', description: 'Chat', version: '1' }]);
      // No error
    });
  });

  describe('notify', () => {
    it('sends notification when connected', () => {
      const client = new GatewayClient(defaultConfig);
      client.connect();
      // Simulate connected state by triggering onopen
      mockOnOpen?.();
      client.notify('test.method', { key: 'value' });
      expect(mockSend).toHaveBeenCalled();
    });

    it('does nothing when not connected', () => {
      const client = new GatewayClient(defaultConfig);
      // Not connected — notify is a no-op
      const sendCountBefore = mockSend.mock.calls.length;
      client.notify('test.method', { key: 'value' });
      expect(mockSend.mock.calls.length).toBe(sendCountBefore);
    });
  });

  describe('request', () => {
    function connectAndAuth(client: GatewayClient) {
      client.connect();
      mockOnOpen?.();
      // handleOpen sends auth request, state is 'authenticating'
      const authReq = JSON.parse(mockSend.mock.calls[0][0]);
      // Simulate auth success response → state becomes 'connected'
      mockOnMessage?.({
        data: JSON.stringify({ jsonrpc: '2.0', id: authReq.id, result: { authenticated: true } }),
      });
    }

    it('sends request and resolves on response', async () => {
      const client = new GatewayClient(defaultConfig);
      connectAndAuth(client);

      const promise = client.request('test.method', { data: 1 });

      // Get the request ID from the sent message (index 0 was auth, so latest is index after)
      const sentMsg = JSON.parse(mockSend.mock.calls[mockSend.mock.calls.length - 1][0]);

      // Simulate server response
      mockOnMessage?.({ data: JSON.stringify({ jsonrpc: '2.0', id: sentMsg.id, result: 'ok' }) });

      const result = await promise;
      expect(result).toBe('ok');
    });

    it('rejects on timeout', async () => {
      const client = new GatewayClient(defaultConfig);
      connectAndAuth(client);

      const promise = client.request('test.method', {}, 1000);
      jest.advanceTimersByTime(1500);

      await expect(promise).rejects.toThrow();
    });
  });

  describe('handleMessage', () => {
    function connectAndAuth(client: GatewayClient) {
      client.connect();
      mockOnOpen?.();
      const authReq = JSON.parse(mockSend.mock.calls[0][0]);
      mockOnMessage?.({
        data: JSON.stringify({ jsonrpc: '2.0', id: authReq.id, result: { authenticated: true } }),
      });
    }

    it('handles auth success response', () => {
      const handlers = { onConnect: jest.fn() };
      const client = new GatewayClient(defaultConfig, handlers);
      client.connect();
      mockOnOpen?.();

      // Simulate auth success
      const authReqMsg = JSON.parse(mockSend.mock.calls[0]?.[0] || '{}');
      if (authReqMsg.id) {
        mockOnMessage?.({
          data: JSON.stringify({
            jsonrpc: '2.0',
            id: authReqMsg.id,
            result: { authenticated: true },
          }),
        });
      }
      expect(client.getState()).toBe('connected');
    });

    it('handles auth failure response', () => {
      const handlers = { onError: jest.fn() };
      const client = new GatewayClient(defaultConfig, handlers);
      client.connect();
      mockOnOpen?.();

      const authReqMsg = JSON.parse(mockSend.mock.calls[0]?.[0] || '{}');
      if (authReqMsg.id) {
        mockOnMessage?.({
          data: JSON.stringify({
            jsonrpc: '2.0',
            id: authReqMsg.id,
            error: { code: -1, message: 'Invalid token' },
          }),
        });
      }
      expect(client.getState()).toBe('error');
      expect(handlers.onError).toHaveBeenCalled();
    });

    it('handles incoming request (invoke)', () => {
      const handlers = { onInvoke: jest.fn().mockResolvedValue({ result: 'done' }) };
      const client = new GatewayClient(defaultConfig, handlers);
      connectAndAuth(client);

      mockOnMessage?.({
        data: JSON.stringify({
          jsonrpc: '2.0',
          id: 'req-1',
          method: 'invoke',
          params: { action: 'test' },
        }),
      });
      expect(handlers.onInvoke).toHaveBeenCalled();
    });

    it('handles incoming request with no onInvoke handler', () => {
      const client = new GatewayClient(defaultConfig, {});
      connectAndAuth(client);

      mockOnMessage?.({
        data: JSON.stringify({
          jsonrpc: '2.0',
          id: 'req-2',
          method: 'invoke',
          params: {},
        }),
      });
      // Should send error response
      const lastSent = mockSend.mock.calls[mockSend.mock.calls.length - 1]?.[0];
      expect(lastSent).toBeDefined();
    });

    it('handles request with pending error response', () => {
      const client = new GatewayClient(defaultConfig);
      connectAndAuth(client);

      const promise = client.request('test.method', {});
      const sentMsg = JSON.parse(mockSend.mock.calls[mockSend.mock.calls.length - 1][0]);

      // Send error response
      mockOnMessage?.({
        data: JSON.stringify({
          jsonrpc: '2.0',
          id: sentMsg.id,
          error: { code: -1, message: 'Bad' },
        }),
      });

      return expect(promise).rejects.toThrow('Bad');
    });

    it('calls onMessage handler', () => {
      const handlers = { onMessage: jest.fn() };
      const client = new GatewayClient(defaultConfig, handlers);
      connectAndAuth(client);

      mockOnMessage?.({ data: JSON.stringify({ jsonrpc: '2.0', method: 'notification' }) });
      expect(handlers.onMessage).toHaveBeenCalled();
    });
  });

  describe('handleClose', () => {
    it('triggers reconnect on unexpected close', () => {
      const client = new GatewayClient({ ...defaultConfig, reconnect: true });
      client.connect();
      mockOnOpen?.();

      mockOnClose?.({ code: 1006, reason: 'abnormal' });
      // Should attempt reconnect
      expect(client.getState()).toBe('reconnecting');
      jest.advanceTimersByTime(5000);
    });

    it('goes to disconnected when reconnect is false', () => {
      const client = new GatewayClient({ ...defaultConfig, reconnect: false });
      client.connect();
      mockOnOpen?.();

      mockOnClose?.({ code: 1000, reason: 'normal' });
      expect(client.getState()).toBe('disconnected');
    });

    it('stays disconnected after intentional disconnect', () => {
      const client = new GatewayClient({ ...defaultConfig, reconnect: true });
      client.connect();
      mockOnOpen?.();
      client.disconnect(); // sets destroyed = true

      mockOnClose?.({ code: 1000, reason: 'disconnect' });
      expect(client.getState()).toBe('disconnected');
    });
  });

  describe('handleError', () => {
    it('calls error handler', () => {
      const handlers = { onError: jest.fn() };
      const client = new GatewayClient(defaultConfig, handlers);
      client.connect();

      mockOnError?.({ message: 'connection failed' });
      expect(handlers.onError).toHaveBeenCalled();
    });

    it('stays in reconnecting state on error during reconnect', () => {
      const handlers = { onError: jest.fn() };
      const client = new GatewayClient({ ...defaultConfig, reconnect: true }, handlers);
      client.connect();
      mockOnOpen?.();

      // Close with reconnect
      mockOnClose?.({ code: 1006, reason: 'abnormal' });
      expect(client.getState()).toBe('reconnecting');

      // Error during reconnect should not change state to error
      mockOnError?.({ message: 'reconnect error' });
      expect(client.getState()).toBe('reconnecting');
    });
  });

  describe('Singleton management', () => {
    it('createGatewayClient creates singleton', () => {
      const client = createGatewayClient(defaultConfig);
      expect(client).toBeInstanceOf(GatewayClient);
    });

    it('getGatewayClient returns the singleton', () => {
      createGatewayClient(defaultConfig);
      const client = getGatewayClient();
      expect(client).toBeInstanceOf(GatewayClient);
    });

    it('getGatewayClient returns null before creation', () => {
      expect(getGatewayClient()).toBeNull();
    });

    it('disconnectGateway clears singleton', () => {
      createGatewayClient(defaultConfig);
      disconnectGateway();
      expect(getGatewayClient()).toBeNull();
    });

    it('createGatewayClient disconnects previous instance', () => {
      const first = createGatewayClient(defaultConfig);
      const second = createGatewayClient(defaultConfig);
      expect(second).toBeInstanceOf(GatewayClient);
      expect(second).not.toBe(first);
    });
  });

  describe('handleClose — pending request rejection (Phase 26)', () => {
    function connectAndAuth(client: GatewayClient) {
      client.connect();
      mockOnOpen?.();
      const authReq = JSON.parse(mockSend.mock.calls[0][0]);
      mockOnMessage?.({
        data: JSON.stringify({ jsonrpc: '2.0', id: authReq.id, result: { authenticated: true } }),
      });
    }

    it('rejects pending requests on unexpected close (reconnecting)', async () => {
      const client = new GatewayClient({ ...defaultConfig, reconnect: true });
      connectAndAuth(client);

      const promise = client.request('test.method', {});

      // Close unexpectedly — should reject pending request
      mockOnClose?.({ code: 1006, reason: 'abnormal' });

      await expect(promise).rejects.toThrow();
    });

    it('rejects pending requests on normal close (disconnected)', async () => {
      const client = new GatewayClient({ ...defaultConfig, reconnect: false });
      connectAndAuth(client);

      const promise = client.request('test.method', {});

      mockOnClose?.({ code: 1000, reason: 'normal' });

      await expect(promise).rejects.toThrow();
    });

    it('rejects pending requests on disconnect (destroyed)', async () => {
      const client = new GatewayClient(defaultConfig);
      connectAndAuth(client);

      const promise = client.request('test.method', {}, 30000);

      client.disconnect(); // destroyed

      mockOnClose?.({ code: 1000, reason: 'disconnect' });

      await expect(promise).rejects.toThrow();
    });
  });
});
