jest.mock('../../src/services/memory/policy', () => ({
  ...jest.requireActual('../../src/services/memory/policy'),
  isLongTermMemoryEnabled: jest.fn(() => true),
}));

let mockMcpTools: unknown[] = [];
jest.mock('../../src/services/mcp/manager', () => ({
  mcpManager: {
    getAllStatuses: () => [],
    getAllToolDefinitions: () => mockMcpTools,
  },
}));

import { executeToolDescribe } from '../../src/engine/tools/builtin-tool-describe';
import { parseCompletedToolOutcome, parseFailedToolOutcome } from '../helpers/toolRuntimeOutcome';

describe('executeToolDescribe', () => {
  beforeEach(() => {
    mockMcpTools = [];
  });

  it('returns a built-in tool’s description and input schema', async () => {
    const result = await executeToolDescribe({ name: 'memory_search' });
    const parsed = parseCompletedToolOutcome(result);

    expect(parsed).toEqual({
      mode: 'describe',
      tool: {
        name: 'memory_search',
        description: expect.any(String),
        source: 'built-in',
        input_schema: expect.objectContaining({ type: 'object' }),
        activation: { name: 'memory_search', eligible: true, callableNow: true },
      },
    });
  });

  it('describes a connected MCP tool with the digest activation checks', async () => {
    mockMcpTools = [
      {
        name: 'mcp__srv-1__search_docs',
        description: 'Search docs',
        input_schema: { type: 'object', properties: { q: { type: 'string' } } },
      },
    ];

    const parsed = parseCompletedToolOutcome(
      await executeToolDescribe({ name: 'mcp__srv-1__search_docs' }),
    );

    expect(parsed.tool).toMatchObject({
      name: 'mcp__srv-1__search_docs',
      source: 'mcp',
      schemaDigest: expect.stringMatching(/^schema-fnv1a32:[0-9a-f]{8}$/),
      input_schema: { type: 'object', properties: { q: { type: 'string' } } },
    });
  });

  it('returns structured error for unknown tools', async () => {
    const result = await executeToolDescribe({ name: 'not_a_real_tool_xyz' });
    const parsed = parseFailedToolOutcome(result);

    expect(parsed.error).toContain('Unknown tool');
  });

  it('describes discoverable tools outside the current callable surface', async () => {
    const result = await executeToolDescribe(
      { name: 'memory_search' },
      { availableToolNames: new Set(['tool_catalog']) },
    );
    const parsed = parseCompletedToolOutcome(result);

    expect(parsed.tool.name).toBe('memory_search');
    expect(parsed.tool.activation).toMatchObject({
      name: 'memory_search',
      eligible: true,
      callableNow: false,
    });
  });

  it('does not describe a tool outside the code-owned catalog visibility boundary', async () => {
    const result = await executeToolDescribe(
      { name: 'sessions_spawn' },
      { visibleToolNames: new Set(['tool_catalog', 'tool_describe', 'wait']) },
    );

    expect(parseFailedToolOutcome(result)).toEqual({ error: 'Unknown tool: sessions_spawn' });
  });
});
