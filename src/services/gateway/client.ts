// ---------------------------------------------------------------------------
// Kavi — Gateway Client
// ---------------------------------------------------------------------------
// WebSocket client that connects to the Kavi Gateway as a mobile node.
// Handles: reconnection with exponential backoff, node registration,
// node.invoke routing, pairing codes, heartbeat.

import type {
  GatewayConfig,
  GatewayConnectionState,
  GatewayCapability,
  GatewayMessage,
} from '../../types';
import {
  createRequest,
  createResponse,
  createErrorResponse,
  createNotification,
  parseMessage,
  isRequest,
  isResponse,
  GATEWAY_METHODS,
  RPC_ERRORS,
} from './protocol';
import { generateId } from '../../utils/id';

// ── Types ────────────────────────────────────────────────────────────────

export type GatewayEventHandler = {
  onStateChange?: (state: GatewayConnectionState) => void;
  onMessage?: (msg: GatewayMessage) => void;
  onInvoke?: (method: string, params: any) => Promise<any>;
  onError?: (error: Error) => void;
  onPairingCode?: (code: string) => void;
};

interface PendingRequest {
  resolve: (result: any) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

// ── Client ───────────────────────────────────────────────────────────────

export class GatewayClient {
  private ws: WebSocket | null = null;
  private config: GatewayConfig;
  private handlers: GatewayEventHandler;
  private state: GatewayConnectionState = 'disconnected';
  private stateListeners: Array<(s: GatewayConnectionState) => void> = [];
  private pendingRequests = new Map<string | number, PendingRequest>();
  private capabilities: GatewayCapability[] = [];
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private nodeId: string;
  private destroyed = false;

  constructor(config: GatewayConfig, handlers: GatewayEventHandler = {}) {
    this.config = config;
    this.handlers = handlers;
    this.nodeId = `mobile-${generateId()}`;
  }

  // ── Connection lifecycle ─────────────────────────────────────────────

