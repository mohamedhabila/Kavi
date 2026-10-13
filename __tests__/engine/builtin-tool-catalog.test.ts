let mockMcpStatuses: unknown[] = [];
let mockSkillTools: unknown[] = [];
jest.mock('../../src/services/mcp/manager', () => ({
  mcpManager: {
    getAllStatuses: () => mockMcpStatuses,
    getAllToolDefinitions: () =>
      (
        mockMcpStatuses as Array<{
          id: string;
          tools: Array<{ name: string; description: string }>;
        }>
      ).flatMap((status) =>
        status.tools.map((tool) => ({
          name: `mcp__${status.id}__${tool.name}`,
          description: tool.description,
          input_schema: { type: 'object', properties: {} },
        })),
      ),
  },
}));
jest.mock('../../src/services/skills/manager', () => ({
  parseSkillToolName: jest.requireActual('../../src/services/skills/manager').parseSkillToolName,
  getSkillToolDefinitions: () => mockSkillTools,
  isSkillCompatible: () => ({ compatible: true }),
  useSkillsStore: { getState: () => ({ getEnabled: () => [] }) },
}));

import { executeToolCatalog } from '../../src/engine/tools/builtin-tool-catalog';
import { parseCompletedToolOutcome, parseFailedToolOutcome } from '../helpers/toolRuntimeOutcome';

type CatalogEntry = {
  name: string;
  description: string;
  source: string;
  schemaDigest?: string;
  activation: { name: string; eligible: boolean; callableNow: boolean };
};

async function search(
  args: Record<string, unknown>,
  options?: Parameters<typeof executeToolCatalog>[1],
) {
  return parseCompletedToolOutcome(await executeToolCatalog(args as never, options)) as {
    mode: string;
    query: string;
    tools: CatalogEntry[];
  };
}

function names(result: { tools: CatalogEntry[] }): string[] {
  return result.tools.map((tool) => tool.name);
}

function connectMcpServer(tools: Array<{ name: string; description: string }>): void {
  mockMcpStatuses = [
    {
      id: 'srv-1',
      name: 'Docs MCP',
      state: 'connected',
      tools: tools.map((tool) => ({ ...tool, inputSchema: { type: 'object', properties: {} } })),
    },
  ];
}

describe('tool_catalog', () => {
  beforeEach(() => {
    mockMcpStatuses = [];
    mockSkillTools = [];
  });

  it('asks for a query when there is none', async () => {
    for (const args of [{}, { query: '   ' }]) {
      expect(parseFailedToolOutcome(await executeToolCatalog(args))).toEqual({
        error: 'tool_catalog needs a query: say in a few words what you need to do.',
      });
    }
  });

  // Live run ad55-r1: these were the model's arguments. The category and capability filters
  // hid every tool it needed, so it concluded the device could not capture the screen.
  it('finds the capture tools a media request needs, whatever filters the model guesses', async () => {
    const result = await search({
      query: 'screenshot capture screen recording video',
      category: 'native',
      capabilities: ['discover', 'read'],
    });

    expect(result.mode).toBe('search');
    expect(names(result)).toEqual(expect.arrayContaining(['screen_record', 'camera_clip']));
  });

  it('finds the SMS composer when the model guesses the wrong domain', async () => {
    const result = await search({
      query: 'open native SMS composer with prefilled draft',
      category: 'interaction',
    });

    expect(names(result)[0]).toBe('sms_compose');
    expect(names(result)).not.toContain('poll_create');
  });

  it('returns at most eight compact entries, best first', async () => {
    const result = await search({ query: 'browser page navigate click snapshot' });

    expect(result.tools.length).toBeGreaterThan(0);
    expect(result.tools.length).toBeLessThanOrEqual(8);
    expect(names(result)).toEqual(
      expect.arrayContaining(['browser_navigate', 'browser_click', 'browser_snapshot']),
    );
    for (const tool of result.tools) {
      expect(Object.keys(tool).sort()).toEqual(['activation', 'description', 'name', 'source']);
      expect(Array.from(tool.description).length).toBeLessThanOrEqual(240);
      expect(tool.activation).toEqual({ name: tool.name, eligible: true, callableNow: true });
    }
  });

  it('returns nothing for a query no tool matches', async () => {
    expect((await search({ query: 'zzqx' })).tools).toEqual([]);
  });

  it('reads queries in any script', async () => {
    connectMcpServer([{ name: 'send_sms', description: 'إرسال رسالة نصية إلى جهة اتصال' }]);

    expect(names(await search({ query: 'أريد إرسال رسالة' }))).toEqual(['mcp__srv-1__send_sms']);
  });

  it('includes connected MCP tools and installed skills with the digest activation checks', async () => {
    connectMcpServer([{ name: 'search_docs', description: 'Search the product documentation' }]);
    mockSkillTools = [
      {
        name: 'skill__weather__forecast',
        description: '[Weather Skill] Forecast helper for upcoming days',
        input_schema: { type: 'object', properties: {} },
      },
    ];

    const docs = await search({ query: 'search documentation' });
    const weather = await search({ query: 'weather forecast' });

    expect(docs.tools[0]).toEqual({
      name: 'mcp__srv-1__search_docs',
      description: 'Search the product documentation (Docs MCP)',
      source: 'mcp',
      schemaDigest: expect.stringMatching(/^schema-fnv1a32:[0-9a-f]{8}$/),
      activation: { name: 'mcp__srv-1__search_docs', eligible: true, callableNow: true },
    });
    expect(weather.tools[0]).toMatchObject({
      name: 'skill__weather__forecast',
      source: 'skill',
      schemaDigest: expect.stringMatching(/^schema-fnv1a32:[0-9a-f]{8}$/),
    });
  });

  it('keeps tools outside the run’s visibility out and marks tools not yet callable', async () => {
    const hidden = await search(
      { query: 'screen record camera clip' },
      { visibleToolNames: new Set(['tool_catalog', 'camera_clip']) },
    );
    const notYetCallable = await search(
      { query: 'record a camera clip' },
      { availableToolNames: new Set(['tool_catalog']) },
    );

    expect(names(hidden)).toEqual(['camera_clip']);
    expect(notYetCallable.tools.find((tool) => tool.name === 'camera_clip')?.activation).toEqual({
      name: 'camera_clip',
      eligible: true,
      callableNow: false,
    });
  });
});
