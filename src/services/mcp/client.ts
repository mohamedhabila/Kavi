// ---------------------------------------------------------------------------
// Kavi — MCP Client (JSON-RPC 2.0)
// ---------------------------------------------------------------------------

import { APP_DISPLAY_NAME, APP_VERSION } from '../../constants/appMetadata';
import { McpTransport, JsonRpcRequest, TransportPreference } from './transport';

export interface McpServerCapabilities {
  tools?: { listChanged?: boolean };
  resources?: { subscribe?: boolean; listChanged?: boolean };
  prompts?: { listChanged?: boolean };
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface McpResourceInfo {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpPromptInfo {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}

export interface McpToolCallResult {
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    mimeType?: string;
    resource?: { uri: string; text?: string; blob?: string; mimeType?: string };
  }>;
  isError?: boolean;
}

export interface McpClientConfig {
  url: string;
  token?: string;
  headers?: Record<string, string>;
  authHeadersProvider?: () => Promise<Record<string, string>>;
  name?: string;
  transportPreference?: TransportPreference;
  sseUrl?: string;
  timeout?: number;
}

export class McpClient {
  private transport: McpTransport;
  private nextId = 1;
  private serverCapabilities: McpServerCapabilities | null = null;
  private onToolsChanged: (() => void) | null = null;

  constructor(config: McpClientConfig) {
    const headers: Record<string, string> = { ...config.headers };
    if (config.token) {
      headers['Authorization'] = `Bearer ${config.token}`;
    }
    this.transport = new McpTransport({
      url: config.url,
      headers,
      authHeadersProvider: config.authHeadersProvider,
      timeout: config.timeout,
      transportPreference: config.transportPreference,
      sseUrl: config.sseUrl,
    });
    this.transport.setHandlers({
      onMessage: (msg) => this.handleNotification(msg as any),
      onError: (err) => console.warn(`[MCP ${config.name}] Transport error:`, err.message),
      onClose: () => console.warn(`[MCP ${config.name}] Transport closed`),
    });
  }

  async connect(): Promise<McpServerCapabilities> {
    await this.transport.connect();

    const initialResponse = this.transport.consumeInitializeResponse();
    if (initialResponse?.error) {
      throw new Error(`MCP error ${initialResponse.error.code}: ${initialResponse.error.message}`);
    }
    const initResult =
      initialResponse?.result ??
      (await this.request(
        'initialize',
        {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: APP_DISPLAY_NAME, version: APP_VERSION },
        },
        10000,
      ));

    this.serverCapabilities = (initResult as any)?.capabilities ?? {};

    // Send initialized notification
    await this.notify('notifications/initialized', {});

    return this.serverCapabilities!;
  }

  async listTools(): Promise<McpToolInfo[]> {
    const allTools: McpToolInfo[] = [];
    let cursor: string | undefined;

    do {
      const params: Record<string, unknown> = {};
      if (cursor) params.cursor = cursor;

      const result = (await this.request('tools/list', params, 10000)) as {
        tools: McpToolInfo[];
        nextCursor?: string;
      };

      allTools.push(...(result.tools ?? []));
      cursor = result.nextCursor;
    } while (cursor);

    return allTools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
    const result = await this.request('tools/call', { name, arguments: args }, 30000);
    return result as McpToolCallResult;
  }

  async listResources(): Promise<McpResourceInfo[]> {
    const allResources: McpResourceInfo[] = [];
    let cursor: string | undefined;

    do {
      const params: Record<string, unknown> = {};
      if (cursor) params.cursor = cursor;

      const result = (await this.request('resources/list', params, 10000)) as {
        resources: McpResourceInfo[];
        nextCursor?: string;
      };

      allResources.push(...(result.resources ?? []));
      cursor = result.nextCursor;
    } while (cursor);

    return allResources;
  }

  async readResource(uri: string): Promise<{
    contents: Array<{ uri: string; text?: string; blob?: string; mimeType?: string }>;
  }> {
    return this.request('resources/read', { uri }, 10000) as any;
  }

  async listPrompts(): Promise<McpPromptInfo[]> {
    const result = (await this.request('prompts/list', {}, 10000)) as {
      prompts: McpPromptInfo[];
    };
    return result.prompts ?? [];
  }

  async getPrompt(
    name: string,
    args?: Record<string, string>,
  ): Promise<{ messages: Array<{ role: string; content: { type: string; text: string } }> }> {
    return this.request('prompts/get', { name, arguments: args }, 10000) as any;
  }

  setOnToolsChanged(handler: () => void): void {
    this.onToolsChanged = handler;
  }

  getCapabilities(): McpServerCapabilities | null {
    return this.serverCapabilities;
  }

  isConnected(): boolean {
    return this.transport.isConnected();
  }

  disconnect(): void {
    this.transport.disconnect();
    this.serverCapabilities = null;
  }

  private async request(
    method: string,
    params: Record<string, unknown>,
    timeout: number,
  ): Promise<unknown> {
    const id = this.nextId++;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    const response = await this.transport.send(request, timeout);
    if (response.error) {
      throw new Error(`MCP error ${response.error.code}: ${response.error.message}`);
    }
    return response.result;
  }

  private async notify(method: string, params: Record<string, unknown>): Promise<void> {
    try {
      await this.transport.send({
        jsonrpc: '2.0',
        method,
        params,
      });
    } catch {
      // Notifications don't require a response
    }
  }

  private handleNotification(msg: { method?: string; params?: unknown }): void {
    if (msg.method === 'notifications/tools/list_changed') {
      this.onToolsChanged?.();
    }
  }
}
