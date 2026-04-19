// ---------------------------------------------------------------------------
// Tests — Terminal ANSI utilities
// ---------------------------------------------------------------------------

import {
  stripAnsi,
  splitGraphemes,
  sanitizeForLog,
  visibleWidth,
} from '../../../src/services/terminal/ansi';

describe('stripAnsi', () => {
  it('returns empty string for empty input', () => {
    expect(stripAnsi('')).toBe('');
  });

  it('returns plain text unchanged', () => {
    expect(stripAnsi('hello world')).toBe('hello world');
  });

  it('strips SGR bold/reset codes', () => {
    expect(stripAnsi('\x1b[1mBold\x1b[0m')).toBe('Bold');
  });

  it('strips SGR colour codes', () => {
    expect(stripAnsi('\x1b[31mRed\x1b[39m text')).toBe('Red text');
  });

  it('strips chained SGR codes', () => {
    expect(stripAnsi('\x1b[1;32;40mStyled\x1b[0m')).toBe('Styled');
  });

  it('strips OSC-8 hyperlinks', () => {
    const hyperlink = '\x1b]8;;https://example.com\x1b\\Click\x1b]8;;\x1b\\';
    expect(stripAnsi(hyperlink)).toBe('Click');
  });

  it('strips multiple sequences in mixed text', () => {
    const input = '\x1b[1mHello\x1b[0m \x1b[34mworld\x1b[0m!';
    expect(stripAnsi(input)).toBe('Hello world!');
  });
});

describe('splitGraphemes', () => {
  it('returns empty array for empty string', () => {
    expect(splitGraphemes('')).toEqual([]);
  });

  it('splits ASCII into individual characters', () => {
    expect(splitGraphemes('abc')).toEqual(['a', 'b', 'c']);
  });

  it('handles multi-byte characters', () => {
    const result = splitGraphemes('café');
    expect(result.length).toBe(4);
    expect(result).toEqual(['c', 'a', 'f', 'é']);
  });

  it('handles CJK characters', () => {
    const result = splitGraphemes('中文');
    expect(result).toEqual(['中', '文']);
  });

  it('handles emoji correctly', () => {
    const result = splitGraphemes('👍');
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0]).toContain('👍');
  });
});

describe('sanitizeForLog', () => {
  it('returns empty string for empty input', () => {
    expect(sanitizeForLog('')).toBe('');
  });

  it('strips ANSI and control characters', () => {
    expect(sanitizeForLog('\x1b[31mRed\x1b[0m\x00\x01')).toBe('Red');
  });

  it('strips tab and newline characters', () => {
    const input = 'line1\tdata\nline2';
    const result = sanitizeForLog(input);
    expect(result).not.toContain('\t');
    expect(result).not.toContain('\n');
  });

  it('preserves printable text', () => {
    expect(sanitizeForLog('Hello World 123!')).toBe('Hello World 123!');
  });

  it('strips DEL character (0x7f)', () => {
    expect(sanitizeForLog('a\x7fb')).toBe('ab');
  });
});

describe('visibleWidth', () => {
  it('returns 0 for empty string', () => {
    expect(visibleWidth('')).toBe(0);
  });

  it('measures ASCII text correctly', () => {
    expect(visibleWidth('hello')).toBe(5);
  });

  it('ignores ANSI sequences in measurement', () => {
    expect(visibleWidth('\x1b[31mRed\x1b[0m')).toBe(3);
  });

  it('counts CJK characters as width 2', () => {
    expect(visibleWidth('中文')).toBe(4);
  });

  it('counts emoji as width 2', () => {
    expect(visibleWidth('👍')).toBe(2);
  });

  it('counts mixed ASCII and CJK correctly', () => {
    // 'Hi' = 2, '中' = 2
    expect(visibleWidth('Hi中')).toBe(4);
  });

  it('handles combining marks correctly', () => {
    // 'e' + combining acute (U+0301) should render as width 1
    const withCombining = 'e\u0301';
    expect(visibleWidth(withCombining)).toBe(1);
  });

  it('handles OSC-8 hyperlinks correctly', () => {
    const hyperlink = '\x1b]8;;https://example.com\x1b\\Link\x1b]8;;\x1b\\';
    expect(visibleWidth(hyperlink)).toBe(4);
  });

  it('handles complex mixed content', () => {
    // ANSI + emoji + ASCII
    const input = '\x1b[1m👋Hello\x1b[0m';
    // 👋 = 2, Hello = 5 → 7
    expect(visibleWidth(input)).toBe(7);
  });
});
