// ---------------------------------------------------------------------------
// Tests — Terminal Safe Text
// ---------------------------------------------------------------------------

import { sanitizeTerminalText } from '../../../src/services/terminal/safeText';

describe('sanitizeTerminalText', () => {
  it('returns empty string for empty input', () => {
    expect(sanitizeTerminalText('')).toBe('');
  });

  it('returns plain text unchanged', () => {
    expect(sanitizeTerminalText('Hello World')).toBe('Hello World');
  });

  it('escapes carriage return', () => {
    expect(sanitizeTerminalText('line\rone')).toBe('line\\rone');
  });

  it('escapes newline', () => {
    expect(sanitizeTerminalText('line\none')).toBe('line\\none');
  });

  it('escapes tab', () => {
    expect(sanitizeTerminalText('col1\tcol2')).toBe('col1\\tcol2');
  });

  it('escapes all three in combination', () => {
    expect(sanitizeTerminalText('a\rb\nc\td')).toBe('a\\rb\\nc\\td');
  });

  it('strips ANSI escape sequences', () => {
    expect(sanitizeTerminalText('\x1b[31mRed\x1b[0m')).toBe('Red');
  });

  it('strips C0 control characters (0x00-0x1f) except escaped \\r\\n\\t', () => {
    // \x01 (SOH), \x02 (STX) should be stripped
    expect(sanitizeTerminalText('a\x01b\x02c')).toBe('abc');
  });

  it('strips C1 control characters (0x7f-0x9f)', () => {
    expect(sanitizeTerminalText('a\x7fb')).toBe('ab');
    expect(sanitizeTerminalText('a\x80b')).toBe('ab');
    expect(sanitizeTerminalText('a\x9fb')).toBe('ab');
  });

  it('preserves printable Unicode including CJK', () => {
    expect(sanitizeTerminalText('Hello 中文 世界')).toBe('Hello 中文 世界');
  });

  it('prevents CWE-117 terminal injection by stripping ANSI', () => {
    // Attacker tries to fake a log line via terminal escapes
    const malicious = '\x1b[2K\x1b[1A\x1b[31m[CRITICAL] Fake alert\x1b[0m';
    const result = sanitizeTerminalText(malicious);
    expect(result).not.toContain('\x1b');
    expect(result).toContain('Fake alert');
  });

  it('handles complex mixed malicious input', () => {
    const input = 'Normal\x1b[31m\r\nInjected\x00\x01\x1b[0m end';
    const result = sanitizeTerminalText(input);
    expect(result).not.toContain('\x1b');
    expect(result).not.toContain('\x00');
    expect(result).not.toContain('\x01');
    expect(result).toContain('Normal');
    expect(result).toContain('Injected');
    expect(result).toContain('end');
  });
});
