// ---------------------------------------------------------------------------
// Tests — JS Bridge
// ---------------------------------------------------------------------------

import {
  executeWithBridge,
  buildFileCache,
  executeWorkspaceJavaScript,
} from '../../src/utils/jsBridge';

describe('buildFileCache', () => {
  it('creates a Map from file array', () => {
    const cache = buildFileCache([
      { path: '/a.txt', content: 'aaa' },
      { path: '/b.txt', content: 'bbb' },
    ]);
    expect(cache.size).toBe(2);
    expect(cache.get('a.txt')).toBe('aaa');
    expect(cache.get('b.txt')).toBe('bbb');
  });

  it('returns empty map for empty array', () => {
    const cache = buildFileCache([]);
    expect(cache.size).toBe(0);
  });
});

describe('executeWithBridge', () => {
  describe('basic execution', () => {
    it('returns last expression value', () => {
      const result = executeWithBridge('return 42;');
      expect(result).toBe(42);
    });

    it('returns undefined when no return', () => {
      const result = executeWithBridge('const x = 1;');
      expect(result).toBeUndefined();
    });

    it('captures console.log output', () => {
      const result = executeWithBridge('console.log("hello"); console.log("world");');
      expect(result).toContain('hello');
      expect(result).toContain('world');
    });

    it('merges console output and return value', () => {
      const result = executeWithBridge('console.log("log1"); return 99;');
      expect(String(result)).toContain('log1');
      expect(String(result)).toContain('99');
    });

    it('handles console.warn and console.error', () => {
      const result = executeWithBridge('console.warn("w"); console.error("e");');
      expect(String(result)).toContain('[warn]');
      expect(String(result)).toContain('[error]');
    });

    it('throws on syntax error', () => {
      expect(() => executeWithBridge('if(')).toThrow();
    });

    it('throws on runtime error when no logs', () => {
      expect(() => executeWithBridge('throw new Error("boom");')).toThrow('boom');
    });

    it('includes error in output when logs exist', () => {
      const result = executeWithBridge('console.log("before"); throw new Error("boom");');
      expect(String(result)).toContain('before');
      expect(String(result)).toContain('boom');
    });
  });

  describe('fs API', () => {
    it('reads files from cache', () => {
      const cache = buildFileCache([{ path: 'test.txt', content: 'hello world' }]);
      const result = executeWithBridge('return fs.readFile("test.txt");', { fileCache: cache });
      expect(result).toBe('hello world');
    });

    it('throws for non-existent file', () => {
      expect(() => {
        executeWithBridge('return fs.readFile("nope.txt");');
      }).toThrow(/not found/i);
    });

    it('writes and reads back', () => {
      const cache = new Map<string, string>();
      const result = executeWithBridge(
        'fs.writeFile("new.txt", "contents"); return fs.readFile("new.txt");',
        { fileCache: cache },
      );
      expect(result).toBe('contents');
      expect(cache.get('new.txt')).toBe('contents');
    });

    it('checks existence', () => {
      const cache = buildFileCache([{ path: 'a.txt', content: '' }]);
      const result = executeWithBridge('return [fs.exists("a.txt"), fs.exists("b.txt")];', {
        fileCache: cache,
      });
      expect(result).toEqual([true, false]);
    });

    it('lists files', () => {
      const cache = buildFileCache([
        { path: 'x.ts', content: '' },
        { path: 'y.ts', content: '' },
      ]);
      const result = executeWithBridge('return fs.listFiles();', { fileCache: cache });
      expect(result).toEqual(['x.ts', 'y.ts']);
    });

    it('deletes files', () => {
      const cache = buildFileCache([{ path: 'del.txt', content: 'bye' }]);
      const result = executeWithBridge(
        'const ok = fs.deleteFile("del.txt"); return [ok, fs.exists("del.txt")];',
        { fileCache: cache },
      );
      expect(result).toEqual([true, false]);
    });

    it('supports inline require from the workspace cache', () => {
      const cache = buildFileCache([
        { path: 'helpers/math.js', content: 'module.exports = (value) => value * 2;' },
      ]);
      const result = executeWithBridge(
        'const double = require("helpers/math"); return double(21);',
        { fileCache: cache },
      );
      expect(result).toBe(42);
    });

    it('executes workspace entry files with CommonJS require', () => {
      const cache = buildFileCache([
        {
          path: 'tools/main.js',
          content: 'const multiply = require("./multiply"); module.exports = multiply(6, 7);',
        },
        { path: 'tools/multiply.js', content: 'module.exports = (left, right) => left * right;' },
      ]);

      const result = executeWorkspaceJavaScript({
        path: 'tools/main.js',
        fileCache: cache,
      });

      expect(result.hadError).toBe(false);
      expect(result.result).toBe(42);
    });

    it('resolves module-relative fs paths for file-based execution', () => {
      const cache = buildFileCache([
        {
          path: 'tools/main.js',
          content: 'module.exports = fs.readFile("./data/input.txt").trim();',
        },
        { path: 'tools/data/input.txt', content: 'hello from workspace\n' },
      ]);

      const result = executeWorkspaceJavaScript({
        path: 'tools/main.js',
        fileCache: cache,
      });

      expect(result.result).toBe('hello from workspace');
    });

    it('loads JSON modules from the workspace', () => {
      const cache = buildFileCache([
        {
          path: 'tools/main.js',
          content: 'const config = require("./config.json"); module.exports = config.answer;',
        },
        { path: 'tools/config.json', content: '{"answer":42}' },
      ]);

      const result = executeWorkspaceJavaScript({
        path: 'tools/main.js',
        fileCache: cache,
      });

      expect(result.result).toBe(42);
    });
  });

  describe('data API', () => {
    it('parses JSON', () => {
      const result = executeWithBridge('return data.parseJSON(\'{"a":1}\');');
      expect(result).toEqual({ a: 1 });
    });

    it('parses CSV', () => {
      const result = executeWithBridge('return data.parseCSV("a,b\\nc,d");');
      expect(result).toEqual([
        ['a', 'b'],
        ['c', 'd'],
      ]);
    });

    it('parses CSV with quoted fields', () => {
      const result = executeWithBridge('return data.parseCSV(\'a,"b,c"\\nd,e\');');
      expect(result).toEqual([
        ['a', 'b,c'],
        ['d', 'e'],
      ]);
    });

    it('parses simple YAML', () => {
      const result = executeWithBridge(
        'return data.parseYAML("name: test\\ncount: 42\\nactive: true");',
      );
      expect(result).toEqual({ name: 'test', count: 42, active: true });
    });

    it('serializes to JSON', () => {
      const result = executeWithBridge('return data.toJSON({x: 1});');
      expect(JSON.parse(result as string)).toEqual({ x: 1 });
    });

    it('serializes to CSV', () => {
      const result = executeWithBridge('return data.toCSV([["a","b"],["c","d"]]);');
      expect(result).toBe('a,b\nc,d');
    });

    it('CSV round-trip preserves data', () => {
      const code = `
        const original = [["name","value"],["Alice","100"],["Bob","200"]];
        const csv = data.toCSV(original);
        const parsed = data.parseCSV(csv);
        return JSON.stringify(parsed) === JSON.stringify(original);
      `;
      expect(executeWithBridge(code)).toBe(true);
    });
  });

  describe('env API', () => {
    it('returns env variable', () => {
      const result = executeWithBridge('return env.get("API_KEY");', {
        env: { API_KEY: 'secret123' },
      });
      expect(result).toBe('secret123');
    });

    it('returns undefined for missing env variable', () => {
      const result = executeWithBridge('return env.get("MISSING");', { env: {} });
      expect(result).toBeUndefined();
    });

    it('returns platform as react-native', () => {
      const result = executeWithBridge('return env.platform;');
      expect(result).toBe('react-native');
    });

    it('returns current timestamp as number', () => {
      const result = executeWithBridge('return typeof env.now();');
      expect(result).toBe('number');
    });

    it('returns ISO timestamp string', () => {
      const result = executeWithBridge('return env.timestamp();') as string;
      // ISO format check
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });
});
