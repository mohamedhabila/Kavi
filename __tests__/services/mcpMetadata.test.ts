import {
  inferMcpServerAuthMode,
  normalizeMcpServerConfigMetadata,
  summarizeMcpServerCapabilities,
} from '../../src/services/mcp/metadata';

describe('mcp metadata', () => {
  it('infers manual header auth from token and headers', () => {
    expect(
      inferMcpServerAuthMode({
        token: 'secret',
        headers: { Authorization: 'Bearer token' },
      } as any),
    ).toBe('header');
  });

  it('summarizes manual servers with normalized trust and transport metadata', () => {
    const normalized = normalizeMcpServerConfigMetadata({
      id: 'server-1',
      name: 'Manual MCP',
      url: 'https://manual.example.com/mcp',
      transport: 'streamable-http',
      enabled: true,
      tools: [],
      allowedTools: [],
    });

    expect(normalized.trust).toEqual({ source: 'manual' });
    expect(normalized.capabilities).toEqual({
      transport: 'streamable-http',
      authMode: 'none',
      requiresConfiguration: false,
      requiresSecrets: false,
      inputCount: 0,
    });
  });

  it('preserves explicit registry capabilities when already present', () => {
    const capabilities = summarizeMcpServerCapabilities({
      id: 'server-2',
      name: 'Registry MCP',
      url: 'https://registry.example.com/mcp',
      enabled: true,
      tools: [],
      allowedTools: [],
      capabilities: {
        transport: 'sse',
        authMode: 'oauth',
        requiresConfiguration: true,
        requiresSecrets: true,
        inputCount: 2,
      },
    });

    expect(capabilities).toEqual({
      transport: 'sse',
      authMode: 'oauth',
      requiresConfiguration: true,
      requiresSecrets: true,
      inputCount: 2,
    });
  });
});
