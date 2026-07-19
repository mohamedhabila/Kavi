// ---------------------------------------------------------------------------
// Kavi — MCP Connection Manager
// ---------------------------------------------------------------------------
// Manages lifecycle of all MCP server connections

import { McpClient, McpToolInfo } from './client';
import { McpToolEntry, mcpToolToDefinition } from './bridge';
import { emitMcpEvent } from '../events/bus';
import {
  authenticateMcpServer,
  clearMcpOAuth,
  getMcpOAuthHeaders,
  hasStoredMcpOAuth,
  McpOAuthError,
} from './oauth';
import type { McpServerConfig } from '../../types/remote';
import type { ToolDefinition } from '../../types/tool';
import { getRuntimeProcessEpoch } from '../runtimeProcessEpoch';

export type McpServerState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface McpServerStatus {
  id: string;
  name: string;
  state: McpServerState;
  tools: McpToolInfo[];
  error?: string;
  lastConnected?: number;
  authRequired?: boolean;
  authState?: 'authenticated' | 'unauthenticated' | 'pending';
}

export interface CapturedMcpRuntimeToolBinding {
  readonly client: McpClient;
  readonly declaration: ToolDefinition;
  readonly provenance: Readonly<{
    source: 'mcp';
    namespace: string;
    connectionGeneration: number;
    toolRegistryGeneration: number;
    runtimeProcessEpoch: string;
    targetIdentity: string;
    sseTargetIdentity?: string;
    transport: 'auto' | 'streamable-http' | 'sse';
    trustSource?: 'manual' | 'official-registry';
    registryName?: string;
    toolAnnotationsTrusted?: true;
  }>;
  isCurrent(): boolean;
}

function sanitizeEndpointIdentity(rawUrl: string): string | undefined {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.origin;
  } catch {
    return undefined;
  }
}

class McpConnectionManager {
  private clients = new Map<string, McpClient>();
  private statuses = new Map<string, McpServerStatus>();
  private serverConfigs = new Map<string, McpServerConfig>();
  private connectionGenerations = new Map<string, number>();
  private toolRegistryGenerations = new Map<string, number>();
  private nextConnectionGeneration = 1;
  private nextToolRegistryGeneration = 1;
  private listeners = new Set<() => void>();

  private cloneServerConfig(config: McpServerConfig): McpServerConfig {
    return {
      ...config,
      headers: config.headers ? { ...config.headers } : undefined,
      tools: Array.isArray(config.tools) ? [...config.tools] : [],
      allowedTools: Array.isArray(config.allowedTools) ? [...config.allowedTools] : [],
      autoApprovedTools: Array.isArray(config.autoApprovedTools)
        ? [...config.autoApprovedTools]
        : undefined,
    };
  }

  private getAllowedToolSet(serverId: string): Set<string> | null {
    const names = (this.serverConfigs.get(serverId)?.allowedTools || [])
      .map((name) => name.trim())
      .filter(Boolean);
    return names.length > 0 ? new Set(names) : null;
  }

  private filterAllowedTools(serverId: string, tools: McpToolInfo[]): McpToolInfo[] {
    const allowed = this.getAllowedToolSet(serverId);
    if (!allowed) {
      return tools;
    }

    return tools.filter((tool) => allowed.has(tool.name));
  }

  private advanceToolRegistryGeneration(serverId: string): number {
    const generation = this.nextToolRegistryGeneration++;
    this.toolRegistryGenerations.set(serverId, generation);
    return generation;
  }

  /**
   * Connect to all enabled MCP servers
   */
  async connectAll(servers: McpServerConfig[]): Promise<void> {
    const enabled = servers.filter((s) => s.enabled);
    await Promise.allSettled(enabled.map((s) => this.connectServer(s)));
  }

