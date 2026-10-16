import { searchMcpRegistry } from '../../../src/services/setup/mcpRegistrySearch';

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

// The shape registry.modelcontextprotocol.io/v0.1/servers answered with on 2026-10-15.
const REGISTRY_PAGE = {
  servers: [
    {
      server: {
        name: 'com.notion/mcp',
        description: 'Official Notion MCP server',
        version: '1.0.1',
        remotes: [
          { type: 'streamable-http', url: 'https://mcp.notion.com/mcp' },
          { type: 'sse', url: 'https://mcp.notion.com/sse' },
        ],
      },
      _meta: { 'io.modelcontextprotocol.registry/official': { isLatest: true } },
    },
    {
      server: {
        name: 'io.github.someone/notion-copy',
        description: 'A republished copy',
        remotes: [
          {
            type: 'streamable-http',
            url: 'https://notion-copy.example.com/mcp',
            headers: [
              { name: 'Authorization', isRequired: true },
              { name: 'X-Trace', isRequired: false },
            ],
          },
        ],
      },
    },
    { server: { name: 'io.github.someone/local-only', packages: [{ registryType: 'npm' }] } },
    {
      server: {
        name: 'io.github.someone/insecure',
        remotes: [{ type: 'streamable-http', url: 'http://plain.example.com/mcp' }],
      },
    },
    {
      server: {
        name: 'io.github.someone/stdio',
        remotes: [{ type: 'stdio', url: 'https://odd.example.com' }],
      },
    },
    'not a record',
  ],
  metadata: { count: 6 },
};

describe('searchMcpRegistry', () => {
  it("asks the registry for the newest version of matching servers, by the person's words", async () => {
    const fetchImpl = jest.fn(async () => jsonResponse({ servers: [] }));

    await searchMcpRegistry('  google drive ', fetchImpl as unknown as typeof fetch);

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://registry.modelcontextprotocol.io/v0.1/servers?search=google%20drive&limit=30&version=latest',
      expect.objectContaining({ signal: expect.any(Object) }),
    );
  });

  it('keeps only network servers reachable over https, with the headers they require', async () => {
    const result = await searchMcpRegistry('notion', (async () =>
      jsonResponse(REGISTRY_PAGE)) as unknown as typeof fetch);

    expect(result).toEqual({
      status: 'found',
      matches: [
        {
          name: 'com.notion/mcp',
          description: 'Official Notion MCP server',
          url: 'https://mcp.notion.com/mcp',
          transport: 'streamable-http',
          requiredHeaders: [],
        },
        {
          name: 'com.notion/mcp',
          description: 'Official Notion MCP server',
          url: 'https://mcp.notion.com/sse',
          transport: 'sse',
          requiredHeaders: [],
        },
        {
          name: 'io.github.someone/notion-copy',
          description: 'A republished copy',
          url: 'https://notion-copy.example.com/mcp',
          transport: 'streamable-http',
          requiredHeaders: ['Authorization'],
        },
      ],
    });
  });

  it('returns at most eight matches', async () => {
    const servers = Array.from({ length: 20 }, (_, index) => ({
      server: {
        name: `com.example/s${index}`,
        remotes: [{ type: 'sse', url: `https://s${index}.example.com` }],
      },
    }));

    const result = await searchMcpRegistry('s', (async () =>
      jsonResponse({ servers })) as unknown as typeof fetch);

    expect(result.status === 'found' && result.matches).toHaveLength(8);
  });

  it('does not ask the registry about an empty query', async () => {
    const fetchImpl = jest.fn();

    await expect(searchMcpRegistry('   ', fetchImpl)).resolves.toEqual({
      status: 'found',
      matches: [],
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('says the registry is unavailable when it answers with an error or an odd body', async () => {
    await expect(
      searchMcpRegistry('x', (async () => jsonResponse({}, 503)) as unknown as typeof fetch),
    ).resolves.toEqual({ status: 'unavailable', reason: 'The MCP Registry answered 503.' });
    await expect(
      searchMcpRegistry('x', (async () => jsonResponse(['odd'])) as unknown as typeof fetch),
    ).resolves.toEqual({ status: 'found', matches: [] });
  });

  it('says the registry could not be reached when the network fails', async () => {
    await expect(
      searchMcpRegistry('x', (async () => {
        throw new Error('Network request failed');
      }) as unknown as typeof fetch),
    ).resolves.toEqual({
      status: 'unavailable',
      reason: 'The MCP Registry could not be reached: Network request failed',
    });
  });

  it('gives up after eight seconds instead of holding the turn', async () => {
    jest.useFakeTimers();
    try {
      const fetchImpl = (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
        });
      const pending = searchMcpRegistry('slow', fetchImpl as unknown as typeof fetch);

      jest.advanceTimersByTime(8_000);

      await expect(pending).resolves.toEqual({
        status: 'unavailable',
        reason: 'The MCP Registry did not answer in time.',
      });
    } finally {
      jest.useRealTimers();
    }
  });
});
