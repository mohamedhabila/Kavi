// ---------------------------------------------------------------------------
// Tests — MCP Bridge + Manager
// ---------------------------------------------------------------------------

import {
  mcpToolToDefinition,
  parseMcpToolName,
  formatMcpResult,
  executeMcpTool,
  McpToolEntry,
} from '../../src/services/mcp/bridge';
import { resetRemoteStore, useRemoteStore } from '../../src/services/remote/store';

// We test bridge functions directly; manager is tested via its public API.

beforeEach(() => {
  resetRemoteStore();
});

describe('mcpToolToDefinition', () => {
  it('converts an MCP tool entry to a ToolDefinition', () => {
    const entry: McpToolEntry = {
      serverId: 'server1',
      serverName: 'Test Server',
      tool: {
        name: 'do_thing',
        description: 'Does a thing',
        inputSchema: {
          type: 'object',
          properties: { input: { type: 'string' } },
          required: ['input'],
        },
      },
    };

    const def = mcpToolToDefinition(entry);
    expect(def.name).toBe('mcp__server1__do_thing');
    expect(def.description).toContain('[Test Server]');
    expect(def.description).toContain('Does a thing');
    expect(def.input_schema.type).toBe('object');
    expect(def.input_schema.properties).toHaveProperty('input');
    expect(def.input_schema.required).toEqual(['input']);
  });

  it('handles missing inputSchema', () => {
    const entry: McpToolEntry = {
      serverId: 's1',
      serverName: 'S1',
      tool: { name: 'tool1', inputSchema: {} },
    };
    const def = mcpToolToDefinition(entry);
    expect(def.name).toBe('mcp__s1__tool1');
    expect(def.input_schema.type).toBe('object');
  });

  it('falls back to tool name when description missing', () => {
    const entry: McpToolEntry = {
      serverId: 's1',
      serverName: 'S1',
      tool: { name: 'my_tool', inputSchema: { type: 'object', properties: {} } },
    };
    const def = mcpToolToDefinition(entry);
    expect(def.description).toContain('my_tool');
  });

  it('normalizes live-style MCP schemas into provider-safe leaf nodes while preserving metadata', () => {
    const entry: McpToolEntry = {
      serverId: 'atars',
      serverName: 'aTars MCP',
      tool: {
        name: 'get_multi_indicator',
        description: 'Retrieve multiple technical indicators side-by-side.',
        inputSchema: {
          type: 'object',
          title: 'get_multi_indicatorArguments',
          properties: {
            indicators: {
              type: 'array',
              title: 'Indicators',
              items: {},
            },
            indicator_codes: {
              type: 'array',
              items: {
                title: 'Indicator Code',
                enum: ['rsi', 'macd'],
              },
            },
            lookback_days: {
              type: 'integer',
              default: 7,
              title: 'Lookback Days',
            },
          },
          required: ['indicators'],
        },
      },
    };

    const def = mcpToolToDefinition(entry);

    expect(def.input_schema.title).toBe('get_multi_indicatorArguments');
    expect(def.input_schema.properties.indicators.type).toBe('array');
    expect(def.input_schema.properties.indicators.items).toEqual({ type: 'string' });
    expect(def.input_schema.properties.indicators.title).toBe('Indicators');
    expect(def.input_schema.properties.indicator_codes.items.type).toBe('string');
    expect(def.input_schema.properties.indicator_codes.items.title).toBe('Indicator Code');
    expect(def.input_schema.properties.indicator_codes.items.enum).toEqual(['rsi', 'macd']);
    expect(def.input_schema.properties.lookback_days.default).toBe(7);
  });
});

describe('parseMcpToolName', () => {
  it('parses a valid MCP tool name', () => {
    const result = parseMcpToolName('mcp__server1__do_thing');
    expect(result).toEqual({ serverId: 'server1', toolName: 'do_thing' });
  });

  it('handles server IDs with single underscores', () => {
    const result = parseMcpToolName('mcp__my_server__tool_name');
    expect(result).toEqual({ serverId: 'my_server', toolName: 'tool_name' });
  });

  it('returns null for non-MCP tool names', () => {
    expect(parseMcpToolName('read_file')).toBeNull();
    expect(parseMcpToolName('skill__id__tool')).toBeNull();
  });

  it('returns null for malformed MCP names', () => {
    expect(parseMcpToolName('mcp__')).toBeNull();
    expect(parseMcpToolName('mcp__server')).toBeNull();
  });
});

