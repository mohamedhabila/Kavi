import '../helpers/realWorldIntegrationHarness';
import { parseMcpToolName, formatMcpResult } from '../../src/services/mcp/bridge';
import { stripAnsi, splitGraphemes, sanitizeForLog } from '../../src/services/terminal/ansi';
import { sanitizeTerminalText } from '../../src/services/terminal/safeText';
import { executeJavaScriptWithResult, buildJavaScriptCandidates } from '../../src/utils/javascript';

describe('Terminal text utilities with real-world input', () => {
  it('strips ANSI SGR sequences', () => {
    const colored = '\x1b[31mERROR\x1b[0m: Something failed';
    expect(stripAnsi(colored)).toBe('ERROR: Something failed');

    const bold = '\x1b[1m\x1b[34mHeading\x1b[0m';
    expect(stripAnsi(bold)).toBe('Heading');

    const mixed = '\x1b[38;5;208mOrange text\x1b[0m and \x1b[48;2;0;255;0mgreen bg\x1b[0m';
    expect(stripAnsi(mixed)).toBe('Orange text and green bg');
  });

  it('strips OSC-8 hyperlinks', () => {
    const link = '\x1b]8;;https://example.com\x1b\\Click here\x1b]8;;\x1b\\';
    expect(stripAnsi(link)).toBe('Click here');
  });

  it('handles plain text without ANSI', () => {
    expect(stripAnsi('Hello world')).toBe('Hello world');
    expect(stripAnsi('')).toBe('');
  });

  it('splitGraphemes handles Unicode correctly', () => {
    expect(splitGraphemes('abc')).toEqual(['a', 'b', 'c']);
    expect(splitGraphemes('')).toEqual([]);
    const emoji = splitGraphemes('👍🏽');
    expect(emoji.length).toBeGreaterThanOrEqual(1);
  });

  it('sanitizeForLog removes control characters', () => {
    const withCtrls = 'Line1\x00\x01\x02\x03Line2';
    const sanitized = sanitizeForLog(withCtrls);
    expect(sanitized).toBe('Line1Line2');
    expect(sanitized).not.toContain('\x00');
    expect(sanitized).not.toContain('\x7f');
  });

  it('sanitizeForLog strips ANSI and controls together', () => {
    const nasty = '\x1b[31m\x00DANGER\x1b[0m\x7f';
    const sanitized = sanitizeForLog(nasty);
    expect(sanitized).toBe('DANGER');
  });

  it('sanitizeTerminalText prevents terminal injection', () => {
    const injection = 'safe\r\nmalicious\tcommand\x1b[2J';
    const safe = sanitizeTerminalText(injection);
    expect(safe).not.toContain('\r');
    expect(safe).not.toContain('\n');
    expect(safe).not.toContain('\t');
    expect(safe).not.toContain('\x1b');
    expect(safe).toContain('safe');
    expect(safe).toContain('malicious');
  });

  it('handles real terminal output scenarios', () => {
    const npmOutput = '\x1b[32m+\x1b[39m express@\x1b[1m4.18.2\x1b[22m\nadded 57 packages in 2s';
    const stripped = stripAnsi(npmOutput);
    expect(stripped).toContain('express@4.18.2');
    expect(stripped).toContain('added 57 packages');

    const gitOutput = '\x1b[31mM  src/index.ts\x1b[m\n\x1b[32m?? \x1b[m new-file.ts';
    const gitStripped = stripAnsi(gitOutput);
    expect(gitStripped).toContain('M  src/index.ts');
    expect(gitStripped).toContain('?? ');
    expect(gitStripped).toContain(' new-file.ts');
  });
});

