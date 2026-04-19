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
    expect(names).toContain('fetch_url');
    expect(names).toContain('update_memory');
    expect(names).toContain('create_task');
    expect(names).toContain('javascript');
    expect(names).toContain('python');
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

  it('fetch_url should require url param', () => {
    const fetchUrl = TOOL_DEFINITIONS.find((t) => t.name === 'fetch_url')!;
    expect(fetchUrl.input_schema.required).toContain('url');
    expect(fetchUrl.input_schema.properties.headers.additionalProperties.type).toBe('string');
  });

  it('update_memory should require content', () => {
    const updateMemory = TOOL_DEFINITIONS.find((t) => t.name === 'update_memory')!;
    expect(updateMemory.input_schema.required).toContain('content');
  });

  it('create_task should require schedule and prompt', () => {
    const createTask = TOOL_DEFINITIONS.find((t) => t.name === 'create_task')!;
    expect(createTask.input_schema.required).toContain('schedule');
    expect(createTask.input_schema.required).toContain('prompt');
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
    expect(python.description).not.toContain('requests via micropip');
  });

  it('tool_catalog description points models to python-backed capability bridging', () => {
    const toolCatalog = TOOL_DEFINITIONS.find((t) => t.name === 'tool_catalog')!;
    expect(toolCatalog.description).toContain(
      'Python-backed export, conversion, or custom generation',
    );
  });

  it('list_files should not require path (optional)', () => {
    const listFiles = TOOL_DEFINITIONS.find((t) => t.name === 'list_files')!;
    expect(listFiles.input_schema.required || []).not.toContain('path');
  });
});
