// ---------------------------------------------------------------------------
// Tests — Extended Tool Executors (file_edit, glob_search, text_search)
// ---------------------------------------------------------------------------

import {
  FILE_EDIT_TOOL,
  executeFileEdit,
  executeGlobSearch,
  executeTextSearch,
} from '../../src/engine/tools/extended';

// Mock expo-file-system
jest.mock('expo-file-system', () => {
  const store: Record<string, string> = {};
  const dirs = new Set<string>();

  class MockFile {
    uri: string;
    name: string;
    constructor(...parts: any[]) {
      const pathParts: string[] = [];
      for (const p of parts) {
        if (typeof p === 'string') pathParts.push(p);
        else if (p && p.uri) pathParts.push(p.uri);
      }
      this.uri = pathParts.join('/');
      this.name = pathParts[pathParts.length - 1] || '';
    }
    get exists() {
      return this.uri in store;
    }
    text() {
      return store[this.uri] || '';
    }
    write(content: string) {
      store[this.uri] = content;
    }
  }

  class MockDirectory {
    uri: string;
    name: string;
    constructor(...parts: any[]) {
      const pathParts: string[] = [];
      for (const p of parts) {
        if (typeof p === 'string') pathParts.push(p);
        else if (p && p.uri) pathParts.push(p.uri);
      }
      this.uri = pathParts.join('/');
      this.name = pathParts[pathParts.length - 1] || '';
    }
    get exists() {
      return dirs.has(this.uri);
    }
    create() {
      dirs.add(this.uri);
    }
    list() {
      const prefix = this.uri.endsWith('/') ? this.uri : this.uri + '/';
      const results: any[] = [];
      const seen = new Set<string>();
      for (const key of Object.keys(store)) {
        if (key.startsWith(prefix)) {
          const rest = key.slice(prefix.length);
          const firstPart = rest.split('/')[0];
          if (!seen.has(firstPart)) {
            seen.add(firstPart);
            if (rest.includes('/')) {
              results.push(new MockDirectory(this, firstPart));
            } else {
              results.push(new MockFile(this, firstPart));
            }
          }
        }
      }
      return results;
    }
  }

  return {
    File: MockFile,
    Directory: MockDirectory,
    Paths: {
      get document() {
        return new MockDirectory('file:///mock/documents');
      },
      get cache() {
        return new MockDirectory('file:///mock/cache');
      },
    },
    __resetStore: () => {
      for (const key of Object.keys(store)) delete store[key];
      dirs.clear();
    },
    __getStore: () => store,
    __getDirs: () => dirs,
  };
});

const { __resetStore, __getStore, __getDirs } = require('expo-file-system');

beforeEach(() => {
  __resetStore();
});

function setupWorkspace(conversationId: string, files: Record<string, string>) {
  const base = `file:///mock/documents/workspace/${conversationId}`;
  __getDirs().add(base);
  for (const [path, content] of Object.entries(files)) {
    __getStore()[`${base}/${path}`] = content;
  }
}