  /**
   * Connect to a single MCP server
   */
  async connectServer(config: McpServerConfig): Promise<void> {
    // Disconnect existing connection if any
    this.disconnectServer(config.id);
    this.serverConfigs.set(config.id, this.cloneServerConfig(config));
    const connectionGeneration = this.nextConnectionGeneration++;
    this.connectionGenerations.set(config.id, connectionGeneration);

    this.updateStatus(config.id, {
      id: config.id,
      name: config.name,
      state: 'connecting',
      tools: [],
      authRequired: false,
      authState: undefined,
    });

    const headers: Record<string, string> = { ...config.headers };
    const authHeadersProvider = async () => {
      if (
        config.token ||
        Object.keys(headers).some((key) => /authorization|api[-_]key|token|cookie/i.test(key))
      ) {
        return {};
      }

      return getMcpOAuthHeaders(config);
    };
    const client = new McpClient({
      url: config.url,
      token: config.token,
      headers,
      authHeadersProvider,
      name: config.name,
      transportPreference: config.transport,
      sseUrl: config.sseUrl,
      timeout: config.timeoutMs,
    });

    // Listen for tool changes
    client.setOnToolsChanged(async () => {
      if (
        this.clients.get(config.id) !== client ||
        this.connectionGenerations.get(config.id) !== connectionGeneration
      ) {
        return;
      }
      try {
        const tools = await client.listTools();
        const hasOAuth = await hasStoredMcpOAuth(config.id);
        if (
          this.clients.get(config.id) !== client ||
          this.connectionGenerations.get(config.id) !== connectionGeneration ||
          !client.isConnected()
        ) {
          return;
        }
        this.advanceToolRegistryGeneration(config.id);
        this.updateStatus(config.id, {
          id: config.id,
          name: config.name,
          state: 'connected',
          tools,
          lastConnected: Date.now(),
          authRequired: false,
          authState: hasOAuth ? 'authenticated' : undefined,
        });
        this.notifyListeners();
        await emitMcpEvent('tool_added', {
          serverId: config.id,
          serverName: config.name,
        });
      } catch {
        // Ignore tool refresh errors
      }
    });

    try {
      await client.connect();
      const tools = await client.listTools();
      const hasOAuth = await hasStoredMcpOAuth(config.id);

      if (
        this.connectionGenerations.get(config.id) !== connectionGeneration ||
        !client.isConnected()
      ) {
        client.disconnect();
        return;
      }

      this.clients.set(config.id, client);
      this.advanceToolRegistryGeneration(config.id);
      this.updateStatus(config.id, {
        id: config.id,
        name: config.name,
        state: 'connected',
        tools,
        lastConnected: Date.now(),
        authRequired: false,
        authState: hasOAuth ? 'authenticated' : undefined,
      });

      await emitMcpEvent('connected', {
        serverId: config.id,
        serverName: config.name,
      });
    } catch (err: unknown) {
      if (this.connectionGenerations.get(config.id) !== connectionGeneration) {
        client.disconnect();
        return;
      }
      const errObj = err != null && typeof err === 'object' ? (err as Record<string, unknown>) : {};
      const errMsg = err instanceof Error ? err.message : String(err);
      const hasStaticAuth = Boolean(
        config.token ||
        Object.keys(config.headers || {}).some((key) =>
          /authorization|api[-_]key|token|cookie/i.test(key),
        ),
      );
      const hasOAuth = await hasStoredMcpOAuth(config.id);
      if (this.connectionGenerations.get(config.id) !== connectionGeneration) {
        client.disconnect();
        return;
      }
      const requiresAuthentication = Boolean(
        errObj.requiresAuthentication || errObj.statusCode === 401 || errObj.statusCode === 403,
      );
      const authRequired =
        requiresAuthentication && (!hasStaticAuth || hasOAuth || Boolean(config.oauth));

      this.updateStatus(config.id, {
        id: config.id,
        name: config.name,
        state: 'error',
        tools: [],
        error:
          authRequired && !hasStaticAuth
            ? 'Authentication required. Tap Authenticate to complete OAuth, or Edit to add a token or custom headers.'
            : errMsg,
        authRequired,
        authState: authRequired ? 'unauthenticated' : undefined,
      });

      await emitMcpEvent('error', {
        serverId: config.id,
        serverName: config.name,
        error: errMsg,
      });

      throw err;
    }

    this.notifyListeners();
  }

  /**
   * Disconnect a specific server
   */
  disconnectServer(serverId: string): void {
    const client = this.clients.get(serverId);
    if (client) {
      client.disconnect();
      this.clients.delete(serverId);
    }
    this.connectionGenerations.delete(serverId);
    this.toolRegistryGenerations.delete(serverId);
    const status = this.statuses.get(serverId);
    if (status) {
      this.updateStatus(serverId, { ...status, state: 'disconnected', tools: [] });
    }
    this.notifyListeners();
  }

  async authenticateServer(config: McpServerConfig): Promise<void> {
    this.updateStatus(config.id, {
      id: config.id,
      name: config.name,
      state: 'connecting',
      tools: [],
      authRequired: true,
      authState: 'pending',
    });
    this.notifyListeners();

    try {
      await authenticateMcpServer(config);
      await this.connectServer(config);
    } catch (error) {
      const message = error instanceof McpOAuthError ? error.message : String(error);
      this.updateStatus(config.id, {
        id: config.id,
        name: config.name,
        state: 'error',
        tools: [],
        error: message,
        authRequired: true,
        authState: 'unauthenticated',
      });
      this.notifyListeners();
      throw error;
    }
  }