  connect(): void {
    if (this.destroyed) return;
    if (this.state === 'connected' || this.state === 'connecting') return;

    this.setState('connecting');

    try {
      this.ws = new WebSocket(this.config.url);
      this.ws.onopen = () => this.handleOpen();
      this.ws.onmessage = (event) => this.handleMessage(event);
      this.ws.onclose = (event) => this.handleClose(event);
      this.ws.onerror = () => this.handleError(new Error('WebSocket error'));
    } catch (err: unknown) {
      this.handleError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  disconnect(): void {
    this.destroyed = true;
    this.clearTimers();
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    this.rejectAllPending(new Error('Client disconnected'));
    this.setState('disconnected');
  }

  getState(): GatewayConnectionState {
    return this.state;
  }

  getNodeId(): string {
    return this.nodeId;
  }

  isConnected(): boolean {
    return this.state === 'connected';
  }

  onStateChange(cb: (state: GatewayConnectionState) => void): () => void {
    this.stateListeners.push(cb);
    return () => {
      this.stateListeners = this.stateListeners.filter((l) => l !== cb);
    };
  }

  setCapabilities(caps: GatewayCapability[]): void {
    this.capabilities = caps;
  }

  // ── Public API ───────────────────────────────────────────────────────

  /**
   * Send a request and wait for response
   */
  async request(method: string, params?: any, timeoutMs = 30000): Promise<any> {
    if (!this.ws || this.state !== 'connected') {
      throw new Error('Not connected to gateway');
    }

    const msg = createRequest(method, params);
    const id = msg.id!;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timed out: ${method}`));
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timeout });
      this.send(msg);
    });
  }

  /**
   * Send a notification (no response expected)
   */
  notify(method: string, params?: any): void {
    if (!this.ws || this.state !== 'connected') return;
    this.send(createNotification(method, params));
  }

  /**
   * Request a pairing code for connecting to the gateway
   */
  async requestPairingCode(): Promise<string> {
    const result = await this.request(GATEWAY_METHODS.AUTH_PAIR, {
      nodeId: this.nodeId,
      deviceName: this.config.deviceName || 'Kavi',
      capabilities: this.capabilities.map((c) => c.name),
    });
    const code = result?.code;
    if (code) {
      this.handlers.onPairingCode?.(String(code));
    }
    return String(code || '');
  }

  /**
   * List available nodes on the gateway
   */
  async listNodes(): Promise<any[]> {
    const result = await this.request(GATEWAY_METHODS.NODE_LIST);
    return result?.nodes ?? [];
  }

  /**
   * Invoke a method on a remote node
   */
  async invokeNode(nodeId: string, method: string, params?: any): Promise<any> {
    return this.request(GATEWAY_METHODS.NODE_INVOKE, {
      targetNode: nodeId,
      method,
      params,
    });
  }

  /**
   * Get the status of all channels (distribution endpoints)
   */
  async getChannelsStatus(): Promise<{
    channels: Array<{ name: string; status: string; lastActivity?: number }>;
  }> {
    return this.request(GATEWAY_METHODS.CHANNELS_STATUS);
  }

  /**
   * List active sessions across all nodes
   */
  async listSessions(): Promise<{
    sessions: Array<{
      id: string;
      nodeId: string;
      kind: string;
      status: string;
      startedAt: number;
    }>;
  }> {
    return this.request(GATEWAY_METHODS.SESSIONS_LIST);
  }

  /**
   * List active agents across all nodes
   */
  async listAgents(): Promise<{
    agents: Array<{ id: string; nodeId: string; status: string; depth: number; startedAt: number }>;
  }> {
    return this.request(GATEWAY_METHODS.AGENTS_LIST);
  }

  /**
   * List pending approval requests across all nodes
   */
  async listPendingApprovals(): Promise<{
    approvals: Array<{
      id: string;
      nodeId: string;
      toolName: string;
      title: string;
      riskLevel?: string;
      requestedAt: number;
    }>;
  }> {
    return this.request(GATEWAY_METHODS.EXEC_APPROVAL_LIST);
  }

  /**
   * Resolve (approve/reject) an approval request on a remote node
   */
  async resolveApproval(
    approvalId: string,
    nodeId: string,
    action: 'approve' | 'reject',
  ): Promise<{ ok: boolean }> {
    return this.request(GATEWAY_METHODS.EXEC_APPROVAL_RESOLVE, {
      approvalId,
      nodeId,
      action,
    });
  }

  // ── WebSocket handlers ───────────────────────────────────────────────

  private handleOpen(): void {
    this.reconnectAttempts = 0;
    this.setState('authenticating');

    // Authenticate with token
    this.send(
      createRequest(GATEWAY_METHODS.AUTH_VERIFY, {
        token: this.config.token,
        nodeId: this.nodeId,
        deviceName: this.config.deviceName || 'Kavi',
        capabilities: this.capabilities.map((c) => c.name),
        platform: 'mobile',
      }),
    );
  }

  private handleMessage(event: MessageEvent): void {
    const msg = parseMessage(typeof event.data === 'string' ? event.data : '');
    if (!msg) return;

    this.handlers.onMessage?.(msg);

    // Handle response to a pending request
    if (isResponse(msg) && msg.id !== undefined) {
      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        this.pendingRequests.delete(msg.id);
        clearTimeout(pending.timeout);
        if (msg.error) {
          pending.reject(new Error(msg.error.message));
        } else {
          pending.resolve(msg.result);
        }
      }

      // Auth verification response → mark connected
      if (this.state === 'authenticating' && !msg.error) {
        this.setState('connected');
        this.startHeartbeat();
        this.registerNode();
      } else if (this.state === 'authenticating' && msg.error) {
        this.handlers.onError?.(new Error(`Authentication failed: ${msg.error.message}`));
        this.setState('error');
      }
      return;
    }

    // Handle incoming request (gateway invoking us)
    if (isRequest(msg)) {
      this.handleIncomingRequest(msg);
    }
  }

  private async handleIncomingRequest(msg: GatewayMessage): Promise<void> {
    const { method, params, id } = msg;
    if (!method || id === undefined) return;

    try {
      if (this.handlers.onInvoke) {
        const result = await this.handlers.onInvoke(method, params);
        this.send(createResponse(id, result));
      } else {
        this.send(
          createErrorResponse(id, RPC_ERRORS.METHOD_NOT_FOUND, `Method not handled: ${method}`),
        );
      }
    } catch (err: unknown) {
      this.send(
        createErrorResponse(
          id,
          RPC_ERRORS.INTERNAL_ERROR,
          err instanceof Error ? err.message : String(err),
        ),
      );
    }
  }

  private handleClose(event: CloseEvent): void {
    this.clearTimers();
    this.ws = null;

    if (this.destroyed) {
      this.rejectAllPending(new Error('Connection closed'));
      this.setState('disconnected');
      return;
    }

    if (this.config.reconnect !== false) {
      // Reject pending requests — they will time out waiting for reconnect.
      // Callers should retry after observing the 'connected' state again.
      this.rejectAllPending(new Error('Connection lost, reconnecting'));
      this.setState('reconnecting');
      this.scheduleReconnect();
    } else {
      this.rejectAllPending(new Error('Connection closed'));
      this.setState('disconnected');
    }
  }

  private handleError(error: Error): void {
    this.handlers.onError?.(error);
    if (this.state !== 'reconnecting') {
      this.setState('error');
    }
  }

  // ── Reconnection with exponential backoff ────────────────────────────

  private scheduleReconnect(): void {
    if (this.destroyed) return;

    const maxDelay = this.config.maxReconnectDelay || 30000;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), maxDelay);
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  // ── Heartbeat ────────────────────────────────────────────────────────

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.state === 'connected') {
        this.notify(GATEWAY_METHODS.PING);
      }
    }, 30000);
  }

  // ── Node registration ────────────────────────────────────────────────

  private registerNode(): void {
    this.notify(GATEWAY_METHODS.NODE_REGISTER, {
      nodeId: this.nodeId,
      capabilities: this.capabilities.map((c) => ({
        name: c.name,
        description: c.description,
        version: c.version,
      })),
      platform: 'mobile',
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  private send(msg: GatewayMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private setState(state: GatewayConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    this.handlers.onStateChange?.(state);
    for (const cb of this.stateListeners) cb(state);
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }
}

// ── Singleton instance ─────────────────────────────────────────────────

let gatewayInstance: GatewayClient | null = null;

export function getGatewayClient(): GatewayClient | null {
  return gatewayInstance;
}

export function createGatewayClient(
  config: GatewayConfig,
  handlers: GatewayEventHandler = {},
): GatewayClient {
  if (gatewayInstance) {
    gatewayInstance.disconnect();
  }
  gatewayInstance = new GatewayClient(config, handlers);
  return gatewayInstance;
}

export function disconnectGateway(): void {
  if (gatewayInstance) {
    gatewayInstance.disconnect();
    gatewayInstance = null;
  }
}
