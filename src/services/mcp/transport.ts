// ---------------------------------------------------------------------------
// Kavi — MCP Transport Layer
// ---------------------------------------------------------------------------
// Supports SSE and Streamable HTTP transports for MCP protocol

import { fetch as expoFetch } from 'expo/fetch';

import { APP_DISPLAY_NAME, APP_VERSION } from '../../constants/appMetadata';
import { unrefTimerIfSupported } from '../../utils/timers';
import {
  createMcpHttpError,
  formatTransportError,
  hasConfiguredMcpAuth,
  McpTransportError,
  shouldFallbackToLegacySse,
} from './transportErrors';
import {
  parseSseStreamPayload,
  readSseJsonRpcResponse,
  type McpStreamMessage,
} from './transportFraming';
import { connectMcpSseTransport } from './transportSseConnection';

export { McpTransportError } from './transportErrors';
export { isSseTransportAvailable } from './transportSseConnection';

export type TransportType = 'sse' | 'streamable-http';
export type TransportPreference = 'auto' | TransportType;

export interface McpTransportConfig {
  url: string;
  headers?: Record<string, string>;
  authHeadersProvider?: () => Promise<Record<string, string>>;
  timeout?: number;
  transportPreference?: TransportPreference;
  sseUrl?: string;
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

const DEFAULT_MCP_PROTOCOL_VERSION = '2025-03-26';

type MessageHandler = (msg: JsonRpcResponse | JsonRpcNotification) => void;
type ErrorHandler = (error: Error) => void;
type CloseHandler = () => void;

export class McpTransport {
  private config: McpTransportConfig;
  private transportType: TransportType = 'streamable-http';
  private messageEndpoint: string | null = null;
  private eventSource: EventSource | null = null;
  private connected = false;
  private reconnectEnabled = true;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private maxReconnectDelay = 30000;
  private sessionId: string | null = null;
  private protocolVersion: string | null = null;
  private initializeResponse: JsonRpcResponse | null = null;
  private streamController: AbortController | null = null;
  private standaloneStreamStarted = false;

  private onMessage: MessageHandler | null = null;
  private onError: ErrorHandler | null = null;
  private onClose: CloseHandler | null = null;

  constructor(config: McpTransportConfig) {
    this.config = config;
  }

  setHandlers(handlers: {
    onMessage: MessageHandler;
    onError: ErrorHandler;
    onClose: CloseHandler;
  }): void {
    this.onMessage = handlers.onMessage;
    this.onError = handlers.onError;
    this.onClose = handlers.onClose;
  }

  async connect(): Promise<void> {
    this.reconnectEnabled = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const preference = this.config.transportPreference ?? 'auto';

    if (preference === 'sse') {
      await this.connectSse();
      this.transportType = 'sse';
      this.connected = true;
      this.reconnectAttempt = 0;
      return;
    }

    if (preference === 'streamable-http') {
      await this.connectStreamableHttp();
      this.transportType = 'streamable-http';
      this.connected = true;
      this.reconnectAttempt = 0;
      return;
    }

    // Try streamable HTTP first, fallback to legacy SSE only for transport-shape failures.
    let streamableHttpError: unknown;

    try {
      await this.connectStreamableHttp();
      this.transportType = 'streamable-http';
      this.connected = true;
      this.reconnectAttempt = 0;
      return;
    } catch (err) {
      streamableHttpError = err;
      if (!shouldFallbackToLegacySse(err)) {
        throw err;
      }
    }

    try {
      await this.connectSse();
      this.transportType = 'sse';
      this.connected = true;
      this.reconnectAttempt = 0;
    } catch (err) {
      throw new Error(
        `Failed to connect via both streamable HTTP and SSE: HTTP=${formatTransportError(streamableHttpError)}; SSE=${formatTransportError(err)}`,
      );
    }
  }

