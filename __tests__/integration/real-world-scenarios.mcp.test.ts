import '../helpers/realWorldIntegrationHarness';
import {
  listOfficialMcpRegistry,
  buildMcpInstallDraft,
  type McpHubEntry,
} from '../../src/services/mcp/registryClient';
import {
  mcpToolToDefinition,
  parseMcpToolName,
  formatMcpResult,
  executeMcpTool,
} from '../../src/services/mcp/bridge';

describe('Real MCP Registry integration', () => {
  let fetchedEntries: McpHubEntry[] = [];

  beforeAll(async () => {
    try {
      const result = await listOfficialMcpRegistry({ limit: 10, search: 'github' });
      fetchedEntries = result.entries;
    } catch {
      // CI may not have network access; structure assertions run when data is available.
    }
  }, 30000);

  it('fetches real MCP servers from the registry', () => {
    if (fetchedEntries.length === 0) {
      return;
    }

    expect(fetchedEntries.length).toBeGreaterThan(0);
  });

  it('all entries have required fields', () => {
    for (const entry of fetchedEntries) {
      expect(entry.id).toBeTruthy();
      expect(entry.name).toBeTruthy();
      expect(entry.registryName).toBeTruthy();
      expect(entry.description).toBeDefined();
      expect(entry.version).toBeTruthy();
      expect(entry.remotes.length).toBeGreaterThan(0);
      expect(entry.trust).toBeDefined();
      expect(entry.trust.source).toBe('official-registry');
      expect(entry.capabilities).toBeDefined();
      expect(entry.capabilities.transports.length).toBeGreaterThan(0);
    }
  });

  it('remote entries have valid structure', () => {
    for (const entry of fetchedEntries) {
      for (const remote of entry.remotes) {
        expect(remote.id).toBeTruthy();
        expect(['streamable-http', 'sse']).toContain(remote.type);
        expect(remote.url).toBeTruthy();
        // URL should be a valid URL
        expect(() => new URL(remote.url)).not.toThrow();
        expect(remote.label).toBeTruthy();
        expect(Array.isArray(remote.headers)).toBe(true);
        expect(Array.isArray(remote.variables)).toBe(true);
      }
    }
  });

  it('creates valid install drafts from fetched entries', () => {
    for (const entry of fetchedEntries) {
      for (const remote of entry.remotes) {
        // Build a values map with defaults for required inputs
        const values: Record<string, string> = {};
        for (const header of remote.headers) {
          if (header.required) values[header.key] = header.defaultValue || 'test-value';
        }
        for (const variable of remote.variables) {
          if (variable.required) values[variable.key] = variable.defaultValue || 'test-value';
        }

        const draft = buildMcpInstallDraft(entry, remote, values);
        const expectedName =
          entry.remotes.length > 1 ? `${entry.name} (${remote.label})` : entry.name;
        expect(draft.config).toBeDefined();
        expect(draft.config.id).toBeTruthy();
        expect(draft.config.name).toBe(expectedName);
        expect(draft.config.url).toBeTruthy();
        expect(draft.resolvedUrl).toBeTruthy();
        // Resolved URL should be a valid URL
        expect(() => new URL(draft.resolvedUrl)).not.toThrow();
      }
    }
  });

  it('entry capabilities match actual remote data', () => {
    for (const entry of fetchedEntries) {
      const transports = Array.from(new Set(entry.remotes.map((r) => r.type)));
      for (const transport of transports) {
        expect(entry.capabilities.transports).toContain(transport);
      }

      const hasInputs = entry.remotes.some((r) => r.headers.length > 0 || r.variables.length > 0);
      expect(entry.capabilities.requiresConfiguration).toBe(hasInputs);

      if (entry.capabilities.requiresSecrets) {
        const hasSecretInput = entry.remotes.some(
          (r) => r.headers.some((h) => h.secret) || r.variables.some((v) => v.secret),
        );
        expect(hasSecretInput).toBe(true);
      }
    }
  });

  it('converts fetched entries to MCP tool definitions', () => {
    for (const entry of fetchedEntries) {
      // Simulate MCP tools that would come from these servers
      const mockTool = {
        name: 'get_issues',
        description: 'Get issues from GitHub',
        inputSchema: {
          type: 'object',
          properties: { repo: { type: 'string' }, state: { type: 'string' } },
          required: ['repo'],
        },
      };

      const def = mcpToolToDefinition({
        serverId: entry.registryName,
        serverName: entry.name,
        tool: mockTool,
      });

      expect(def.name).toBe(`mcp__${entry.registryName}__get_issues`);
      expect(def.description).toContain(entry.name);
      expect(def.input_schema.properties).toBeDefined();
      expect(def.input_schema.required).toEqual(['repo']);

      // Verify round-trip name parsing
      const parsed = parseMcpToolName(def.name);
      expect(parsed).not.toBeNull();
      expect(parsed!.serverId).toBe(entry.registryName);
      expect(parsed!.toolName).toBe('get_issues');
    }
  });

  it('handles MCP bridge result formatting', () => {
    const textResult = {
      content: [{ type: 'text' as const, text: 'Hello from MCP' }],
      isError: false,
    };
    expect(formatMcpResult(textResult)).toBe('Hello from MCP');

    const errorResult = { content: [{ type: 'text' as const, text: 'Not found' }], isError: true };
    expect(formatMcpResult(errorResult)).toBe('Error: Not found');

    const imageResult = {
      content: [{ type: 'image' as const, mimeType: 'image/png', data: '' }],
      isError: false,
    };
    expect(formatMcpResult(imageResult)).toBe('[Image: image/png]');

    const resourceResult = {
      content: [
        { type: 'resource' as const, resource: { uri: 'file:///test.txt', text: 'File content' } },
      ],
      isError: false,
    };
    expect(formatMcpResult(resourceResult)).toBe('File content');

    const multiResult = {
      content: [
        { type: 'text' as const, text: 'Part 1' },
        { type: 'text' as const, text: 'Part 2' },
        { type: 'image' as const, mimeType: 'image/jpeg', data: '' },
      ],
      isError: false,
    };
    expect(formatMcpResult(multiResult)).toBe('Part 1\n\nPart 2\n\n[Image: image/jpeg]');
  });

  it('handles MCP tool execution with disconnected server', async () => {
    const clients = new Map();
    const result = await executeMcpTool(clients, 'mcp__test-server__my_tool', '{}');
    expect(result).toContain('Error');
    expect(result).toContain('not connected');
  });
});

