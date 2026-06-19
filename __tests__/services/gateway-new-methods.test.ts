// ---------------------------------------------------------------------------
// Tests — Gateway Client — New Control-Plane Methods
// ---------------------------------------------------------------------------

jest.mock('../../src/utils/id', () => ({
  generateId: jest.fn().mockReturnValue('mock-gw-id'),
}));

jest.mock('../../src/services/gateway/protocol', () => ({
  createRequest: jest.fn().mockImplementation((method: string, params?: any) => ({
    jsonrpc: '2.0',
    id: `req-${Date.now()}`,
    method,
    params: params ?? {},
  })),
  createResponse: jest.fn(),
  createErrorResponse: jest.fn(),
  createNotification: jest.fn(),
  parseMessage: jest.fn((data: string) => JSON.parse(data)),
  isRequest: jest.fn((msg: any) => !!msg.method && msg.id != null),
  isResponse: jest.fn((msg: any) => msg.result !== undefined || msg.error !== undefined),
  GATEWAY_METHODS: {
    AUTH: 'auth',
    PING: 'ping',
    NODE_REGISTER: 'node.register',
    NODE_LIST: 'node.list',
    NODE_INVOKE: 'node.invoke',
    PAIRING_REQUEST: 'pairing.request',
    CHANNELS_STATUS: 'channels.status',
    SESSIONS_LIST: 'sessions.list',
    AGENTS_LIST: 'agents.list',
    EXEC_APPROVAL_LIST: 'exec.approval.list',
    EXEC_APPROVAL_RESOLVE: 'exec.approval.resolve',
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
    void fn;
  }
  set onclose(fn: any) {}
  set onerror(fn: any) {}
}

(global as any).WebSocket = MockWebSocket;

import { GatewayClient, disconnectGateway } from '../../src/services/gateway/client';
import { GATEWAY_METHODS } from '../../src/services/gateway/protocol';

const defaultConfig = { url: 'ws://test', token: 'test-token' };

describe('Gateway Client — new control-plane methods', () => {
  let client: GatewayClient;

  beforeEach(() => {
    jest.clearAllMocks();
    disconnectGateway();
    mockOnOpen = null;
    client = new GatewayClient(defaultConfig);
  });

  describe('getChannelsStatus', () => {
    it('exists as a method', () => {
      expect(typeof client.getChannelsStatus).toBe('function');
    });

    it('rejects when not connected', async () => {
      await expect(client.getChannelsStatus()).rejects.toThrow('Not connected');
    });
  });

  describe('listSessions', () => {
    it('exists as a method', () => {
      expect(typeof client.listSessions).toBe('function');
    });

    it('rejects when not connected', async () => {
      await expect(client.listSessions()).rejects.toThrow('Not connected');
    });
  });

  describe('listAgents', () => {
    it('exists as a method', () => {
      expect(typeof client.listAgents).toBe('function');
    });

    it('rejects when not connected', async () => {
      await expect(client.listAgents()).rejects.toThrow('Not connected');
    });
  });

  describe('listPendingApprovals', () => {
    it('exists as a method', () => {
      expect(typeof client.listPendingApprovals).toBe('function');
    });

    it('rejects when not connected', async () => {
      await expect(client.listPendingApprovals()).rejects.toThrow('Not connected');
    });
  });

  describe('resolveApproval', () => {
    it('exists as a method', () => {
      expect(typeof client.resolveApproval).toBe('function');
    });

    it('accepts approvalId, nodeId, and action', async () => {
      await expect(client.resolveApproval('approval-1', 'node-1', 'approve')).rejects.toThrow(
        'Not connected',
      );
    });
  });

  describe('GATEWAY_METHODS constants', () => {
    it('has CHANNELS_STATUS', () => {
      expect(GATEWAY_METHODS.CHANNELS_STATUS).toBe('channels.status');
    });

    it('has SESSIONS_LIST', () => {
      expect(GATEWAY_METHODS.SESSIONS_LIST).toBe('sessions.list');
    });

    it('has AGENTS_LIST', () => {
      expect(GATEWAY_METHODS.AGENTS_LIST).toBe('agents.list');
    });

    it('has EXEC_APPROVAL_LIST', () => {
      expect(GATEWAY_METHODS.EXEC_APPROVAL_LIST).toBe('exec.approval.list');
    });

    it('has EXEC_APPROVAL_RESOLVE', () => {
      expect(GATEWAY_METHODS.EXEC_APPROVAL_RESOLVE).toBe('exec.approval.resolve');
    });
  });
});
