import {
  isRegisteredToolName,
  normalizeToolName,
  normalizeToolNameList,
  resolveRegisteredToolName,
} from '../../src/engine/tools/toolNameNormalization';

describe('toolNameNormalization', () => {
  it('normalizeToolName trims whitespace', () => {
    expect(normalizeToolName('  calendar_list  ')).toBe('calendar_list');
    expect(normalizeToolName('  ReadFile  ')).toBe('ReadFile');
    expect(normalizeToolName('  search_web  ')).toBe('search_web');
  });

  it('normalizeToolNameList trims, drops empty entries, and deduplicates in order', () => {
    expect(
      normalizeToolNameList(['memory_remember', '', ' write_file ', 'memory_remember']),
    ).toEqual(['memory_remember', 'write_file']);
  });

  it('resolveRegisteredToolName keeps registered builtins', () => {
    expect(resolveRegisteredToolName('calendar_list')).toBe('calendar_list');
    expect(isRegisteredToolName('memory_recall')).toBe(true);
  });

  it('resolveRegisteredToolName maps colon-delimited aliases to registry builtins', () => {
    expect(resolveRegisteredToolName('google_calendar:calendar_list')).toBe('calendar_list');
    expect(resolveRegisteredToolName('provider:memory_recall')).toBe('memory_recall');
  });

  it('resolveRegisteredToolName returns trimmed unknown names unchanged', () => {
    expect(resolveRegisteredToolName('not_a_real_tool')).toBe('not_a_real_tool');
    expect(isRegisteredToolName('not_a_real_tool')).toBe(false);
  });

  it('preserves mcp tool names without false builtin matches', () => {
    const mcpName = 'mcp__docs__search';
    expect(resolveRegisteredToolName(mcpName)).toBe(mcpName);
  });
});
