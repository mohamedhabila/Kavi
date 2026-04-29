import { normalizeToolName } from '../../src/engine/tools/toolNameNormalization';

describe('normalizeToolName', () => {
  it('keeps canonical tool names unchanged', () => {
    expect(normalizeToolName('read_file')).toBe('read_file');
    expect(normalizeToolName('sessions_status')).toBe('sessions_status');
    expect(normalizeToolName('sessions_output')).toBe('sessions_output');
    expect(normalizeToolName('sessions_wait')).toBe('sessions_wait');
  });

  it('normalizes camel and pascal case tool names', () => {
    expect(normalizeToolName('ReadFile')).toBe('read_file');
    expect(normalizeToolName('browserPressKey')).toBe('browser_press_key');
  });

  it('normalizes separator variants and common prefixes', () => {
    expect(normalizeToolName('read-file')).toBe('read_file');
    expect(normalizeToolName('functions.ReadFile')).toBe('read_file');
    expect(normalizeToolName('tools.read-file')).toBe('read_file');
  });

  it('preserves existing alias resolution', () => {
    expect(normalizeToolName('search_web')).toBe('web_search');
    expect(normalizeToolName('record_evidence')).toBe('record_workflow_evidence');
    expect(normalizeToolName('workflow_evidence_read')).toBe('read_workflow_evidence');
    expect(normalizeToolName('send_email')).toBe('email_compose');
    expect(normalizeToolName('open_maps')).toBe('maps_open');
    expect(normalizeToolName('contacts_access_picker')).toBe('contacts_manage_access');
    expect(normalizeToolName('edit_image')).toBe('image_edit');
    expect(normalizeToolName('modify_image')).toBe('image_edit');
  });

  it('leaves unknown tools unchanged after trimming', () => {
    expect(normalizeToolName('  custom_tool  ')).toBe('custom_tool');
  });
});