describe('JavaScript sandbox execution', () => {
  it('evaluates simple expressions', () => {
    expect(executeJavaScriptWithResult('2 + 2')).toBe(4);
    expect(executeJavaScriptWithResult('"hello".toUpperCase()')).toBe('HELLO');
    expect(executeJavaScriptWithResult('Math.max(1,5,3)')).toBe(5);
    expect(executeJavaScriptWithResult('JSON.stringify({a:1})')).toBe('{"a":1}');
  });

  it('evaluates multi-line code', () => {
    const code = `
      const arr = [1, 2, 3, 4, 5];
      arr.filter(x => x > 2).map(x => x * 2);
    `;
    const result = executeJavaScriptWithResult(code);
    expect(result).toEqual([6, 8, 10]);
  });

  it('evaluates code with statements', () => {
    const code = `
      let total = 0;
      for (let i = 1; i <= 10; i++) {
        total += i;
      }
      total
    `;
    expect(executeJavaScriptWithResult(code)).toBe(55);
  });

  it('handles errors gracefully', () => {
    expect(() => executeJavaScriptWithResult('throw new Error("test")')).toThrow('test');
    expect(() => executeJavaScriptWithResult('undefined.property')).toThrow();
  });

  it('handles empty/whitespace code', () => {
    expect(executeJavaScriptWithResult('')).toBeUndefined();
    expect(executeJavaScriptWithResult('   ')).toBeUndefined();
  });

  it('builds correct candidate list', () => {
    const candidates = buildJavaScriptCandidates('1 + 1');
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.some((c) => c.includes('return'))).toBe(true);

    const emptyCandidates = buildJavaScriptCandidates('');
    expect(emptyCandidates.length).toBe(1);
    expect(emptyCandidates[0]).toContain('undefined');
  });

  it('evaluates realistic use cases', () => {
    const csvCode = `
      const csv = "name,age\\nAlice,30\\nBob,25";
      const result = csv.split("\\n").slice(1).map(row => {
        const [name, age] = row.split(",");
        return { name, age: parseInt(age) };
      });
      result
    `;
    const csvResult = executeJavaScriptWithResult(csvCode) as any[];
    expect(csvResult).toHaveLength(2);
    expect(csvResult[0].name).toBe('Alice');
    expect(csvResult[0].age).toBe(30);

    const dateCode = `new Date('2026-03-22').getFullYear()`;
    expect(executeJavaScriptWithResult(dateCode)).toBe(2026);

    const objCode = `
      const items = [{v:3},{v:1},{v:4},{v:1},{v:5}];
      items.sort((a,b) => b.v - a.v).map(i => i.v);
    `;
    expect(executeJavaScriptWithResult(objCode)).toEqual([5, 4, 3, 1, 1]);
  });
});

describe('Additional edge cases', () => {
  it('parseMcpToolName handles edge cases', () => {
    expect(parseMcpToolName('')).toBeNull();
    expect(parseMcpToolName('mcp')).toBeNull();
    expect(parseMcpToolName('mcp__')).toBeNull();
    expect(parseMcpToolName('mcp____')).toBeNull();
    expect(parseMcpToolName('mcp__server')).toBeNull();
    expect(parseMcpToolName('MCP__server__tool')).toBeNull();

    const withUnderscores = parseMcpToolName('mcp__my_server__my_tool');
    expect(withUnderscores).not.toBeNull();
    expect(withUnderscores!.serverId).toBe('my_server');
    expect(withUnderscores!.toolName).toBe('my_tool');
  });

  it('formatMcpResult handles empty content array', () => {
    const result = formatMcpResult({ content: [], isError: false });
    expect(result).toBe('');
  });

  it('formatMcpResult handles resource without text', () => {
    const result = formatMcpResult({
      content: [{ type: 'resource', resource: { uri: 'file:///test', text: undefined } }],
      isError: false,
    });
    expect(result).toContain('file:///test');
  });

  it('JavaScript execution with complex objects', () => {
    const code = `({
      users: [
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 }
      ],
      total: 2,
      meta: { generated: true }
    })`;
    const result = executeJavaScriptWithResult(code) as any;
    expect(result.users).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(result.meta.generated).toBe(true);
  });

  it('stripAnsi is idempotent', () => {
    const input = '\x1b[31mHello\x1b[0m';
    const once = stripAnsi(input);
    const twice = stripAnsi(once);
    expect(once).toBe(twice);
    expect(once).toBe('Hello');
  });

  it('sanitizeTerminalText handles empty string', () => {
    expect(sanitizeTerminalText('')).toBe('');
  });
});
