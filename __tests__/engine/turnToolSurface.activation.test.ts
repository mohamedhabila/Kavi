import { resolveDefaultGroundedRequestScopedTools } from '../../src/engine/graph/turnToolSurface';
import { resolveTurnToolSurface } from '../../src/engine/tools/toolSurface';
import { buildToolSchemaDigest } from '../../src/engine/tools/builtin-tool-schemaDigest';
import { mcpManager } from '../../src/services/mcp/manager';
import type { ToolDefinition } from '../../src/types/tool';
import { tools, userMessage } from '../helpers/turnToolSurfaceHarness';

const INTEGRATION_SCHEMA = {
  type: 'object',
  properties: { recordId: { type: 'string' } },
  required: ['recordId'],
} as const;

const INTEGRATION_TOOL_NAMES = ['mcp__ledger__get_record', 'mcp__ledger__put_record'] as const;

function mockConnectedIntegration(lastConnected: number): ToolDefinition[] {
  const definitions = INTEGRATION_TOOL_NAMES.map((name) => ({
    name,
    description: `Connected ledger tool ${name}`,
    input_schema: INTEGRATION_SCHEMA,
  }));
  jest.spyOn(mcpManager, 'getAllToolDefinitions').mockReturnValue(definitions);
  jest.spyOn(mcpManager, 'getAllStatuses').mockReturnValue([
    {
      id: 'ledger',
      name: 'Ledger',
      state: 'connected',
      lastConnected,
      tools: [
        {
          name: 'get_record',
          description: 'Read a ledger record.',
          inputSchema: INTEGRATION_SCHEMA,
        },
        {
          name: 'put_record',
          description: 'Update a ledger record.',
          inputSchema: INTEGRATION_SCHEMA,
        },
      ],
    },
  ]);
  return definitions;
}

function previousTurnDiscoveryMessages(schemaDigest: string) {
  return [
    userMessage('Find my connected ledger tools.', 100),
    {
      id: 'assistant-discovery',
      role: 'assistant' as const,
      content: '',
      timestamp: 110,
      toolCalls: [
        {
          id: 'tc-discovery',
          name: 'tool_catalog',
          arguments: '{"query":"ledger"}',
          status: 'completed' as const,
        },
      ],
    },
    {
      id: 'tool-discovery',
      role: 'tool' as const,
      toolCallId: 'tc-discovery',
      content: JSON.stringify({
        tools: INTEGRATION_TOOL_NAMES.map((name) => ({
          name,
          source: 'mcp',
          schemaDigest,
          activation: { name, eligible: true, callableNow: true },
        })),
      }),
      timestamp: 120,
    },
    userMessage('Use those tools for the follow-up.', 130),
  ];
}

describe('resolveDefaultGroundedRequestScopedTools', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('surfaces session delegation on the agentic core', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: tools,
      workingMessages: [
        {
          id: 'u1',
          role: 'user',
          content: 'Delegate workstream worker-chain and record worker evidence.',
          timestamp: 1,
        },
      ],
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('sessions_spawn')).toBe(true);
  });

  it('keeps catalog-activated tools on surface across a new user turn via session cache', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: tools,
      sessionActivatedToolNames: ['memory_search'],
      workingMessages: [
        userMessage('Find memory recall tooling.'),
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          timestamp: 2,
          toolCalls: [
            {
              id: 'tc-search',
              name: 'tool_catalog',
              arguments: '{"query":"memory_search"}',
              status: 'completed',
            },
          ],
        },
        {
          id: 'tool-1',
          role: 'tool',
          content: JSON.stringify({
            mode: 'search',
            query: 'memory_search',
            tools: [{ name: 'memory_search' }],
          }),
          toolCallId: 'tc-search',
          timestamp: 3,
        },
        userMessage('Use memory recall now.'),
      ],
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('memory_search')).toBe(true);
    expect(selectedToolNames.has('tool_catalog')).toBe(true);
    expect(selectedToolNames.has('tool_describe')).toBe(true);
  });

  it('drops non-core catalog activation on a new user turn without session cache', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: tools,
      workingMessages: [
        userMessage('Find memory recall tooling.'),
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          timestamp: 2,
          toolCalls: [
            {
              id: 'tc-search',
              name: 'tool_catalog',
              arguments: '{"query":"memory_search"}',
              status: 'completed',
            },
          ],
        },
        {
          id: 'tool-1',
          role: 'tool',
          content: JSON.stringify({
            mode: 'search',
            query: 'memory_search',
            tools: [{ name: 'memory_search' }],
          }),
          toolCallId: 'tc-search',
          timestamp: 3,
        },
        userMessage('Use memory recall now.'),
      ],
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('memory_search')).toBe(true);
    expect(selectedToolNames.has('tool_catalog')).toBe(true);
  });

  it('surfaces session-activated tools without discovery pins', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: tools,
      sessionActivatedToolNames: ['memory_search'],
      workingMessages: [userMessage('Recall the stored fact.')],
    });

    const names = new Set(selected.map((tool) => tool.name));
    expect(names.has('memory_search')).toBe(true);
    expect(names.has('tool_catalog')).toBe(true);
  });

  it('keeps an explicitly activated runtime integration callable after an earlier read', async () => {
    const integrationTool = {
      name: 'mcp__ledger__get_record',
      description: 'Read one connected ledger record.',
      input_schema: {
        type: 'object',
        properties: { recordId: { type: 'string' } },
        required: ['recordId'],
      },
    };
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: [...tools, integrationTool],
      sessionActivatedToolNames: [integrationTool.name],
      workingMessages: [
        userMessage('Complete the current workflow.'),
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          timestamp: 2,
          toolCalls: [
            {
              id: 'tc-integration-read',
              name: integrationTool.name,
              arguments: '{"recordId":"record-1"}',
              status: 'completed',
            },
          ],
        },
        {
          id: 'tool-1',
          role: 'tool',
          toolCallId: 'tc-integration-read',
          content: '{"status":"found"}',
          timestamp: 3,
        },
      ],
    });

    const names = new Set(selected.map((tool) => tool.name));
    expect(names.has(integrationTool.name)).toBe(true);
  });

  it('keeps exact dynamic tools discovered in the immediately preceding turn reachable', async () => {
    const integrationTools = mockConnectedIntegration(90);
    const schemaDigest = buildToolSchemaDigest(INTEGRATION_SCHEMA);
    if (!schemaDigest) {
      throw new Error('Expected the integration schema to have a digest.');
    }

    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: [...tools, ...integrationTools],
      workingMessages: previousTurnDiscoveryMessages(schemaDigest),
    });

    const names = new Set(selected.map((tool) => tool.name));
    expect(names.has(INTEGRATION_TOOL_NAMES[0])).toBe(true);
    expect(names.has(INTEGRATION_TOOL_NAMES[1])).toBe(true);
  });

  it('keeps an MCP tool the conversation activated while it is registered', () => {
    const mcpTool = {
      name: 'mcp__docs__search_docs',
      description: 'Search the docs.',
      input_schema: { type: 'object' as const, properties: {} },
    };
    const surface = (allTools: typeof tools) =>
      resolveTurnToolSurface({ allTools, conversationToolNames: [mcpTool.name] }).map(
        (tool) => tool.name,
      );

    expect(surface([...tools, mcpTool])).toContain(mcpTool.name);
    // Once its server is gone, the registry no longer lists it, and neither does the surface.
    expect(surface(tools)).not.toContain(mcpTool.name);
  });
});
