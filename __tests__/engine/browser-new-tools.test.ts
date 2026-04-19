// ---------------------------------------------------------------------------
// Tests — New Browser Tool Definitions & Wiring
// ---------------------------------------------------------------------------

import {
  BROWSER_UPLOAD_TOOL,
  BROWSER_DOWNLOAD_TOOL,
  BROWSER_PDF_TOOL,
  BROWSER_FILL_FORM_TOOL,
  BROWSER_DIALOG_TOOL,
  ALL_BROWSER_TOOL_DEFINITIONS,
} from '../../src/engine/tools/browser-definitions';

describe('New browser tool definitions', () => {
  it.each([
    ['browser_upload', BROWSER_UPLOAD_TOOL],
    ['browser_download', BROWSER_DOWNLOAD_TOOL],
    ['browser_pdf', BROWSER_PDF_TOOL],
    ['browser_fill_form', BROWSER_FILL_FORM_TOOL],
    ['browser_dialog', BROWSER_DIALOG_TOOL],
  ])('%s has valid definition shape', (name, tool) => {
    expect(tool.name).toBe(name);
    expect(tool.description).toBeTruthy();
    expect(tool.input_schema).toBeDefined();
    expect(tool.input_schema.type).toBe('object');
    expect(tool.input_schema.properties).toBeDefined();
  });

  it('upload requires sessionId, ref, filePath', () => {
    expect(BROWSER_UPLOAD_TOOL.input_schema.required).toEqual(
      expect.arrayContaining(['sessionId', 'ref', 'filePath']),
    );
  });

  it('download requires sessionId', () => {
    expect(BROWSER_DOWNLOAD_TOOL.input_schema.required).toEqual(
      expect.arrayContaining(['sessionId']),
    );
    // optional fields should exist
    expect(BROWSER_DOWNLOAD_TOOL.input_schema.properties).toHaveProperty('url');
    expect(BROWSER_DOWNLOAD_TOOL.input_schema.properties).toHaveProperty('waitMs');
  });

  it('pdf requires sessionId and has format options', () => {
    expect(BROWSER_PDF_TOOL.input_schema.required).toEqual(expect.arrayContaining(['sessionId']));
    expect(BROWSER_PDF_TOOL.input_schema.properties).toHaveProperty('format');
    expect(BROWSER_PDF_TOOL.input_schema.properties).toHaveProperty('landscape');
    expect(BROWSER_PDF_TOOL.input_schema.properties).toHaveProperty('scale');
  });

  it('fill_form requires sessionId and fields', () => {
    expect(BROWSER_FILL_FORM_TOOL.input_schema.required).toEqual(
      expect.arrayContaining(['sessionId', 'fields']),
    );
    const fields = BROWSER_FILL_FORM_TOOL.input_schema.properties.fields;
    expect(fields.type).toBe('array');
    expect(fields.items).toBeDefined();
  });

  it('dialog requires sessionId and action', () => {
    expect(BROWSER_DIALOG_TOOL.input_schema.required).toEqual(
      expect.arrayContaining(['sessionId', 'action']),
    );
    expect(BROWSER_DIALOG_TOOL.input_schema.properties.action.enum).toEqual(['accept', 'dismiss']);
  });

  it('ALL_BROWSER_TOOL_DEFINITIONS includes all 5 new tools', () => {
    const names = ALL_BROWSER_TOOL_DEFINITIONS.map((t) => t.name);
    expect(names).toContain('browser_upload');
    expect(names).toContain('browser_download');
    expect(names).toContain('browser_pdf');
    expect(names).toContain('browser_fill_form');
    expect(names).toContain('browser_dialog');
  });

  it('no duplicate tool names in ALL_BROWSER_TOOL_DEFINITIONS', () => {
    const names = ALL_BROWSER_TOOL_DEFINITIONS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