describe('formatMcpResult', () => {
  it('formats text content', () => {
    const result = formatMcpResult({
      content: [{ type: 'text', text: 'Hello world' }],
      isError: false,
    });
    expect(result).toBe('Hello world');
  });

  it('formats image content as placeholder', () => {
    const result = formatMcpResult({
      content: [{ type: 'image', mimeType: 'image/jpeg' }],
      isError: false,
    });
    expect(result).toContain('[Image: image/jpeg]');
  });

  it('formats resource content with text', () => {
    const result = formatMcpResult({
      content: [{ type: 'resource', resource: { text: 'resource text', uri: 'file://test' } }],
      isError: false,
    });
    expect(result).toBe('resource text');
  });

  it('formats resource content without text', () => {
    const result = formatMcpResult({
      content: [{ type: 'resource', resource: { uri: 'file://test' } }],
      isError: false,
    });
    expect(result).toContain('[Resource: file://test]');
  });

  it('prefixes error results', () => {
    const result = formatMcpResult({
      content: [{ type: 'text', text: 'Something failed' }],
      isError: true,
    });
    expect(result).toBe('Error: Something failed');
  });

  it('joins multiple content items', () => {
    const result = formatMcpResult({
      content: [
        { type: 'text', text: 'Part 1' },
        { type: 'text', text: 'Part 2' },
      ],
      isError: false,
    });
    expect(result).toBe('Part 1\n\nPart 2');
  });
});

describe('executeMcpTool', () => {
  it('returns error for invalid tool name', async () => {
    const clients = new Map();
    const result = await executeMcpTool(clients, 'bad_name', '{}');
    expect(result).toContain('invalid MCP tool name');
  });

  it('returns error when server not connected', async () => {
    const clients = new Map();
    const result = await executeMcpTool(clients, 'mcp__server1__tool', '{}');
    expect(result).toContain('not connected');
  });

  it('returns error when client is disconnected', async () => {
    const mockClient = {
      isConnected: () => false,
      callTool: jest.fn(),
    };
    const clients = new Map([['server1', mockClient as any]]);
    const result = await executeMcpTool(clients, 'mcp__server1__tool', '{}');
    expect(result).toContain('disconnected');
  });

  it('returns error for invalid JSON args', async () => {
    const mockClient = {
      isConnected: () => true,
      callTool: jest.fn(),
    };
    const clients = new Map([['server1', mockClient as any]]);
    const result = await executeMcpTool(clients, 'mcp__server1__tool', 'not-json');
    expect(result).toContain('invalid tool arguments');
  });

  it('returns error when arguments JSON is not an object', async () => {
    const mockClient = {
      isConnected: () => true,
      callTool: jest.fn(),
    };
    const clients = new Map([['server1', mockClient as any]]);
    const result = await executeMcpTool(clients, 'mcp__server1__tool', '[]');
    expect(result).toContain('arguments must be a JSON object');
    expect(mockClient.callTool).not.toHaveBeenCalled();
  });

  it('denies MCP tools blocked by allowlist policy before execution', async () => {
    const mockClient = {
      isConnected: () => true,
      callTool: jest.fn(),
    };
    const clients = new Map([['server1', mockClient as any]]);

    const result = await executeMcpTool(clients, 'mcp__server1__tool', '{}', {
      isToolAllowed: () => false,
    });

    expect(result).toContain('not allowed');
    expect(mockClient.callTool).not.toHaveBeenCalled();
  });

  it('calls the correct client and formats result', async () => {
    const mockClient = {
      isConnected: () => true,
      callTool: jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Tool result' }],
        isError: false,
      }),
    };
    const clients = new Map([['server1', mockClient as any]]);
    const result = await executeMcpTool(
      clients,
      'mcp__server1__my_tool',
      JSON.stringify({ key: 'value' }),
    );
    expect(result).toBe('Tool result');
    expect(mockClient.callTool).toHaveBeenCalledWith('my_tool', { key: 'value' });
    expect(Object.values(useRemoteStore.getState().jobs)).toHaveLength(1);
    expect(Object.values(useRemoteStore.getState().sessions)).toHaveLength(1);
  });

  it('handles callTool errors', async () => {
    const mockClient = {
      isConnected: () => true,
      callTool: jest.fn().mockRejectedValue(new Error('Connection lost')),
    };
    const clients = new Map([['server1', mockClient as any]]);
    const result = await executeMcpTool(clients, 'mcp__server1__tool', '{}');
    expect(result).toContain('Connection lost');
    expect(Object.values(useRemoteStore.getState().jobs)[0]?.status).toBe('failed');
  });
});
