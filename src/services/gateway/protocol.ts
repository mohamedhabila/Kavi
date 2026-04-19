// ---------------------------------------------------------------------------
// Kavi — Gateway Protocol
// ---------------------------------------------------------------------------
// JSON-RPC 2.0 message framing for gateway communication.

import type { GatewayMessage } from '../../types';
import { generateId } from '../../utils/id';

/**
 * Create a JSON-RPC 2.0 request message
 */
export function createRequest(method: string, params?: any): GatewayMessage {
  return {
    jsonrpc: '2.0',
    id: generateId(),
    method,
    params: params ?? {},
  };
}

/**
 * Create a JSON-RPC 2.0 response message
 */
export function createResponse(id: string | number, result: any): GatewayMessage {
  return {
    jsonrpc: '2.0',
    id,
    result,
  };
}

/**
 * Create a JSON-RPC 2.0 error response
 */
export function createErrorResponse(
  id: string | number,
  code: number,
  message: string,
  data?: any,
): GatewayMessage {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message, data },
  };
}

/**
 * Create a JSON-RPC 2.0 notification (no id = no response expected)
 */
export function createNotification(method: string, params?: any): GatewayMessage {
  return {
    jsonrpc: '2.0',
    method,
    params: params ?? {},
  };
}

/**
 * Parse a raw message string into a GatewayMessage
 */
export function parseMessage(raw: string): GatewayMessage | null {
  try {
    const msg = JSON.parse(raw);
    if (msg.jsonrpc !== '2.0') return null;
    return msg as GatewayMessage;
  } catch {
    return null;
  }
}

/**
 * Determine if a message is a request (has method + id)
 */
export function isRequest(msg: GatewayMessage): boolean {
  return msg.method !== undefined && msg.id !== undefined;
}

/**
 * Determine if a message is a response (has result or error)
 */
export function isResponse(msg: GatewayMessage): boolean {
  return msg.result !== undefined || msg.error !== undefined;
}

// Standard JSON-RPC error codes
export const RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

// Kavi-specific method names
export const GATEWAY_METHODS = {
  // Node management
  NODE_LIST: 'node.list',
  NODE_DESCRIBE: 'node.describe',
  NODE_INVOKE: 'node.invoke',
  NODE_REGISTER: 'node.register',

  // Authentication
  AUTH_PAIR: 'auth.pair',
  AUTH_VERIFY: 'auth.verify',
  AUTH_REFRESH: 'auth.refresh',

  // Heartbeat
  PING: 'ping',
  PONG: 'pong',

  // Canvas
  CANVAS_CREATE: 'canvas.create',
  CANVAS_UPDATE: 'canvas.update',
  CANVAS_DELETE: 'canvas.delete',
  CANVAS_ACTION: 'canvas.action',

  // Voice
  VOICE_START: 'voice.start',
  VOICE_STOP: 'voice.stop',
  VOICE_DATA: 'voice.data',

  // Control-plane
  CHANNELS_STATUS: 'channels.status',
  SESSIONS_LIST: 'sessions.list',
  AGENTS_LIST: 'agents.list',
  EXEC_APPROVAL_LIST: 'exec.approval.list',
  EXEC_APPROVAL_RESOLVE: 'exec.approval.resolve',
} as const;
