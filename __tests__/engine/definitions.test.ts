// ---------------------------------------------------------------------------
// Tests — Tool Definitions
// ---------------------------------------------------------------------------

import { TOOL_DEFINITIONS } from '../../src/engine/tools/definitions';

describe('TOOL_DEFINITIONS', () => {
  it('should define expected tools', () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    expect(names).toContain('read_file');
    expect(names).toContain('write_file');
    expect(names).toContain('list_files');
    expect(names).toContain('javascript');
    expect(names).toContain('python');
    expect(names).not.toContain('fetch_url');
    expect(names).not.toContain('update_memory');
    expect(names).not.toContain('read_memory');
    expect(names).not.toContain('create_task');
  });

  it('should have at least 7 tools', () => {
    expect(TOOL_DEFINITIONS.length).toBeGreaterThanOrEqual(7);
  });

  it('each tool should have name, description, and input_schema', () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.input_schema).toBeDefined();
      expect(tool.input_schema.type).toBe('object');
      expect(tool.input_schema.properties).toBeDefined();
    }
  });

  it('read_file should require path param', () => {
    const readFile = TOOL_DEFINITIONS.find((t) => t.name === 'read_file')!;
    expect(readFile.input_schema.required).toContain('path');
    expect(readFile.input_schema.properties.path).toBeDefined();
  });

  it('write_file should require path and content', () => {
    const writeFile = TOOL_DEFINITIONS.find((t) => t.name === 'write_file')!;
    expect(writeFile.input_schema.required).toContain('path');
    expect(writeFile.input_schema.required).toContain('content');
  });

  it('javascript should require either inline code or a workspace path', () => {
    const js = TOOL_DEFINITIONS.find((t) => t.name === 'javascript')!;
    expect(js.input_schema.required || []).not.toContain('code');
    expect(js.input_schema.properties.code.type).toBe('string');
    expect(js.input_schema.properties.path.type).toBe('string');
    expect(js.input_schema.oneOf).toEqual([{ required: ['code'] }, { required: ['path'] }]);
  });

  it('python should support either code or path and expose script arguments', () => {
    const python = TOOL_DEFINITIONS.find((t) => t.name === 'python')!;
    expect(python.input_schema.required || []).not.toContain('code');
    expect(python.input_schema.properties.code.type).toBe('string');
    expect(python.input_schema.properties.path.type).toBe('string');
    expect(python.input_schema.properties.argv.type).toBe('array');
    expect(python.input_schema.properties.packages.type).toBe('array');
    expect(python.input_schema.properties.indexUrls.type).toBe('array');
    expect(python.input_schema.properties.env.type).toBe('object');
    expect(python.input_schema.properties.timeoutMs.type).toBe('number');
    expect(python.input_schema.oneOf).toEqual([{ required: ['code'] }, { required: ['path'] }]);
  });

  it('python tool description advertises async native HTTP instead of requests-based remote fetch', () => {
    const python = TOOL_DEFINITIONS.find((t) => t.name === 'python')!;
    expect(python.description).toContain('capability-extension tool');
    expect(python.description).toContain('DOCX/XLSX/HTML/SVG/CSV');
    expect(python.description).toContain('built-in tool surface');
    expect(python.description).toContain('Top-level `await` is supported');
    expect(python.description).toContain('kavi.http');
    expect(python.description).toContain('get_json');
    expect(python.description).toContain('timeout=30');
    expect(python.description).toContain('pyfetch');
    expect(python.description).not.toContain('workflow evidence');
    expect(python.description).not.toContain('read_workflow_evidence');
    expect(python.description).not.toContain('requests via micropip');
  });

  it('tool_catalog description exposes structural search and category browse', () => {
    const toolCatalog = TOOL_DEFINITIONS.find((t) => t.name === 'tool_catalog')!;
    expect(toolCatalog.description).toContain('query and/or capabilities');
    expect(toolCatalog.description).toContain('empty overview call');
    expect(toolCatalog.input_schema.properties.query).toBeDefined();
    expect(toolCatalog.input_schema.properties.capabilities).toBeDefined();
  });

  it('sessions_spawn exposes a compact delegated worker contract', () => {
    const sessionsSpawn = TOOL_DEFINITIONS.find((t) => t.name === 'sessions_spawn')!;
    expect(sessionsSpawn.input_schema.properties.prompt.description).toContain(
      'Self-contained task instructions',
    );
    expect(sessionsSpawn.input_schema.properties.name.type).toBe('string');
    expect(sessionsSpawn.input_schema.properties.tools.type).toBe('array');
    expect(sessionsSpawn.input_schema.properties.waitForCompletion.type).toBe('boolean');
    expect(sessionsSpawn.input_schema.properties.objective).toBeUndefined();
    expect(sessionsSpawn.input_schema.properties.systemPrompt).toBeUndefined();
  });

  it('agents is persona management, not delegated worker coordination', () => {
    const agents = TOOL_DEFINITIONS.find((t) => t.name === 'agents')!;
    expect(agents.description).toContain('does not delegate work');
    expect(agents.contract?.capabilities).not.toContain('coordinate');
    expect(agents.contract?.capabilities).toContain('discover');
  });

  it('list_files should not require path (optional)', () => {
    const listFiles = TOOL_DEFINITIONS.find((t) => t.name === 'list_files')!;
    expect(listFiles.input_schema.required || []).not.toContain('path');
  });
});