describe('End-to-end MCP flow with real fetched data', () => {
  let realEntry: McpHubEntry | null = null;

  beforeAll(async () => {
    try {
      const result = await listOfficialMcpRegistry({ limit: 5 });
      if (result.entries.length > 0) {
        realEntry = result.entries[0];
      }
    } catch {
      // CI may not have network access.
    }
  }, 30000);

  it('full lifecycle: fetch → draft → config → definition → parse', async () => {
    if (!realEntry) return; // Skip if network unavailable

    // 1. Build install draft
    const remote = realEntry.remotes[0];
    const values: Record<string, string> = {};
    for (const h of remote.headers) {
      if (h.required) values[h.key] = h.defaultValue || 'placeholder';
    }
    for (const v of remote.variables) {
      if (v.required) values[v.key] = v.defaultValue || 'placeholder';
    }

    const draft = buildMcpInstallDraft(realEntry, remote, values);
    const expectedName =
      realEntry.remotes.length > 1 ? `${realEntry.name} (${remote.label})` : realEntry.name;

    // 2. Config is valid
    expect(draft.config.id).toBeTruthy();
    expect(draft.config.name).toBe(expectedName);
    expect(draft.config.url).toBeTruthy();

    // 3. Create a tool definition from this server
    const toolDef = mcpToolToDefinition({
      serverId: draft.config.id,
      serverName: draft.config.name,
      tool: {
        name: 'test_action',
        description: 'A test tool action',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
      },
    });

    // 4. Parse the tool name back
    const parsed = parseMcpToolName(toolDef.name);
    expect(parsed).not.toBeNull();
    expect(parsed!.serverId).toBe(draft.config.id);
    expect(parsed!.toolName).toBe('test_action');

    // 5. Try to execute against no connected server and confirm graceful failure.
    const clients = new Map();
    const result = await executeMcpTool(clients, toolDef.name, '{"query":"test"}');
    expect(result).toContain('Error');
    expect(result).toContain('not connected');
  });
});
