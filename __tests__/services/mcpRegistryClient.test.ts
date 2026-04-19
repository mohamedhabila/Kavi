// ---------------------------------------------------------------------------
// Tests — Official MCP Registry Client
// ---------------------------------------------------------------------------

import {
  buildMcpInstallDraft,
  listOfficialMcpRegistry,
} from '../../src/services/mcp/registryClient';

describe('registryClient', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('filters to latest active remote-installable entries', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        servers: [
          {
            server: {
              name: 'com.example/remote-good',
              title: 'Remote Good',
              description: 'Installable on mobile',
              version: '1.0.0',
              remotes: [
                {
                  type: 'streamable-http',
                  url: 'https://example.com/mcp',
                  headers: [
                    {
                      name: 'Authorization',
                      isRequired: true,
                      isSecret: true,
                    },
                  ],
                },
              ],
            },
            _meta: {
              'io.modelcontextprotocol.registry/official': {
                status: 'active',
                isLatest: true,
              },
            },
          },
          {
            server: {
              name: 'com.example/package-only',
              title: 'Package Only',
              version: '1.0.0',
              packages: [{ registryType: 'npm', identifier: '@example/package-only' }],
            },
            _meta: {
              'io.modelcontextprotocol.registry/official': {
                status: 'active',
                isLatest: true,
              },
            },
          },
          {
            server: {
              name: 'com.example/outdated',
              title: 'Outdated',
              version: '0.9.0',
              remotes: [{ type: 'sse', url: 'https://example.com/sse' }],
            },
            _meta: {
              'io.modelcontextprotocol.registry/official': {
                status: 'active',
                isLatest: false,
              },
            },
          },
        ],
        metadata: { nextCursor: null },
      }),
    });

    global.fetch = fetchMock as any;

    const result = await listOfficialMcpRegistry({ limit: 20 });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].name).toBe('Remote Good');
    expect(result.entries[0].remotes).toHaveLength(1);
    expect(result.entries[0].remotes[0].headers[0]).toMatchObject({
      key: 'Authorization',
      required: true,
      secret: true,
    });
    expect(result.entries[0].trust).toEqual({
      source: 'official-registry',
      registryName: 'com.example/remote-good',
      websiteUrl: undefined,
    });
    expect(result.entries[0].capabilities).toEqual({
      transports: ['streamable-http'],
      authMode: 'header',
      requiresConfiguration: true,
      requiresSecrets: true,
      inputCount: 1,
    });
  });

  it('builds an MCP config from remote variables and headers', () => {
    const draft = buildMcpInstallDraft(
      {
        id: 'com.example/acme@1.0.0',
        name: 'ACME Analytics',
        registryName: 'com.example/acme',
        description: 'Analytics tools',
        version: '1.0.0',
        trust: {
          source: 'official-registry',
          registryName: 'com.example/acme',
          websiteUrl: 'https://example.com/acme',
        },
        capabilities: {
          transports: ['streamable-http'],
          authMode: 'mixed',
          requiresConfiguration: true,
          requiresSecrets: true,
          inputCount: 2,
        },
        remotes: [
          {
            id: 'remote-1',
            type: 'streamable-http',
            url: 'https://api.example.com/{region}/mcp',
            label: 'HTTP prod',
            variables: [
              {
                key: 'region',
                label: 'region',
                kind: 'variable',
                required: true,
                secret: false,
              },
            ],
            headers: [
              {
                key: 'Authorization',
                label: 'Authorization',
                kind: 'header',
                required: true,
                secret: true,
              },
            ],
          },
        ],
      },
      {
        id: 'remote-1',
        type: 'streamable-http',
        url: 'https://api.example.com/{region}/mcp',
        label: 'HTTP prod',
        variables: [
          {
            key: 'region',
            label: 'region',
            kind: 'variable',
            required: true,
            secret: false,
          },
        ],
        headers: [
          {
            key: 'Authorization',
            label: 'Authorization',
            kind: 'header',
            required: true,
            secret: true,
          },
        ],
      },
      {
        region: 'eu-west-1',
        Authorization: 'Bearer secret-key',
      },
    );

    expect(draft.resolvedUrl).toBe('https://api.example.com/eu-west-1/mcp');
    expect(draft.config.transport).toBe('streamable-http');
    expect(draft.config.url).toBe('https://api.example.com/eu-west-1/mcp');
    expect(draft.config.headers).toEqual({ Authorization: 'Bearer secret-key' });
    expect(draft.config.enabled).toBe(true);
    expect(draft.config.trust).toEqual({
      source: 'official-registry',
      registryName: 'com.example/acme',
      websiteUrl: 'https://example.com/acme',
    });
    expect(draft.config.capabilities).toEqual({
      transport: 'streamable-http',
      authMode: 'mixed',
      requiresConfiguration: true,
      requiresSecrets: true,
      inputCount: 2,
    });
  });

  it('keeps auth mode as none when the registry does not declare auth inputs', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        servers: [
          {
            server: {
              name: 'com.example/remote-no-auth-hints',
              title: 'Remote No Auth Hints',
              description: 'Hosted remote without declared auth inputs',
              version: '1.0.0',
              remotes: [
                {
                  type: 'streamable-http',
                  url: 'https://example.com/mcp',
                },
              ],
            },
            _meta: {
              'io.modelcontextprotocol.registry/official': {
                status: 'active',
                isLatest: true,
              },
            },
          },
        ],
        metadata: { nextCursor: null },
      }),
    });

    global.fetch = fetchMock as any;

    const result = await listOfficialMcpRegistry({ limit: 20, search: 'remote' });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].capabilities).toEqual({
      transports: ['streamable-http'],
      authMode: 'none',
      requiresConfiguration: false,
      requiresSecrets: false,
      inputCount: 0,
    });

    const draft = buildMcpInstallDraft(result.entries[0], result.entries[0].remotes[0], {});
    expect(draft.config.capabilities).toEqual({
      transport: 'streamable-http',
      authMode: 'none',
      requiresConfiguration: false,
      requiresSecrets: false,
      inputCount: 0,
    });
  });

  it('preserves registry order and filters unsupported SSE-only remotes', async () => {
    const originalEventSource = (global as any).EventSource;
    delete (global as any).EventSource;

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        servers: [
          {
            server: {
              name: 'com.example/second',
              title: 'Second Entry',
              version: '1.0.0',
              remotes: [{ type: 'streamable-http', url: 'https://example.com/second/mcp' }],
            },
            _meta: {
              'io.modelcontextprotocol.registry/official': { status: 'active', isLatest: true },
            },
          },
          {
            server: {
              name: 'com.example/sse-only',
              title: 'SSE Only',
              version: '1.0.0',
              remotes: [{ type: 'sse', url: 'https://example.com/sse' }],
            },
            _meta: {
              'io.modelcontextprotocol.registry/official': { status: 'active', isLatest: true },
            },
          },
          {
            server: {
              name: 'com.example/first',
              title: 'First Entry',
              version: '1.0.0',
              remotes: [{ type: 'streamable-http', url: 'https://example.com/first/mcp' }],
            },
            _meta: {
              'io.modelcontextprotocol.registry/official': { status: 'active', isLatest: true },
            },
          },
        ],
        metadata: { nextCursor: null },
      }),
    });

    global.fetch = fetchMock as any;

    const result = await listOfficialMcpRegistry({ limit: 20 });

    expect(result.entries.map((entry) => entry.name)).toEqual(['Second Entry', 'First Entry']);

    if (originalEventSource) {
      (global as any).EventSource = originalEventSource;
    }
  });

  it('paginates, de-duplicates entries, and respects the requested limit', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          servers: [
            {
              server: {
                name: 'com.example/alpha',
                title: 'Alpha',
                version: '1.0.0',
                remotes: [{ type: 'streamable-http', url: 'https://example.com/alpha/mcp' }],
              },
              _meta: {
                'io.modelcontextprotocol.registry/official': { status: 'active', isLatest: true },
              },
            },
          ],
          metadata: { nextCursor: 'cursor-2' },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          servers: [
            {
              server: {
                name: 'com.example/alpha',
                title: 'Alpha',
                version: '1.0.0',
                remotes: [{ type: 'streamable-http', url: 'https://example.com/alpha/mcp' }],
              },
              _meta: {
                'io.modelcontextprotocol.registry/official': { status: 'active', isLatest: true },
              },
            },
            {
              server: {
                name: 'com.example/beta',
                title: 'Beta',
                version: '1.0.0',
                remotes: [{ type: 'streamable-http', url: 'https://example.com/beta/mcp' }],
              },
              _meta: {
                'io.modelcontextprotocol.registry/official': { status: 'active', isLatest: true },
              },
            },
          ],
          metadata: { nextCursor: 'cursor-3' },
        }),
      });

    global.fetch = fetchMock as any;

    const result = await listOfficialMcpRegistry({ limit: 2 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.entries.map((entry) => entry.name)).toEqual(['Alpha', 'Beta']);
    expect(result.nextCursor).toBe('cursor-3');
  });

  it('stops after the first registry page when a search query is provided', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        servers: [
          {
            server: {
              name: 'com.example/search-hit',
              title: 'Search Hit',
              version: '1.0.0',
              remotes: [{ type: 'streamable-http', url: 'https://example.com/search/mcp' }],
            },
            _meta: {
              'io.modelcontextprotocol.registry/official': { status: 'active', isLatest: true },
            },
          },
        ],
        metadata: { nextCursor: 'cursor-next' },
      }),
    });

    global.fetch = fetchMock as any;

    const result = await listOfficialMcpRegistry({ limit: 20, search: 'search hit' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.entries).toHaveLength(1);
    expect(result.nextCursor).toBe('cursor-next');
  });

  it('returns an empty result when the registry request fails', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as any;

    await expect(listOfficialMcpRegistry({ limit: 10 })).resolves.toEqual({
      entries: [],
      nextCursor: null,
    });
  });

  it('maps fallback names and website_url aliases from registry entries', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        servers: [
          {
            server: {
              name: 'com.example/minimal-entry',
              description: 'Fallback label entry',
              version: '2.0.0',
              website_url: 'https://example.com/docs',
              remotes: [{ type: 'streamable-http', url: 'https://example.com/mcp' }],
            },
            _meta: {
              'io.modelcontextprotocol.registry/official': { status: 'active', isLatest: true },
            },
          },
        ],
        metadata: { nextCursor: null },
      }),
    });

    global.fetch = fetchMock as any;

    const result = await listOfficialMcpRegistry({ limit: 10 });

    expect(result.entries[0]).toEqual(
      expect.objectContaining({
        name: 'minimal-entry',
        websiteUrl: 'https://example.com/docs',
        trust: expect.objectContaining({ websiteUrl: 'https://example.com/docs' }),
      }),
    );
    expect(result.entries[0].remotes[0].label).toBe('HTTP mcp');
  });

  it('builds an MCP config from defaults without persisting empty headers', () => {
    const draft = buildMcpInstallDraft(
      {
        id: 'com.example/defaults@1.0.0',
        name: 'Defaults',
        registryName: 'com.example/defaults',
        description: 'Defaulted inputs',
        version: '1.0.0',
        trust: {
          source: 'official-registry',
          registryName: 'com.example/defaults',
          websiteUrl: undefined,
        },
        capabilities: {
          transports: ['streamable-http'],
          authMode: 'variable',
          requiresConfiguration: true,
          requiresSecrets: false,
          inputCount: 1,
        },
        remotes: [],
      },
      {
        id: 'remote-defaults',
        type: 'streamable-http',
        url: 'https://api.example.com/{region}/mcp',
        label: 'HTTP defaults',
        variables: [
          {
            key: 'region',
            label: 'region',
            kind: 'variable',
            required: true,
            secret: false,
            defaultValue: 'us-east-1',
          },
        ],
        headers: [],
      },
      {},
    );

    expect(draft.resolvedUrl).toBe('https://api.example.com/us-east-1/mcp');
    expect(draft.config.headers).toBeUndefined();
    expect(draft.config.capabilities).toEqual({
      transport: 'streamable-http',
      authMode: 'variable',
      requiresConfiguration: true,
      requiresSecrets: false,
      inputCount: 1,
    });
  });

  it('throws when a required install header is missing', () => {
    expect(() =>
      buildMcpInstallDraft(
        {
          id: 'com.example/required@1.0.0',
          name: 'Required Header',
          registryName: 'com.example/required',
          description: 'Header validation',
          version: '1.0.0',
          trust: {
            source: 'official-registry',
            registryName: 'com.example/required',
            websiteUrl: undefined,
          },
          capabilities: {
            transports: ['streamable-http'],
            authMode: 'header',
            requiresConfiguration: true,
            requiresSecrets: true,
            inputCount: 1,
          },
          remotes: [],
        },
        {
          id: 'remote-required',
          type: 'streamable-http',
          url: 'https://api.example.com/mcp',
          label: 'HTTP required',
          variables: [],
          headers: [
            {
              key: 'Authorization',
              label: 'Authorization',
              kind: 'header',
              required: true,
              secret: true,
            },
          ],
        },
        {},
      ),
    ).toThrow('Missing required header: Authorization');
  });

  it('throws when building an SSE draft without SSE transport support', () => {
    const originalEventSource = (global as any).EventSource;
    delete (global as any).EventSource;

    expect(() =>
      buildMcpInstallDraft(
        {
          id: 'com.example/sse@1.0.0',
          name: 'SSE Entry',
          registryName: 'com.example/sse',
          description: 'SSE only',
          version: '1.0.0',
          trust: {
            source: 'official-registry',
            registryName: 'com.example/sse',
            websiteUrl: undefined,
          },
          capabilities: {
            transports: ['sse'],
            authMode: 'none',
            requiresConfiguration: false,
            requiresSecrets: false,
            inputCount: 0,
          },
          remotes: [],
        },
        {
          id: 'remote-sse',
          type: 'sse',
          url: 'https://example.com/sse',
          label: 'SSE 1',
          variables: [],
          headers: [],
        },
        {},
      ),
    ).toThrow('SSE transport is not available in this runtime. Choose an HTTP remote instead.');

    if (originalEventSource) {
      (global as any).EventSource = originalEventSource;
    }
  });
});