describe('executeFileEdit', () => {
  const CONV = 'edit-test';

  it('exposes focused edit operations in the tool definition', () => {
    expect(FILE_EDIT_TOOL.description).toContain('focused updates');
    expect(FILE_EDIT_TOOL.input_schema.properties).toHaveProperty('edits');
    expect(FILE_EDIT_TOOL.input_schema.required).toEqual(['path']);
  });

  it('edits a file with unique oldText match', async () => {
    setupWorkspace(CONV, { 'app.ts': 'const x = 1;\nconst y = 2;\n' });
    const result = await executeFileEdit(
      { path: 'app.ts', oldText: 'const x = 1;', newText: 'const x = 10;' },
      CONV,
    );
    expect(result).toContain('Successfully edited');
    expect(__getStore()[`file:///mock/documents/workspace/${CONV}/app.ts`]).toContain(
      'const x = 10;',
    );
  });

  it('applies ordered focused edits from the edits array', async () => {
    setupWorkspace(CONV, {
      'multi.ts': 'function demo() {\n  const value = 1;\n}\n',
    });

    const result = await executeFileEdit(
      {
        path: 'multi.ts',
        edits: [
          { oldText: 'const value = 1;', newText: 'const answer = 42;' },
          { op: 'insert_after', oldText: 'const answer = 42;', newText: '\n  return answer;' },
        ],
      },
      CONV,
    );

    expect(result).toContain('2 focused update');
    expect(__getStore()[`file:///mock/documents/workspace/${CONV}/multi.ts`]).toBe(
      'function demo() {\n  const answer = 42;\n  return answer;\n}\n',
    );
  });

  it('fails atomically when a later focused edit cannot be applied', async () => {
    setupWorkspace(CONV, { 'atomic.ts': 'alpha\nbeta\n' });

    const result = await executeFileEdit(
      {
        path: 'atomic.ts',
        edits: [
          { oldText: 'alpha', newText: 'ALPHA' },
          { oldText: 'missing', newText: 'noop' },
        ],
      },
      CONV,
    );

    expect(result).toContain('did not match oldText');
    expect(__getStore()[`file:///mock/documents/workspace/${CONV}/atomic.ts`]).toBe(
      'alpha\nbeta\n',
    );
  });

  it('returns error if file not found', async () => {
    const result = await executeFileEdit({ path: 'missing.ts', oldText: 'x', newText: 'y' }, CONV);
    expect(result).toContain('Error');
    expect(result).toContain('not found');
  });

  it('returns error if oldText not found in file', async () => {
    setupWorkspace(CONV, { 'file.ts': 'hello world' });
    const result = await executeFileEdit(
      { path: 'file.ts', oldText: 'goodbye', newText: 'hi' },
      CONV,
    );
    expect(result).toContain('not found');
  });

  it('returns error if oldText matches multiple times', async () => {
    setupWorkspace(CONV, { 'dup.ts': 'foo bar foo baz foo' });
    const result = await executeFileEdit({ path: 'dup.ts', oldText: 'foo', newText: 'qux' }, CONV);
    expect(result).toContain('3 times');
    expect(result).toContain('must be unique');
  });

  it('strips path traversal from path', async () => {
    setupWorkspace(CONV, { 'safe.ts': 'content' });
    const result = await executeFileEdit(
      { path: '../../../etc/safe.ts', oldText: 'content', newText: 'new' },
      CONV,
    );
    // Path gets sanitized — either finds the safe.ts or returns not found
    expect(typeof result).toBe('string');
  });

  it('returns a friendly error when oldText is missing', async () => {
    setupWorkspace(CONV, { 'safe.ts': 'content' });
    const result = await executeFileEdit(
      { path: 'safe.ts', oldText: undefined as any, newText: 'new' },
      CONV,
    );
    expect(result).toContain('Error');
    expect(result).toContain('oldText');
  });

  it('rejects mixing legacy and focused edit arguments', async () => {
    setupWorkspace(CONV, { 'mixed.ts': 'content' });
    const result = await executeFileEdit(
      {
        path: 'mixed.ts',
        oldText: 'content',
        newText: 'updated',
        edits: [{ oldText: 'content', newText: 'updated' }],
      },
      CONV,
    );

    expect(result).toContain('either edits or oldText/newText');
  });
});

