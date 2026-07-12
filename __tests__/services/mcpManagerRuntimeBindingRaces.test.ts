jest.mock('../../src/services/mcp/client', () => ({
  McpClient: jest.fn(),
}));

jest.mock('../../src/services/mcp/oauth', () => ({
  authenticateMcpServer: jest.fn(),
  clearMcpOAuth: jest.fn(),
  getMcpOAuthHeaders: jest.fn().mockResolvedValue({}),
  hasStoredMcpOAuth: jest.fn().mockResolvedValue(false),
  McpOAuthError: class McpOAuthError extends Error {},
}));

jest.mock('../../src/services/events/bus', () => ({
  emitMcpEvent: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/mcp/bridge', () => ({
  mcpToolToDefinition: jest.fn((entry: any) => ({
    name: `mcp__${entry.serverId}__${entry.tool.name}`,
    description: entry.tool.description || '',
    input_schema: entry.tool.inputSchema || {},
  })),
}));

import { emitMcpEvent } from '../../src/services/events/bus';
import { McpClient } from '../../src/services/mcp/client';
import { mcpManager } from '../../src/services/mcp/manager';
import { hasStoredMcpOAuth } from '../../src/services/mcp/oauth';
import type { McpToolInfo } from '../../src/services/mcp/client';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

interface ControlledMcpClient {
  connect: jest.Mock<Promise<Record<string, never>>, []>;
  disconnect: jest.Mock<void, []>;
  isConnected: jest.Mock<boolean, []>;
  listTools: jest.Mock<Promise<McpToolInfo[]>, []>;
  setOnToolsChanged: jest.Mock<void, [(...args: never[]) => Promise<void> | void]>;
  onToolsChanged?: () => Promise<void> | void;
}

const mockedMcpClient = jest.mocked(McpClient);
const mockedHasStoredMcpOAuth = jest.mocked(hasStoredMcpOAuth);
const mockedEmitMcpEvent = jest.mocked(emitMcpEvent);

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function createClient(listTools: ControlledMcpClient['listTools']): ControlledMcpClient {
  let connected = false;
  const client: ControlledMcpClient = {
    connect: jest.fn(async () => {
      connected = true;
      return {};
    }),
    disconnect: jest.fn(() => {
      connected = false;
    }),
    isConnected: jest.fn(() => connected),
    listTools,
    setOnToolsChanged: jest.fn((callback) => {
      client.onToolsChanged = callback;
    }),
  };
  return client;
}

async function waitForCalls(mock: jest.Mock, count: number): Promise<void> {
  for (let attempt = 0; attempt < 50 && mock.mock.calls.length < count; attempt += 1) {
    await Promise.resolve();
  }
  expect(mock).toHaveBeenCalledTimes(count);
}

const serverConfig = {
  id: 'race-server',
  name: 'Race server',
  url: 'https://mcp.example.com',
  enabled: true,
};

beforeEach(() => {
  mcpManager.disconnectServer(serverConfig.id);
  mockedMcpClient.mockReset();
  mockedHasStoredMcpOAuth.mockReset().mockResolvedValue(false);
  mockedEmitMcpEvent.mockClear();
});

afterEach(() => {
  mcpManager.disconnectServer(serverConfig.id);
});

