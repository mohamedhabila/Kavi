// ---------------------------------------------------------------------------
// Kavi — MCP Transport Layer
// ---------------------------------------------------------------------------
// Supports SSE and Streamable HTTP transports for MCP protocol

import { fetch as expoFetch } from 'expo/fetch';

import { unrefTimerIfSupported } from '../../utils/timers';

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

export function isSseTransportAvailable(): boolean {
  return typeof EventSource === 'function';
}

export class McpTransportError extends Error {
  statusCode?: number;
  shouldFallbackToSse: boolean;
  requiresAuthentication: boolean;

  constructor(
    message: string,
    options: {
      statusCode?: number;
      shouldFallbackToSse?: boolean;
      requiresAuthentication?: boolean;
    } = {},
  ) {
    super(message);
    this.name = 'McpTransportError';
    this.statusCode = options.statusCode;
    this.shouldFallbackToSse = options.shouldFallbackToSse ?? false;
    this.requiresAuthentication = options.requiresAuthentication ?? false;
  }
}

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
      if (!this.shouldFallbackToLegacySse(err)) {
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
        `Failed to connect via both streamable HTTP and SSE: HTTP=${this.formatError(streamableHttpError)}; SSE=${this.formatError(err)}`,
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
          clientInfo: { name: 'Kavi', version: '0.1.0' },
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
      ? await this.readSseResponse(response)
      : ((await response.json()) as JsonRpcResponse);

    this.captureProtocolVersion(this.initializeResponse);
  }

  private connectSse(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!isSseTransportAvailable()) {
        reject(new Error('SSE transport is not available in this runtime'));
        return;
      }

      const baseUrl = this.config.url.replace(/\/$/, '');
      const candidates = Array.from(
        new Set(
          [this.config.sseUrl?.trim(), baseUrl, `${baseUrl}/sse`].filter((value): value is string =>
            Boolean(value),
          ),
        ),
      );

      let index = 0;

      const tryNext = () => {
        const sseUrl = candidates[index++];
        if (!sseUrl) {
          reject(new Error('SSE connection failed'));
          return;
        }

        const es = new EventSource(sseUrl);
        let resolved = false;
        const connectTimeout = setTimeout(() => {
          if (!resolved) {
            es.close();
            tryNext();
          }
        }, this.config.timeout ?? 10000);
        unrefTimerIfSupported(connectTimeout);

        const clearConnectTimeout = () => {
          clearTimeout(connectTimeout);
        };

        es.addEventListener('endpoint', ((event: MessageEvent) => {
          const endpointPath = event.data;
          if (endpointPath.startsWith('http')) {
            this.messageEndpoint = endpointPath;
          } else {
            const url = new URL(baseUrl);
            this.messageEndpoint = `${url.origin}${endpointPath}`;
          }
          if (!resolved) {
            resolved = true;
            clearConnectTimeout();
            this.eventSource = es;
            resolve();
          }
        }) as EventListener);

        es.addEventListener('message', ((event: MessageEvent) => {
          try {
            const data = JSON.parse(event.data);
            this.onMessage?.(data);
          } catch {
            // skip malformed messages
          }
        }) as EventListener);

        es.onerror = () => {
          if (!resolved) {
            clearConnectTimeout();
            es.close();
            tryNext();
            return;
          }
          this.handleDisconnect();
        };
      };

      tryNext();
    });
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
      const parsed = await this.readSseResponse(response);
      this.captureProtocolVersion(parsed);
      return parsed;
    }

    const parsed = (await response.json()) as JsonRpcResponse;
    this.captureProtocolVersion(parsed);
    return parsed;
  }

  private async readSseResponse(response: Response): Promise<JsonRpcResponse> {
    const text = await response.text();
    const blocks = text.split(/\n\n+/);

    for (const block of blocks) {
      const dataLines = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .filter(Boolean);

      if (dataLines.length > 0) {
        try {
          return JSON.parse(dataLines.join('\n'));
        } catch {
          continue;
        }
      }
    }
    throw new Error('No valid JSON-RPC response in SSE stream');
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

  private shouldFallbackToLegacySse(error: unknown): boolean {
    if (error instanceof McpTransportError) {
      return error.shouldFallbackToSse;
    }

    return true;
  }

  private async createHttpError(prefix: string, response: Response): Promise<McpTransportError> {
    const bodyText = await response.text().catch(() => response.statusText);
    const serverMessage = this.extractServerErrorMessage(bodyText);
    const hasConfiguredAuth = this.hasConfiguredAuth();

    if (response.status === 401) {
      return new McpTransportError(
        hasConfiguredAuth
          ? 'MCP authentication failed. Check the configured token or custom auth headers.'
          : 'MCP authentication required. Edit this server to add a token or custom auth headers.',
        { statusCode: 401, requiresAuthentication: true },
      );
    }

    if (response.status === 403) {
      return new McpTransportError(
        'MCP access forbidden. Check the configured scopes, token, or custom auth headers.',
        { statusCode: 403, requiresAuthentication: true },
      );
    }

    const suffix = serverMessage ? ` - ${serverMessage}` : '';
    return new McpTransportError(`${prefix}: HTTP ${response.status}${suffix}`, {
      statusCode: response.status,
      shouldFallbackToSse: response.status === 404 || response.status === 405,
    });
  }

  private extractServerErrorMessage(bodyText: string): string | null {
    const trimmed = bodyText.trim();
    if (!trimmed) {
      return null;
    }

    const parsed = this.parseJsonOrSse(trimmed);
    if (!parsed) {
      return trimmed;
    }

    if (typeof parsed === 'object' && parsed !== null) {
      const errorMessage = (parsed as { error?: { message?: unknown } }).error?.message;
      if (typeof errorMessage === 'string' && errorMessage.trim()) {
        return errorMessage.trim();
      }

      const message = (parsed as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim()) {
        return message.trim();
      }

      const error = (parsed as { error?: unknown }).error;
      if (typeof error === 'string' && error.trim()) {
        return error.trim();
      }
    }

    return trimmed;
  }

  private parseJsonOrSse(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      const blocks = text.split(/\n\n+/);
      for (const block of blocks) {
        const dataLines = block
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .filter(Boolean);

        if (dataLines.length === 0) {
          continue;
        }

        try {
          return JSON.parse(dataLines.join('\n'));
        } catch {
          // Try the next block.
        }
      }
    }

    return null;
  }

  private hasConfiguredAuth(): boolean {
    const headers = this.config.headers || {};
    return Object.keys(headers).some((key) => /authorization|api[-_]key|token|cookie/i.test(key));
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
    const dataLines = block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .filter(Boolean);

    if (dataLines.length === 0) {
      return;
    }

    try {
      const message = JSON.parse(dataLines.join('\n'));
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

  private formatError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }
}
