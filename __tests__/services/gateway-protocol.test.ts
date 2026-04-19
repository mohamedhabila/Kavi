// ---------------------------------------------------------------------------
// Gateway Protocol — tests
// ---------------------------------------------------------------------------

import {
  createRequest,
  createResponse,
  createErrorResponse,
  createNotification,
  parseMessage,
  isRequest,
  isResponse,
  RPC_ERRORS,
  GATEWAY_METHODS,
} from '../../src/services/gateway/protocol';

describe('Gateway Protocol', () => {
  describe('createRequest', () => {
    it('creates a valid JSON-RPC 2.0 request', () => {
      const req = createRequest('test.method', { foo: 'bar' });
      expect(req.jsonrpc).toBe('2.0');
      expect(req.method).toBe('test.method');
      expect(req.params).toEqual({ foo: 'bar' });
      expect(typeof req.id).toBe('string');
    });

    it('generates unique IDs', () => {
      const r1 = createRequest('a');
      const r2 = createRequest('b');
      expect(r1.id).not.toBe(r2.id);
    });

    it('works without params', () => {
      const req = createRequest('ping');
      expect(req.method).toBe('ping');
      expect(req.params).toEqual({});
    });
  });

  describe('createResponse', () => {
    it('creates a success response', () => {
      const res = createResponse('req-1', { status: 'ok' });
      expect(res.jsonrpc).toBe('2.0');
      expect(res.id).toBe('req-1');
      expect(res.result).toEqual({ status: 'ok' });
    });
  });

  describe('createErrorResponse', () => {
    it('creates an error response with code + message', () => {
      const res = createErrorResponse('req-2', -32600, 'Invalid request');
      expect(res.jsonrpc).toBe('2.0');
      expect(res.id).toBe('req-2');
      expect(res.error.code).toBe(-32600);
      expect(res.error.message).toBe('Invalid request');
    });

    it('includes optional data', () => {
      const res = createErrorResponse('req-3', -32603, 'Internal', { detail: 'x' });
      expect(res.error.data).toEqual({ detail: 'x' });
    });
  });

  describe('createNotification', () => {
    it('creates a notification (no id)', () => {
      const n = createNotification('ping', { ts: 123 });
      expect(n.jsonrpc).toBe('2.0');
      expect(n.method).toBe('ping');
      expect(n.params).toEqual({ ts: 123 });
      expect(n).not.toHaveProperty('id');
    });
  });

  describe('parseMessage', () => {
    it('parses valid JSON', () => {
      const msg = parseMessage('{"jsonrpc":"2.0","method":"ping"}');
      expect(msg).toEqual({ jsonrpc: '2.0', method: 'ping' });
    });

    it('returns null for invalid JSON', () => {
      expect(parseMessage('not json')).toBeNull();
    });

    it('returns null for null input', () => {
      expect(parseMessage(null as any)).toBeNull();
    });
  });

  describe('type guards', () => {
    it('isRequest returns true for requests', () => {
      const req = createRequest('test');
      expect(isRequest(req)).toBe(true);
    });

    it('isRequest returns false for responses', () => {
      const res = createResponse('1', {});
      expect(isRequest(res)).toBe(false);
    });

    it('isResponse returns true for success responses', () => {
      const res = createResponse('1', { ok: true });
      expect(isResponse(res)).toBe(true);
    });

    it('isResponse returns true for error responses', () => {
      const res = createErrorResponse('1', -32600, 'bad');
      expect(isResponse(res)).toBe(true);
    });

    it('isResponse returns false for requests', () => {
      const req = createRequest('test');
      expect(isResponse(req)).toBe(false);
    });
  });

  describe('constants', () => {
    it('RPC_ERRORS has standard codes', () => {
      expect(RPC_ERRORS.PARSE_ERROR).toBe(-32700);
      expect(RPC_ERRORS.INVALID_REQUEST).toBe(-32600);
      expect(RPC_ERRORS.METHOD_NOT_FOUND).toBe(-32601);
      expect(RPC_ERRORS.INTERNAL_ERROR).toBe(-32603);
    });

    it('GATEWAY_METHODS has expected methods', () => {
      expect(GATEWAY_METHODS).toHaveProperty('NODE_LIST');
      expect(GATEWAY_METHODS).toHaveProperty('AUTH_PAIR');
      expect(GATEWAY_METHODS).toHaveProperty('PING');
    });
  });
});