describe('MCP manager runtime-binding races', () => {
  it('does not publish an initial registry after disconnecting during awaited OAuth state', async () => {
    const oauthState = deferred<boolean>();
    const client = createClient(
      jest.fn(async () => [
        { name: 'stale_initial', description: 'Must not publish', inputSchema: {} },
      ]),
    );
    mockedMcpClient.mockImplementationOnce(() => client as never);
    mockedHasStoredMcpOAuth.mockReturnValueOnce(oauthState.promise);

    const pending = mcpManager.connectServer(serverConfig);
    await waitForCalls(mockedHasStoredMcpOAuth as unknown as jest.Mock, 1);

    mcpManager.disconnectServer(serverConfig.id);
    oauthState.resolve(false);
    await pending;

    expect(client.disconnect).toHaveBeenCalledTimes(1);
    expect(mcpManager.getStatus(serverConfig.id)).toMatchObject({
      state: 'disconnected',
      tools: [],
    });
    expect(mcpManager.getClients().has(serverConfig.id)).toBe(false);
    expect(mcpManager.captureRuntimeToolBinding(serverConfig.id, 'stale_initial')).toBeUndefined();
    expect(mockedEmitMcpEvent).not.toHaveBeenCalledWith(
      'connected',
      expect.objectContaining({ serverId: serverConfig.id }),
    );
  });

  it('does not publish a refreshed registry after disconnecting during awaited OAuth state', async () => {
    const oauthState = deferred<boolean>();
    const client = createClient(
      jest
        .fn<Promise<McpToolInfo[]>, []>()
        .mockResolvedValueOnce([{ name: 'original', description: 'Original', inputSchema: {} }])
        .mockResolvedValueOnce([
          { name: 'stale_refresh', description: 'Must not publish', inputSchema: {} },
        ]),
    );
    mockedMcpClient.mockImplementationOnce(() => client as never);
    mockedHasStoredMcpOAuth.mockResolvedValueOnce(false).mockReturnValueOnce(oauthState.promise);

    await mcpManager.connectServer(serverConfig);
    const originalBinding = mcpManager.captureRuntimeToolBinding(serverConfig.id, 'original');
    expect(originalBinding?.isCurrent()).toBe(true);

    const pendingRefresh = client.onToolsChanged?.();
    await waitForCalls(mockedHasStoredMcpOAuth as unknown as jest.Mock, 2);
    mcpManager.disconnectServer(serverConfig.id);
    oauthState.resolve(false);
    await pendingRefresh;

    expect(originalBinding?.isCurrent()).toBe(false);
    expect(mcpManager.getStatus(serverConfig.id)).toMatchObject({
      state: 'disconnected',
      tools: [],
    });
    expect(mcpManager.captureRuntimeToolBinding(serverConfig.id, 'stale_refresh')).toBeUndefined();
    expect(mockedEmitMcpEvent).not.toHaveBeenCalledWith(
      'tool_added',
      expect.objectContaining({ serverId: serverConfig.id }),
    );
  });

  it('keeps the reconnect registry authoritative when an old initial connect resolves later', async () => {
    const staleOAuthState = deferred<boolean>();
    const firstClient = createClient(
      jest.fn(async () => [
        { name: 'stale_initial', description: 'Must not publish', inputSchema: {} },
      ]),
    );
    const replacementClient = createClient(
      jest.fn(async () => [{ name: 'replacement', description: 'Replacement', inputSchema: {} }]),
    );
    mockedMcpClient
      .mockImplementationOnce(() => firstClient as never)
      .mockImplementationOnce(() => replacementClient as never);
    mockedHasStoredMcpOAuth
      .mockReturnValueOnce(staleOAuthState.promise)
      .mockResolvedValueOnce(false);

    const staleConnect = mcpManager.connectServer(serverConfig);
    await waitForCalls(mockedHasStoredMcpOAuth as unknown as jest.Mock, 1);

    await mcpManager.connectServer(serverConfig);
    const replacementBinding = mcpManager.captureRuntimeToolBinding(serverConfig.id, 'replacement');
    expect(replacementBinding?.client).toBe(replacementClient);

    staleOAuthState.resolve(false);
    await staleConnect;

    expect(firstClient.disconnect).toHaveBeenCalledTimes(1);
    expect(replacementBinding?.isCurrent()).toBe(true);
    expect(mcpManager.getStatus(serverConfig.id)).toMatchObject({
      state: 'connected',
      tools: [expect.objectContaining({ name: 'replacement' })],
    });
    expect(mcpManager.captureRuntimeToolBinding(serverConfig.id, 'stale_initial')).toBeUndefined();
  });

  it('keeps the reconnect registry authoritative when an old refresh resolves later', async () => {
    const staleRefresh = deferred<McpToolInfo[]>();
    const firstClient = createClient(
      jest
        .fn<Promise<McpToolInfo[]>, []>()
        .mockResolvedValueOnce([{ name: 'original', description: 'Original', inputSchema: {} }])
        .mockReturnValueOnce(staleRefresh.promise),
    );
    const replacementClient = createClient(
      jest.fn(async () => [{ name: 'replacement', description: 'Replacement', inputSchema: {} }]),
    );
    mockedMcpClient
      .mockImplementationOnce(() => firstClient as never)
      .mockImplementationOnce(() => replacementClient as never);

    await mcpManager.connectServer(serverConfig);
    const originalBinding = mcpManager.captureRuntimeToolBinding(serverConfig.id, 'original');
    const pendingRefresh = firstClient.onToolsChanged?.();
    await waitForCalls(firstClient.listTools, 2);

    await mcpManager.connectServer(serverConfig);
    const replacementBinding = mcpManager.captureRuntimeToolBinding(serverConfig.id, 'replacement');
    expect(replacementBinding?.client).toBe(replacementClient);

    staleRefresh.resolve([
      { name: 'stale_refresh', description: 'Must not publish', inputSchema: {} },
    ]);
    await pendingRefresh;

    expect(firstClient.disconnect).toHaveBeenCalledTimes(1);
    expect(originalBinding?.isCurrent()).toBe(false);
    expect(replacementBinding?.isCurrent()).toBe(true);
    expect(mcpManager.getStatus(serverConfig.id)).toMatchObject({
      state: 'connected',
      tools: [expect.objectContaining({ name: 'replacement' })],
    });
    expect(mcpManager.captureRuntimeToolBinding(serverConfig.id, 'stale_refresh')).toBeUndefined();
  });
});
