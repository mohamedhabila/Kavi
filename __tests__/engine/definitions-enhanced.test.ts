// ---------------------------------------------------------------------------
// Tests — Tool Definitions (Enhanced — Extended, Web, Native, buildToolDefinitions)
// ---------------------------------------------------------------------------

import { TOOL_DEFINITIONS, buildToolDefinitions } from '../../src/engine/tools/definitions';

describe('TOOL_DEFINITIONS — full set', () => {
  const names = () => TOOL_DEFINITIONS.map((t) => t.name);

  it('includes core tools', () => {
    const n = names();
    expect(n).toContain('read_file');
    expect(n).toContain('write_file');
    expect(n).toContain('list_files');
    expect(n).toContain('fetch_url');
    expect(n).toContain('update_memory');
    expect(n).toContain('create_task');
    expect(n).toContain('javascript');
    expect(n).toContain('python');
  });

  it('includes extended tools', () => {
    const n = names();
    expect(n).toContain('file_edit');
    expect(n).toContain('glob_search');
    expect(n).toContain('text_search');
    expect(n).toContain('cron');
    expect(n).toContain('notify');
    expect(n).toContain('image_generate');
    expect(n).toContain('image_edit');
  });

  it('includes web tools', () => {
    const n = names();
    expect(n).toContain('web_search');
    expect(n).toContain('web_fetch');
  });

  it('includes native tools', () => {
    const n = names();
    // At least some native tools should be present
    expect(n).toContain('email_compose');
    expect(n).toContain('contacts_pick');
    expect(n).toContain('contacts_manage_access');
    expect(n).toContain('clipboard_read');
    expect(n).toContain('clipboard_write');
    expect(n).toContain('share_text');
    expect(n).toContain('open_url');
  });

  it('has at least 25 tools', () => {
    expect(TOOL_DEFINITIONS.length).toBeGreaterThanOrEqual(25);
  });

  it('all tools have valid shape', () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(typeof tool.name).toBe('string');
      expect(tool.name.length).toBeGreaterThan(0);
      expect(typeof tool.description).toBe('string');
      expect(tool.input_schema).toBeDefined();
      expect(tool.input_schema.type).toBe('object');
    }
  });

  it('no duplicate tool names', () => {
    const n = names();
    const unique = new Set(n);
    expect(unique.size).toBe(n.length);
  });
});

describe('buildToolDefinitions', () => {
  it('returns static tools when no dynamic tools passed', () => {
    const tools = buildToolDefinitions();
    expect(tools.length).toBe(TOOL_DEFINITIONS.length);
  });

  it('merges MCP tools', () => {
    const mcpTool = {
      name: 'mcp__server1__do_thing',
      description: 'MCP tool',
      input_schema: { type: 'object' as const, properties: {} },
    };
    const tools = buildToolDefinitions([mcpTool]);
    expect(tools.length).toBe(TOOL_DEFINITIONS.length + 1);
    expect(tools.find((t) => t.name === 'mcp__server1__do_thing')).toBeDefined();
  });

  it('merges skill tools', () => {
    const skillTool = {
      name: 'skill__myskill__greet',
      description: 'Skill tool',
      input_schema: { type: 'object' as const, properties: {} },
    };
    const tools = buildToolDefinitions([], [skillTool]);
    expect(tools.length).toBe(TOOL_DEFINITIONS.length + 1);
    expect(tools.find((t) => t.name === 'skill__myskill__greet')).toBeDefined();
  });

  it('filters by allowedTools set', () => {
    const allowed = new Set(['read_file', 'write_file']);
    const tools = buildToolDefinitions([], [], allowed);
    expect(tools.length).toBe(2);
    expect(tools.every((t) => allowed.has(t.name))).toBe(true);
  });

  it('allowedTools filter applies to all tool types', () => {
    const mcpTool = {
      name: 'mcp__s__t',
      description: 'MCP',
      input_schema: { type: 'object' as const, properties: {} },
    };
    const allowed = new Set(['read_file', 'mcp__s__t']);
    const tools = buildToolDefinitions([mcpTool], [], allowed);
    expect(tools.length).toBe(2);
  });
});
