// ---------------------------------------------------------------------------
// Tests — Tool choice conversion helpers
// ---------------------------------------------------------------------------

import { resolveForcedToolChoiceFallback } from '../../../../src/services/llm/core/toolChoice';

describe('resolveForcedToolChoiceFallback', () => {
  it('returns undefined for a non-forced choice', () => {
    expect(resolveForcedToolChoiceFallback('auto', [{ name: 'read_file' }])).toBeUndefined();
    expect(resolveForcedToolChoiceFallback(undefined, [{ name: 'read_file' }])).toBeUndefined();
  });

  it('converts an exact tool choice to auto with an instruction naming that tool', () => {
    const fallback = resolveForcedToolChoiceFallback(
      { type: 'tool', name: 'read_file' },
      [{ name: 'read_file' }, { name: 'write_file' }],
    );

    expect(fallback?.toolChoice).toBe('auto');
    expect(fallback?.instruction).toContain('read_file');
    expect(fallback?.instruction.toLowerCase()).toContain('must call');
  });

  it("converts the 'required' string choice to auto, naming every available tool", () => {
    const fallback = resolveForcedToolChoiceFallback('required', [
      { name: 'read_file' },
      { name: 'write_file' },
    ]);

    expect(fallback?.toolChoice).toBe('auto');
    expect(fallback?.instruction).toContain('read_file');
    expect(fallback?.instruction).toContain('write_file');
  });

  it("converts the {type:'required'} object choice to auto the same way", () => {
    const fallback = resolveForcedToolChoiceFallback({ type: 'required' }, [
      { name: 'search' },
    ]);

    expect(fallback?.toolChoice).toBe('auto');
    expect(fallback?.instruction).toContain('search');
  });

  it('falls back to a generic instruction when no tool list is available', () => {
    const fallback = resolveForcedToolChoiceFallback('required', undefined);
    expect(fallback?.toolChoice).toBe('auto');
    expect(fallback?.instruction.length).toBeGreaterThan(0);
  });

  it('trims a whitespace-padded exact tool name in the instruction', () => {
    const fallback = resolveForcedToolChoiceFallback(
      { type: 'tool', name: '  read_file  ' },
      [{ name: 'read_file' }],
    );
    expect(fallback?.instruction).toContain('read_file');
    expect(fallback?.instruction).not.toContain('  read_file  ');
  });
});
