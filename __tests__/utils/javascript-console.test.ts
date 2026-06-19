// Quick test for JavaScript sandbox console.log capture
import { executeJavaScriptWithResult, formatJavaScriptResult } from '../../src/utils/javascript';

describe('JavaScript sandbox console.log capture', () => {
  it('captures console.log output', () => {
    const result = executeJavaScriptWithResult('console.log("hello world")');
    expect(result).toBe('hello world');
  });

  it('captures multiple console.log calls', () => {
    const result = executeJavaScriptWithResult(
      'console.log("a"); console.log("b"); console.log("c")',
    );
    expect(result).toBe('a\nb\nc');
  });

  it('captures console.log in loops', () => {
    const result = executeJavaScriptWithResult('for(let i=0;i<3;i++) console.log("item",i)');
    expect(result).toBe('item 0\nitem 1\nitem 2');
  });

  it('formats console.log objects readably', () => {
    const result = executeJavaScriptWithResult('console.log({ answer: 42, nested: { ok: true } })');
    expect(result).toBe(`{\n  "answer": 42,\n  "nested": {\n    "ok": true\n  }\n}`);
  });

  it('captures console.warn with prefix', () => {
    const result = executeJavaScriptWithResult('console.warn("oops")');
    expect(result).toBe('[warn] oops');
  });

  it('captures console.error with prefix', () => {
    const result = executeJavaScriptWithResult('console.error("fail")');
    expect(result).toBe('[error] fail');
  });

  it('combines logs with return value when last line is separate', () => {
    // When the return value is on a separate line, logs + return are combined
    const result = executeJavaScriptWithResult('console.log("step 1"); console.log("step 2");\n42');
    expect(String(result)).toBe('step 1\nstep 2\n42');
  });

  it('console-only single-line returns just logs', () => {
    // When everything is on one line with console calls, logs are returned
    const result = executeJavaScriptWithResult('console.log("step 1"); console.log("step 2"); 42');
    expect(result).toBe('step 1\nstep 2');
  });

  it('LLM-style code with console.log + statements works', () => {
    const code = `
      const data = { name: 'API Response', status: 200 };
      console.log('Status:', data.status);
      console.log('Name:', data.name);
    `;
    const result = executeJavaScriptWithResult(code);
    expect(result).toBe('Status: 200\nName: API Response');
  });

  it('simple expression still returns directly', () => {
    expect(executeJavaScriptWithResult('2 + 2')).toBe(4);
  });

  it('array operations still work', () => {
    expect(executeJavaScriptWithResult('[1,2,3].map(x=>x*2)')).toEqual([2, 4, 6]);
  });

  it('formats returned objects readably for display surfaces', () => {
    const result = executeJavaScriptWithResult('({ answer: 42, nested: { ok: true } })');
    expect(formatJavaScriptResult(result)).toBe(
      `{\n  "answer": 42,\n  "nested": {\n    "ok": true\n  }\n}`,
    );
  });

  it('formats circular objects without collapsing to object object', () => {
    const result = executeJavaScriptWithResult(
      'const value = { name: "loop" }; value.self = value;\nvalue',
    );
    expect(formatJavaScriptResult(result)).toBe(`{\n  "name": "loop",\n  "self": "[Circular]"\n}`);
  });

  it('JSON.stringify still works', () => {
    expect(executeJavaScriptWithResult('JSON.stringify({a:1})')).toBe('{"a":1}');
  });

  it('documents that standard JavaScript globals remain available', () => {
    expect(executeJavaScriptWithResult('typeof globalThis')).toBe('object');
  });

  it('empty code returns undefined', () => {
    expect(executeJavaScriptWithResult('')).toBeUndefined();
  });

  it('undefined code returns undefined instead of throwing', () => {
    expect(executeJavaScriptWithResult(undefined)).toBeUndefined();
  });

  it('executes fenced JavaScript source', () => {
    const result = executeJavaScriptWithResult('```js\nconst value = 21 * 2;\nvalue\n```');
    expect(result).toBe(42);
  });

  it('errors still throw', () => {
    expect(() => executeJavaScriptWithResult('throw new Error("test")')).toThrow('test');
  });

  it('LLM calling console.log to "output" calculation results', () => {
    const code = `
      const prices = [10, 20, 30, 40, 50];
      const total = prices.reduce((sum, p) => sum + p, 0);
      const avg = total / prices.length;
      console.log("Total:", total);
      console.log("Average:", avg);
      console.log("Count:", prices.length);
    `;
    const result = executeJavaScriptWithResult(code);
    expect(result).toContain('Total: 150');
    expect(result).toContain('Average: 30');
    expect(result).toContain('Count: 5');
  });
});