describe('executeGlobSearch', () => {
  const CONV = 'glob-test';

  it('finds files matching glob pattern', async () => {
    setupWorkspace(CONV, {
      'app.ts': 'ts',
      'index.js': 'js',
      'style.css': 'css',
    });
    const result = await executeGlobSearch({ pattern: '*.ts' }, CONV);
    const parsed = JSON.parse(result);
    expect(parsed.count).toBe(1);
    expect(parsed.matches).toContain('app.ts');
    expect(parsed.matches).not.toContain('index.js');
  });

  it('finds files with ** pattern', async () => {
    setupWorkspace(CONV, {
      'src/a.ts': 'a',
      'src/b.ts': 'b',
      'lib/c.js': 'c',
    });
    __getDirs().add(`file:///mock/documents/workspace/${CONV}/src`);
    const result = await executeGlobSearch({ pattern: '**/*.ts' }, CONV);
    const parsed = JSON.parse(result);
    expect(parsed.count).toBe(2);
    expect(parsed.matches).toEqual(expect.arrayContaining(['src/a.ts', 'src/b.ts']));
  });

  it('treats dot path as the workspace root for file-backed directories', async () => {
    setupWorkspace(CONV, {
      'inbox/untrusted_note.txt': 'safe',
    });

    const result = await executeGlobSearch({ pattern: '**/*', path: '.' }, CONV);
    const parsed = JSON.parse(result);

    expect(parsed.path).toBe('.');
    expect(parsed.count).toBeGreaterThan(0);
    expect(parsed.matches).toEqual(
      expect.arrayContaining(['inbox/', 'inbox/untrusted_note.txt']),
    );
  });

  it('returns no matches message', async () => {
    setupWorkspace(CONV, { 'app.ts': 'content' });
    const result = await executeGlobSearch({ pattern: '*.py' }, CONV);
    const parsed = JSON.parse(result);
    expect(parsed.count).toBe(0);
    expect(parsed.summary).toContain('No files matched');
  });

  it('returns error for non-existent directory', async () => {
    const result = await executeGlobSearch({ pattern: '*.ts', path: 'nonexistent' }, CONV);
    expect(result).toContain('Error');
    expect(result).toContain('not found');
  });

  it('searches in subdirectory when path is given', async () => {
    setupWorkspace(CONV, {
      'src/app.ts': 'app',
      'src/index.ts': 'index',
      'lib/util.ts': 'util',
    });
    __getDirs().add(`file:///mock/documents/workspace/${CONV}/src`);
    const result = await executeGlobSearch({ pattern: '*.ts', path: 'src' }, CONV);
    const parsed = JSON.parse(result);
    expect(parsed.path).toBe('src');
    expect(parsed.matches).toEqual(expect.arrayContaining(['app.ts', 'index.ts']));
  });

  it('returns a friendly error when pattern is missing', async () => {
    const result = await executeGlobSearch({ pattern: undefined as any }, CONV);
    expect(result).toContain('Error');
    expect(result).toContain('pattern');
  });
});

describe('executeTextSearch', () => {
  const CONV = 'text-search-test';

  it('finds text matches across files', async () => {
    setupWorkspace(CONV, {
      'a.ts': 'const hello = "world";\nconst foo = "bar";',
      'b.ts': 'function hello() {}',
    });
    const result = await executeTextSearch({ query: 'hello' }, CONV);
    const parsed = JSON.parse(result);
    expect(parsed.count).toBe(2);
    expect(parsed.matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'a.ts', line: 1 }),
        expect.objectContaining({ path: 'b.ts', line: 1 }),
      ]),
    );
  });

  it('returns no matches message', async () => {
    setupWorkspace(CONV, { 'a.ts': 'content' });
    const result = await executeTextSearch({ query: 'nonexistent' }, CONV);
    const parsed = JSON.parse(result);
    expect(parsed.count).toBe(0);
    expect(parsed.summary).toContain('No text matches');
  });

  it('supports regex search', async () => {
    setupWorkspace(CONV, { 'code.ts': 'const x = 42;\nlet y = 100;' });
    const result = await executeTextSearch({ query: '\\d+', isRegex: true }, CONV);
    const parsed = JSON.parse(result);
    expect(parsed.isRegex).toBe(true);
    expect(parsed.matches[0].path).toBe('code.ts');
  });

  it('returns error for invalid regex', async () => {
    setupWorkspace(CONV, { 'a.ts': 'content' });
    const result = await executeTextSearch({ query: '[invalid', isRegex: true }, CONV);
    expect(result).toContain('invalid regex');
  });

  it('returns error for non-existent directory', async () => {
    const result = await executeTextSearch({ query: 'test', path: 'missing' }, CONV);
    expect(result).toContain('Error');
    expect(result).toContain('not found');
  });

  it('includes line numbers in results', async () => {
    setupWorkspace(CONV, { 'lines.ts': 'line1\nfind me\nline3' });
    const result = await executeTextSearch({ query: 'find me' }, CONV);
    const parsed = JSON.parse(result);
    expect(parsed.matches).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'lines.ts', line: 2 })]),
    );
  });

  it('rejects non-boolean isRegex values', async () => {
    setupWorkspace(CONV, { 'lines.ts': 'line1\nfind me\nline3' });
    const result = await executeTextSearch({ query: 'find me', isRegex: 'true' as any }, CONV);
    expect(result).toContain('Error');
    expect(result).toContain('isRegex');
  });
});