  async clearServerAuth(serverId: string): Promise<void> {
    await clearMcpOAuth(serverId);
    const status = this.statuses.get(serverId);
    if (status) {
      this.updateStatus(serverId, {
        ...status,
        authRequired: false,
        authState: undefined,
      });
      this.notifyListeners();
    }
  }

  /**
   * Disconnect all servers
   */
  disconnectAll(): void {
    for (const [id] of this.clients) {
      this.disconnectServer(id);
    }
  }

  /**
   * Get all MCP tools as Kavi ToolDefinitions
   */
  getAllToolDefinitions(): ToolDefinition[] {
    const definitions: ToolDefinition[] = [];
    for (const [serverId, status] of this.statuses) {
      if (status.state !== 'connected') continue;
      for (const tool of this.filterAllowedTools(serverId, status.tools)) {
        const entry: McpToolEntry = {
          serverId,
          serverName: status.name,
          tool,
          trustToolAnnotations:
            this.serverConfigs.get(serverId)?.trustToolAnnotations === true,
        };
        definitions.push(mcpToolToDefinition(entry));
      }
    }
    return definitions;
  }

  isToolAllowed(serverId: string, toolName: string): boolean {
    const allowed = this.getAllowedToolSet(serverId);
    return !allowed || allowed.has(toolName);
  }

  /** Captures one exact connected client generation and its non-secret target identity. */
  captureRuntimeToolBinding(
    serverId: string,
    toolName: string,
  ): CapturedMcpRuntimeToolBinding | undefined {
    const config = this.serverConfigs.get(serverId);
    const status = this.statuses.get(serverId);
    const client = this.clients.get(serverId);
    const connectionGeneration = this.connectionGenerations.get(serverId);
    const toolRegistryGeneration = this.toolRegistryGenerations.get(serverId);
    const tool = status?.tools.find((candidate) => candidate.name === toolName);
    const targetIdentity = config ? sanitizeEndpointIdentity(config.url) : undefined;
    const sseTargetIdentity = config?.sseUrl ? sanitizeEndpointIdentity(config.sseUrl) : undefined;
    if (
      !config ||
      status?.state !== 'connected' ||
      !client ||
      !client.isConnected() ||
      !connectionGeneration ||
      !toolRegistryGeneration ||
      !tool ||
      !this.isToolAllowed(serverId, toolName) ||
      !targetIdentity ||
      (config.sseUrl && !sseTargetIdentity)
    ) {
      return undefined;
    }
    const declaration = mcpToolToDefinition({
      serverId,
      serverName: status.name,
      tool,
      trustToolAnnotations: config.trustToolAnnotations === true,
    });
    const isCurrent = (): boolean =>
      this.clients.get(serverId) === client &&
      this.connectionGenerations.get(serverId) === connectionGeneration &&
      this.toolRegistryGenerations.get(serverId) === toolRegistryGeneration &&
      this.statuses.get(serverId)?.state === 'connected' &&
      client.isConnected() &&
      this.isToolAllowed(serverId, toolName) &&
      this.statuses.get(serverId)?.tools.some((candidate) => candidate.name === toolName) === true;
    return {
      client,
      declaration,
      provenance: {
        source: 'mcp',
        namespace: serverId,
        connectionGeneration,
        toolRegistryGeneration,
        runtimeProcessEpoch: getRuntimeProcessEpoch(),
        targetIdentity,
        ...(sseTargetIdentity ? { sseTargetIdentity } : {}),
        transport: config.transport ?? 'auto',
        ...(config.trust?.source ? { trustSource: config.trust.source } : {}),
        ...(config.trust?.registryName ? { registryName: config.trust.registryName } : {}),
        ...(config.trustToolAnnotations === true ? { toolAnnotationsTrusted: true as const } : {}),
      },
      isCurrent,
    };
  }

  /**
   * Get clients map for tool execution routing
   */
  getClients(): Map<string, McpClient> {
    return this.clients;
  }

  /**
   * Get status of all servers
   */
  getAllStatuses(): McpServerStatus[] {
    return Array.from(this.statuses.values());
  }

  /**
   * Get status of a specific server
   */
  getStatus(serverId: string): McpServerStatus | undefined {
    return this.statuses.get(serverId);
  }

  /**
   * Subscribe to state changes
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private updateStatus(id: string, status: McpServerStatus): void {
    this.statuses.set(id, status);
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // Ignore listener errors
      }
    }
  }
}

// Singleton instance
export const mcpManager = new McpConnectionManager();