  private async connectStreamableHttp(): Promise<void> {
    const url = this.config.url.replace(/\/$/, '');
    const timeoutRequest = this.createTimeoutRequest(this.config.timeout ?? 10000);
    const headers = await this.resolveHeaders('application/json, text/event-stream', true);
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 0,
        method: 'initialize',
        params: {
          protocolVersion: DEFAULT_MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: APP_DISPLAY_NAME, version: APP_VERSION },
        },
      }),
      signal: timeoutRequest.signal,
    }).finally(() => {
      timeoutRequest.cleanup();
    });

    if (!response.ok) {
      throw await this.createHttpError('MCP initialize failed', response);
    }

    this.captureSessionId(response);
    this.messageEndpoint = url;

    const contentType = response.headers.get('content-type') ?? '';
    this.initializeResponse = contentType.includes('text/event-stream')
      ? await readSseJsonRpcResponse(response)
      : ((await response.json()) as JsonRpcResponse);

    this.captureProtocolVersion(this.initializeResponse);
  }

  private async connectSse(): Promise<void> {
    const connection = await connectMcpSseTransport({
      config: this.config,
      onMessage: this.onMessage,
      onDisconnect: () => this.handleDisconnect(),
    });
    this.eventSource = connection.eventSource;
    this.messageEndpoint = connection.messageEndpoint;
  }

  async send(
    request: JsonRpcRequest,
    timeout = this.config.timeout ?? 30000,
  ): Promise<JsonRpcResponse> {
    if (!this.messageEndpoint) {
      throw new Error('Transport not connected');
    }

    const timeoutRequest = this.createTimeoutRequest(timeout);
    const headers = await this.resolveHeaders('application/json, text/event-stream', true);
    const response = await fetch(this.messageEndpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
      signal: timeoutRequest.signal,
    }).finally(() => {
      timeoutRequest.cleanup();
    });

    this.captureSessionId(response);

    if (!response.ok) {
      throw await this.createHttpError('MCP request failed', response);
    }

    if (request.id == null && request.method === 'notifications/initialized') {
      this.startStandaloneStreamIfSupported();
    }

    if (request.id == null) {
      return { jsonrpc: '2.0' };
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('text/event-stream')) {
      // Handle SSE response for streamable HTTP
      const parsed = await readSseJsonRpcResponse(response);
      this.captureProtocolVersion(parsed);
      return parsed;
    }

    const parsed = (await response.json()) as JsonRpcResponse;
    this.captureProtocolVersion(parsed);
    return parsed;
  }

  private handleDisconnect(): void {
    this.connected = false;
    this.clearLiveConnections();

    if (!this.reconnectEnabled) {
      return;
    }

    this.onClose?.();

    // Exponential backoff reconnection
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempt), this.maxReconnectDelay);
    this.reconnectAttempt++;

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
      } catch {
        this.onError?.(new Error('Reconnection failed'));
        this.handleDisconnect();
      }
    }, delay);
    unrefTimerIfSupported(this.reconnectTimer);
  }

  isConnected(): boolean {
    return this.connected;
  }

  getTransportType(): TransportType {
    return this.transportType;
  }

  consumeInitializeResponse(): JsonRpcResponse | null {
    const response = this.initializeResponse;
    this.initializeResponse = null;
    return response;
  }

  disconnect(): void {
    this.reconnectEnabled = false;
    this.connected = false;
    this.clearLiveConnections();
    this.messageEndpoint = null;
    this.reconnectAttempt = 0;
    this.sessionId = null;
    this.protocolVersion = null;
    this.initializeResponse = null;
  }

  private clearLiveConnections(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.streamController) {
      this.streamController.abort();
      this.streamController = null;
    }

    this.standaloneStreamStarted = false;

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  private buildHeaders(accept: string, includeJsonContentType = false): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: accept,
      ...this.config.headers,
    };

    if (includeJsonContentType) {
      headers['Content-Type'] = 'application/json';
    }

    if (this.sessionId) {
      headers['Mcp-Session-Id'] = this.sessionId;
    }

    if (this.protocolVersion) {
      headers['MCP-Protocol-Version'] = this.protocolVersion;
    }

    return headers;
  }

  private async resolveHeaders(
    accept: string,
    includeJsonContentType = false,
  ): Promise<Record<string, string>> {
    const headers = this.buildHeaders(accept, includeJsonContentType);

    if (!this.config.authHeadersProvider) {
      return headers;
    }

    const dynamicHeaders = await this.config.authHeadersProvider().catch(() => ({}));
    return {
      ...headers,
      ...dynamicHeaders,
    };
  }

  private captureSessionId(response: Response): void {
    const sessionId =
      response.headers.get('mcp-session-id') || response.headers.get('Mcp-Session-Id');
    if (sessionId) {
      this.sessionId = sessionId;
    }
  }

  private captureProtocolVersion(message: JsonRpcResponse | null): void {
    const protocolVersion = (message?.result as { protocolVersion?: unknown } | undefined)
      ?.protocolVersion;
    if (typeof protocolVersion === 'string' && protocolVersion) {
      this.protocolVersion = protocolVersion;
      return;
    }

    if (!this.protocolVersion) {
      this.protocolVersion = DEFAULT_MCP_PROTOCOL_VERSION;
    }
  }

  private async createHttpError(prefix: string, response: Response): Promise<McpTransportError> {
    return createMcpHttpError(prefix, response, {
      hasConfiguredAuth: hasConfiguredMcpAuth(this.config.headers),
    });
  }

  private startStandaloneStreamIfSupported(): void {
    if (
      this.transportType !== 'streamable-http' ||
      !this.sessionId ||
      !this.messageEndpoint ||
      this.standaloneStreamStarted
    ) {
      return;
    }

    this.standaloneStreamStarted = true;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    this.streamController = controller;

    void this.openStandaloneStream(controller);
  }

  private async openStandaloneStream(controller: AbortController | null): Promise<void> {
    const endpoint = this.messageEndpoint;
    if (!endpoint) {
      this.standaloneStreamStarted = false;
      return;
    }

    const headers = await this.resolveHeaders('text/event-stream');

    expoFetch(endpoint, {
      method: 'GET',
      headers,
      signal: controller?.signal,
    })
      .then(async (response) => {
        this.captureSessionId(response);

        if (!response.ok) {
          if (response.status === 404 || response.status === 405) {
            return;
          }
          throw await this.createHttpError('Failed to open MCP event stream', response);
        }

        if (!response.body) {
          return;
        }

        await this.consumeStandaloneEventStream(response.body);
      })
      .catch((error) => {
        if (controller?.signal.aborted) {
          return;
        }
        this.onError?.(error instanceof Error ? error : new Error(String(error)));
      })
      .finally(() => {
        if (this.streamController === controller) {
          this.streamController = null;
        }
        this.standaloneStreamStarted = false;
      });
  }

  private async consumeStandaloneEventStream(stream: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        while (true) {
          const boundary = buffer.indexOf('\n\n');
          if (boundary < 0) {
            break;
          }

          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          this.handleStandaloneEventBlock(block);
        }
      }

      const remainder = buffer.trim();
      if (remainder) {
        this.handleStandaloneEventBlock(remainder);
      }
    } finally {
      reader.releaseLock();
    }
  }

  private handleStandaloneEventBlock(block: string): void {
    try {
      const payload = parseSseStreamPayload(block);
      if (!payload.parsed) {
        return;
      }
      const message = payload.value as McpStreamMessage;
      this.onMessage?.(message);
    } catch {
      // Ignore malformed standalone stream messages.
    }
  }

  private createTimeoutRequest(timeoutMs: number): {
    signal?: AbortSignal;
    cleanup: () => void;
  } {
    if (typeof AbortController !== 'function') {
      return { cleanup: () => {} };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new Error(`Request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    unrefTimerIfSupported(timer);

    return {
      signal: controller.signal,
      cleanup: () => clearTimeout(timer),
    };
  }
}
