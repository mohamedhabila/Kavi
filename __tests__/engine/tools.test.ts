// ---------------------------------------------------------------------------
// Tests — Tool Executor
// ---------------------------------------------------------------------------

import type { Skill } from '../../src/services/skills/types';

jest.mock('../../src/services/python/pyodideBridge', () => ({
  executePython: jest.fn().mockResolvedValue({ success: true, output: '42' }),
}));

// Mock expo-file-system
jest.mock('expo-file-system', () => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const store: Record<string, Uint8Array> = {};
  const dirs = new Set<string>();

  const normalizeUri = (value: string): string => value.replace(/\/+$/g, '');

  const joinUri = (...parts: string[]): string => {
    if (parts.length === 0) return '';
    let result = parts[0] || '';
    for (let index = 1; index < parts.length; index += 1) {
      const part = parts[index] || '';
      result = `${normalizeUri(result)}/${part.replace(/^\/+/, '')}`;
    }
    return normalizeUri(result);
  };

  const ensureParents = (uri: string) => {
    const normalized = normalizeUri(uri);
    const pieces = normalized.split('/');
    for (let index = 3; index < pieces.length; index += 1) {
      const dirUri = pieces.slice(0, index).join('/');
      if (dirUri) {
        dirs.add(dirUri);
      }
    }
  };

  class MockFile {
    uri: string;
    name: string;
    constructor(...parts: any[]) {
      const pathParts: string[] = [];
      for (const p of parts) {
        if (typeof p === 'string') {
          pathParts.push(p);
        } else if (p && p.uri) {
          pathParts.push(p.uri);
        }
      }
      this.uri = joinUri(...pathParts);
      this.name = pathParts[pathParts.length - 1]?.split('/').pop() || '';
    }
    get exists() {
      return this.uri in store;
    }
    text() {
      return decoder.decode(store[this.uri] || new Uint8Array());
    }
    bytes() {
      return store[this.uri] || new Uint8Array();
    }
    write(content: string | Uint8Array | ArrayBuffer) {
      ensureParents(this.uri);
      if (typeof content === 'string') {
        store[this.uri] = encoder.encode(content);
        return;
      }

      if (content instanceof Uint8Array) {
        store[this.uri] = content;
        return;
      }

      store[this.uri] = new Uint8Array(content);
    }
    delete() {
      delete store[this.uri];
    }
  }

  class MockDirectory {
    uri: string;
    name: string;
    constructor(...parts: any[]) {
      const pathParts: string[] = [];
      for (const p of parts) {
        if (typeof p === 'string') {
          pathParts.push(p);
        } else if (p && p.uri) {
          pathParts.push(p.uri);
        }
      }
      this.uri = joinUri(...pathParts);
      this.name = pathParts[pathParts.length - 1]?.split('/').pop() || '';
    }
    get exists() {
      return dirs.has(this.uri);
    }
    create(_options?: { idempotent?: boolean; intermediates?: boolean }) {
      ensureParents(this.uri);
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

    delete() {
      dirs.delete(this.uri);
      for (const dir of Array.from(dirs)) {
        if (dir.startsWith(`${this.uri}/`)) {
          dirs.delete(dir);
        }
      }
      for (const key of Object.keys(store)) {
        if (key.startsWith(`${this.uri}/`)) {
          delete store[key];
        }
      }
    }
  }

  const documentRoot = 'file:///mock/documents';
  const cacheRoot = 'file:///mock/cache';
  dirs.add(documentRoot);
  dirs.add(cacheRoot);

  const mockPaths = {
    get document() {
      return new MockDirectory(documentRoot);
    },
    get cache() {
      return new MockDirectory(cacheRoot);
    },
  };

  return {
    File: MockFile,
    Directory: MockDirectory,
    Paths: mockPaths,
    // Helper for tests to reset state
    __resetStore: () => {
      for (const key of Object.keys(store)) delete store[key];
      dirs.clear();
      dirs.add(documentRoot);
      dirs.add(cacheRoot);
    },
    __getStore: () =>
      Object.fromEntries(Object.entries(store).map(([key, value]) => [key, decoder.decode(value)])),
  };
});

jest.mock('../../src/store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      activeProviderId: 'openai',
      providers: [
        {
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: '',
          model: 'gpt-image-1.5',
          enabled: true,
        },
      ],
    }),
  },
}));

jest.mock('../../src/services/storage/SecureStorage', () => ({
  getProviderApiKey: jest.fn().mockResolvedValue('sk-image'),
}));

jest.mock('../../src/services/media/imageGeneration', () => ({
  generateImage: jest.fn().mockResolvedValue({
    status: 'generated',
    providerId: 'openai',
    model: 'gpt-image-1.5',
    mimeType: 'image/png',
    fileUri: 'file:///mock/cache/generated.png',
  }),
  editImage: jest.fn().mockResolvedValue({
    status: 'edited',
    providerId: 'openai',
    model: 'gpt-image-1.5',
    mimeType: 'image/png',
    fileUri: 'file:///mock/cache/edited.png',
    sourceCount: 1,
  }),
}));

jest.mock('../../src/services/memory/embeddings', () => ({
  hybridSearch: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../src/engine/tools/native-executor', () => ({
  executeNativeTool: jest.fn().mockImplementation((name: string) => {
    if (name === 'notification_send') {
      return Promise.resolve(
        JSON.stringify({
          status: 'notification_displayed',
          id: 'notification-id',
          title: 'Test',
          body: 'Hello',
        }),
      );
    }
    return Promise.resolve(JSON.stringify({ status: 'ok' }));
  }),
}));

jest.mock('../../src/services/security/audit', () => ({
  logToolCall: jest.fn(),
}));

const mockPermissionOverrides = new Map<string, boolean>();

jest.mock('../../src/services/security/permissions', () => ({
  useToolPermissionsStore: {
    getState: () => ({
      isAllowed: (name: string) => mockPermissionOverrides.get(name) ?? true,
      setPermission: (name: string, allowed: boolean) => {
        mockPermissionOverrides.set(name, allowed);
      },
      reset: () => {
        mockPermissionOverrides.clear();
      },
    }),
  },
}));

let __resetStore: () => void;
let __getStore: () => Record<string, string>;
let executeTool: (
  name: string,
  argsString: string,
  conversationId: string,
  context?: Record<string, unknown>,
) => Promise<string>;
let loadMemory: (conversationId: string) => Promise<string | null>;
let executeNativeTool: jest.Mock;
let generateImage: jest.Mock;
let editImage: jest.Mock;
let hybridSearch: jest.Mock;
let registerSkill: (skill: Skill) => void;
let unregisterSkill: (id: string) => void;
let clearAllSurfaces: () => void;
let getSurface: (surfaceId: string) => any;
let executePython: jest.Mock;

function loadTestModules() {
  ({ __resetStore, __getStore } = require('expo-file-system'));
  ({ executeTool, loadMemory } = require('../../src/engine/tools/index'));
  ({ executeNativeTool } = require('../../src/engine/tools/native-executor'));
  ({ generateImage, editImage } = require('../../src/services/media/imageGeneration'));
  ({ hybridSearch } = require('../../src/services/memory/embeddings'));
  ({ registerSkill, unregisterSkill } = require('../../src/services/skills/manager'));
  ({ clearAllSurfaces, getSurface } = require('../../src/services/canvas/renderer'));
  ({ executePython } = require('../../src/services/python/pyodideBridge'));
}

beforeEach(() => {
  jest.resetModules();
  loadTestModules();
  __resetStore();
  jest.clearAllMocks();
  executePython.mockResolvedValue({ success: true, output: '42' });
  hybridSearch.mockReset();
  hybridSearch.mockResolvedValue([]);
  mockPermissionOverrides.clear();
  clearAllSurfaces();
  // Clear scheduler store so cron tests start fresh
  const { useSchedulerStore } = require('../../src/services/scheduler/store');
  useSchedulerStore.setState({ jobs: [] });
});

describe('executeTool', () => {
  const CONV_ID = 'test-conversation';

  it('derives hybrid memory search from the active provider when embeddings are supported', async () => {
    hybridSearch.mockResolvedValueOnce([
      { source: 'MEMORY.md', snippet: 'remember this detail', score: 0.92, scope: 'global' },
    ]);

    const result = await executeTool(
      'memory_search',
      JSON.stringify({ query: 'remember this detail' }),
      CONV_ID,
    );
    const parsed = JSON.parse(result);

    expect(parsed.method).toBe('hybrid');
    expect(hybridSearch).toHaveBeenCalledWith(
      'remember this detail',
      expect.objectContaining({
        embedding: expect.objectContaining({
          provider: 'openai',
          apiKey: 'sk-image',
          baseUrl: 'https://api.openai.com/v1',
        }),
      }),
      expect.objectContaining({
        scope: 'all',
      }),
    );
  });

  it('passes conversation workspace access to skill tools', async () => {
    const skillId = 'workspace-context';
    unregisterSkill(skillId);

    const skill: Skill = {
      id: skillId,
      name: 'Workspace Context',
      description: '',
      version: '1.0',
      tools: [
        {
          name: 'read_workspace_file',
          description: 'Reads a conversation workspace file through skill context',
          input_schema: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
          },
          handler: async (args, context) => {
            return await context.readConversationFile!(args.path);
          },
        },
      ],
    };

    registerSkill(skill);

    try {
      await executeTool(
        'write_file',
        JSON.stringify({ path: 'notes/source.txt', content: 'workspace contents' }),
        CONV_ID,
      );

      const result = await executeTool(
        'skill__workspace-context__read_workspace_file',
        JSON.stringify({ path: '/notes/source.txt' }),
        CONV_ID,
      );

      expect(result).toBe('workspace contents');
    } finally {
      unregisterSkill(skillId);
    }
  });

  it('loads and updates canvas HTML from conversation workspace files', async () => {
    await executeTool(
      'write_file',
      JSON.stringify({
        path: 'canvas/page.html',
        content:
          '<html><head><title>Canvas File</title></head><body><main>Version 1</main></body></html>',
      }),
      CONV_ID,
    );

    const createResult = await executeTool(
      'canvas_create',
      JSON.stringify({ filePath: 'canvas/page.html' }),
      CONV_ID,
    );
    const created = JSON.parse(createResult);

    expect(created.status).toBe('created');
    expect(created.title).toBe('Canvas File');
    expect(getSurface(created.surfaceId)?.rawHtml).toContain('Version 1');

    await executeTool(
      'write_file',
      JSON.stringify({
        path: 'canvas/page.html',
        content:
          '<html><head><title>Canvas File</title></head><body><main>Version 2</main></body></html>',
      }),
      CONV_ID,
    );

    const updateResult = await executeTool(
      'canvas_update',
      JSON.stringify({ surfaceId: created.surfaceId, filePath: 'canvas/page.html' }),
      CONV_ID,
    );
    const updated = JSON.parse(updateResult);

    expect(updated.status).toBe('updated');
    expect(getSurface(created.surfaceId)?.rawHtml).toContain('Version 2');
  });

  describe('write_file', () => {
    it('should write file and return confirmation', async () => {
      const result = await executeTool(
        'write_file',
        JSON.stringify({ path: 'test.txt', content: 'Hello world' }),
        CONV_ID,
      );
      expect(result).toContain('Wrote 11 chars');
      expect(result).toContain('test.txt');
    });

    it('should create nested directories without failing when parents already exist', async () => {
      await executeTool(
        'write_file',
        JSON.stringify({ path: 'nested/dir/file-one.txt', content: 'Hello' }),
        CONV_ID,
      );

      const result = await executeTool(
        'write_file',
        JSON.stringify({ path: 'nested/dir/file-two.txt', content: 'World' }),
        CONV_ID,
      );

      expect(result).toContain('file-two.txt');
      expect(Object.keys(__getStore())).toEqual(
        expect.arrayContaining([
          'file:///mock/documents/workspace/test-conversation/nested/dir/file-one.txt',
          'file:///mock/documents/workspace/test-conversation/nested/dir/file-two.txt',
        ]),
      );
    });

    it('should return a friendly error when content is missing', async () => {
      const result = await executeTool('write_file', JSON.stringify({ path: 'test.txt' }), CONV_ID);

      expect(result).toContain('Error');
      expect(result).toContain('content');
    });

    it('should return a friendly error when path is missing', async () => {
      const result = await executeTool(
        'write_file',
        JSON.stringify({ content: 'Hello world' }),
        CONV_ID,
      );

      expect(result).toContain('Error');
      expect(result).toContain('path');
    });
  });

  describe('read_file', () => {
    it('should return error for non-existent file', async () => {
      const result = await executeTool(
        'read_file',
        JSON.stringify({ path: 'nonexistent.txt' }),
        CONV_ID,
      );
      expect(result).toContain('Error');
      expect(result).toContain('not found');
    });

    it('should read a previously written file', async () => {
      await executeTool(
        'write_file',
        JSON.stringify({ path: 'data.txt', content: 'test content' }),
        CONV_ID,
      );
      const result = await executeTool('read_file', JSON.stringify({ path: 'data.txt' }), CONV_ID);
      expect(result).toBe('test content');
    });
  });

  describe('list_files', () => {
    it('should list files in workspace', async () => {
      await executeTool('write_file', JSON.stringify({ path: 'a.txt', content: 'a' }), CONV_ID);
      await executeTool('write_file', JSON.stringify({ path: 'b.txt', content: 'b' }), CONV_ID);

      const result = await executeTool('list_files', JSON.stringify({}), CONV_ID);
      expect(result).toContain('a.txt');
      expect(result).toContain('b.txt');
    });

    it('should return empty directory message', async () => {
      const result = await executeTool('list_files', JSON.stringify({}), CONV_ID);
      expect(result).toContain('empty directory');
    });

    it('should reject non-string path values', async () => {
      const result = await executeTool('list_files', JSON.stringify({ path: 123 }), CONV_ID);
      expect(result).toContain('Error');
      expect(result).toContain('path');
    });
  });

  describe('fetch_url', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
      global.fetch = jest.fn();
    });

    afterAll(() => {
      global.fetch = originalFetch;
    });

    it('should fetch URL and return response', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        status: 200,
        text: () => Promise.resolve('<html>Hello</html>'),
      });

      const result = await executeTool(
        'fetch_url',
        JSON.stringify({ url: 'https://example.com' }),
        CONV_ID,
      );
      expect(result).toContain('HTTP 200');
      expect(result).toContain('Hello');
      expect((global.fetch as jest.Mock).mock.calls[0][1].credentials).toBe('omit');
    });

    it('should reject non-http(s) URLs', async () => {
      const result = await executeTool(
        'fetch_url',
        JSON.stringify({ url: 'ftp://example.com' }),
        CONV_ID,
      );
      expect(result).toContain('Error');
      expect(result).toContain('http');
    });

    it('should truncate large responses', async () => {
      const largeContent = 'x'.repeat(200 * 1024);
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        status: 200,
        text: () => Promise.resolve(largeContent),
      });

      const result = await executeTool(
        'fetch_url',
        JSON.stringify({ url: 'https://example.com/large' }),
        CONV_ID,
      );
      expect(result).toContain('Truncated');
      expect(result.length).toBeLessThan(200 * 1024);
    });

    it('should handle fetch errors', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      const result = await executeTool(
        'fetch_url',
        JSON.stringify({ url: 'https://example.com/failing' }),
        CONV_ID,
      );
      expect(result).toContain('Error');
      expect(result).toContain('Network error');
    });
  });

  describe('update_memory', () => {
    it('should write memory file', async () => {
      const result = await executeTool(
        'update_memory',
        JSON.stringify({ content: 'User prefers dark mode' }),
        CONV_ID,
      );
      expect(result).toContain('Conversation memory updated');
      expect(result).toContain('22 chars');
    });
  });

  describe('create_task', () => {
    it('should return task creation info', async () => {
      const result = await executeTool(
        'create_task',
        JSON.stringify({ schedule: '0 9 * * *', prompt: 'Morning briefing' }),
        CONV_ID,
      );
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('task_created');
      expect(parsed.schedule).toBe('0 9 * * *');
      expect(parsed.prompt).toBe('Morning briefing');
    });
  });

  describe('javascript', () => {
    it('should execute simple JavaScript', async () => {
      const result = await executeTool(
        'javascript',
        JSON.stringify({ code: 'return 2 + 2;' }),
        CONV_ID,
      );
      expect(result).toBe('4');
    });

    it('should return the last expression without requiring an explicit return', async () => {
      const result = await executeTool(
        'javascript',
        JSON.stringify({ code: 'const value = 40;\nvalue + 2;' }),
        CONV_ID,
      );

      expect(result).toBe('42');
    });

    it('should handle code with no return value', async () => {
      const result = await executeTool(
        'javascript',
        JSON.stringify({ code: 'const x = 5;' }),
        CONV_ID,
      );
      expect(result).toBe('(no return value)');
    });

    it('should handle errors in code execution', async () => {
      const result = await executeTool(
        'javascript',
        JSON.stringify({ code: 'throw new Error("test error");' }),
        CONV_ID,
      );
      expect(result).toContain('Error');
      expect(result).toContain('test error');
    });

    it('should handle string return values', async () => {
      const result = await executeTool(
        'javascript',
        JSON.stringify({ code: 'return "hello";' }),
        CONV_ID,
      );
      expect(result).toBe('hello');
    });

    it('should return a friendly error when code is missing', async () => {
      const result = await executeTool(
        'javascript',
        JSON.stringify({ script: 'return 42;' }),
        CONV_ID,
      );

      expect(result).toContain('Error');
      expect(result).toContain('code');
    });

    it('should accept fenced JavaScript code', async () => {
      const result = await executeTool(
        'javascript',
        JSON.stringify({ code: '```javascript\nconst total = 40 + 2;\ntotal\n```' }),
        CONV_ID,
      );

      expect(result).toBe('42');
    });

    it('should read workspace files and require workspace modules from inline JavaScript', async () => {
      await executeTool(
        'write_file',
        JSON.stringify({
          path: 'helpers/math.js',
          content: 'module.exports = (value) => value * 2;',
        }),
        CONV_ID,
      );
      await executeTool(
        'write_file',
        JSON.stringify({ path: 'data/value.txt', content: '21' }),
        CONV_ID,
      );

      const result = await executeTool(
        'javascript',
        JSON.stringify({
          code: 'const double = require("helpers/math"); return double(Number(fs.readFile("data/value.txt")));',
        }),
        CONV_ID,
      );

      expect(result).toBe('42');
    });

    it('should execute workspace JavaScript files by path and sync written files back', async () => {
      await executeTool(
        'write_file',
        JSON.stringify({
          path: 'tools/double.js',
          content: 'module.exports = (value) => value * 2;',
        }),
        CONV_ID,
      );
      await executeTool(
        'write_file',
        JSON.stringify({
          path: 'tools/main.js',
          content:
            'const double = require("./double"); const answer = double(21); fs.writeFile("outputs/result.txt", String(answer)); module.exports = answer;',
        }),
        CONV_ID,
      );

      const result = await executeTool(
        'javascript',
        JSON.stringify({ path: 'tools/main.js', argv: ['--prompt', 'hello'] }),
        CONV_ID,
      );

      expect(JSON.parse(result)).toEqual(
        expect.objectContaining({
          summary: 'JavaScript execution completed and changed 1 workspace file.',
          status: 'completed',
          output: '42',
          fileCount: 1,
          files: [expect.objectContaining({ path: 'tools/outputs/result.txt' })],
        }),
      );
      expect(
        __getStore()['file:///mock/documents/workspace/test-conversation/tools/outputs/result.txt'],
      ).toBe('42');
    });

    it('should sync deleted workspace files after successful JavaScript execution', async () => {
      await executeTool(
        'write_file',
        JSON.stringify({ path: 'temp/remove.txt', content: 'delete me' }),
        CONV_ID,
      );

      const result = await executeTool(
        'javascript',
        JSON.stringify({ code: 'fs.deleteFile("temp/remove.txt");' }),
        CONV_ID,
      );

      expect(JSON.parse(result)).toEqual(
        expect.objectContaining({
          summary: 'JavaScript execution completed and changed 0 workspace files, deleted 1 path.',
          status: 'completed',
          deletedCount: 1,
          deletedPaths: ['temp/remove.txt'],
        }),
      );
      expect(
        __getStore()['file:///mock/documents/workspace/test-conversation/temp/remove.txt'],
      ).toBeUndefined();
    });
  });

  describe('python', () => {
    it('should execute Python via the Pyodide bridge', async () => {
      const result = await executeTool(
        'python',
        JSON.stringify({ code: 'print(40 + 2)', packages: ['numpy', 'numpy'] }),
        CONV_ID,
      );

      expect(result).toBe('42');
      expect(executePython).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'print(40 + 2)',
          files: [],
          workingDirectory: '',
          packages: ['numpy'],
        }),
      );
    });

    it('should forward a validated timeout override to the Pyodide bridge', async () => {
      const result = await executeTool(
        'python',
        JSON.stringify({ code: 'print(42)', timeoutMs: 120000 }),
        CONV_ID,
      );

      expect(result).toBe('42');
      expect(executePython).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'print(42)',
          timeoutMs: 120000,
        }),
      );
    });

    it('should reject invalid timeout overrides', async () => {
      const result = await executeTool(
        'python',
        JSON.stringify({ code: 'print(42)', timeoutMs: 999 }),
        CONV_ID,
      );

      expect(result).toContain('timeoutMs');
      expect(executePython).not.toHaveBeenCalled();
    });

    it('should return a friendly error when code is missing', async () => {
      const result = await executeTool('python', JSON.stringify({ script: 'print(42)' }), CONV_ID);

      expect(result).toContain('Error');
      expect(result).toContain('code');
    });

    it('should reject non-string package entries', async () => {
      const result = await executeTool(
        'python',
        JSON.stringify({ code: 'print(42)', packages: ['requests', 123] }),
        CONV_ID,
      );

      expect(result).toContain('packages');
      expect(executePython).not.toHaveBeenCalled();
    });

    it('should forward custom package indexes to the Pyodide bridge', async () => {
      const result = await executeTool(
        'python',
        JSON.stringify({
          code: 'print(42)',
          packages: ['requests'],
          indexUrls: ['https://packages.example/simple', 'https://packages.example/simple'],
        }),
        CONV_ID,
      );

      expect(result).toBe('42');
      expect(executePython).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'print(42)',
          files: [],
          workingDirectory: '',
          packages: ['requests'],
          indexUrls: ['https://packages.example/simple'],
        }),
      );
    });

    it('should reject invalid custom package indexes', async () => {
      const result = await executeTool(
        'python',
        JSON.stringify({ code: 'print(42)', indexUrls: ['ftp://packages.example/simple'] }),
        CONV_ID,
      );

      expect(result).toContain('indexUrls');
      expect(executePython).not.toHaveBeenCalled();
    });

    it('should execute workspace Python scripts by path and merge PEP 723 dependencies', async () => {
      await executeTool(
        'write_file',
        JSON.stringify({
          path: 'skills/image-helper/scripts/generate.py',
          content: [
            '# /// script',
            '# dependencies = [',
            '#   "httpx",',
            '# ]',
            '# ///',
            'import sys',
            'print(sys.argv[1])',
          ].join('\n'),
        }),
        CONV_ID,
      );

      executePython.mockResolvedValueOnce({ success: true, output: 'script ok' });

      const result = await executeTool(
        'python',
        JSON.stringify({
          path: 'skills/image-helper/scripts/generate.py',
          argv: ['--prompt', 'hello world'],
          packages: ['requests'],
          env: { GEMINI_API_KEY: 'secret' },
        }),
        CONV_ID,
      );

      expect(result).toBe('script ok');
      expect(executePython).toHaveBeenCalledWith(
        expect.objectContaining({
          scriptPath: 'skills/image-helper/scripts/generate.py',
          argv: ['--prompt', 'hello world'],
          workingDirectory: '',
          packages: ['requests', 'httpx'],
          env: { GEMINI_API_KEY: 'secret' },
          files: expect.arrayContaining([
            expect.objectContaining({ path: 'skills/image-helper/scripts/generate.py' }),
          ]),
        }),
      );
    });

    it('should mount the conversation workspace for inline Python execution', async () => {
      await executeTool(
        'write_file',
        JSON.stringify({ path: 'util.py', content: 'def answer():\n    return 42\n' }),
        CONV_ID,
      );

      await executeTool(
        'python',
        JSON.stringify({ code: 'import util\nprint(util.answer())' }),
        CONV_ID,
      );

      expect(executePython).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'import util\nprint(util.answer())',
          workingDirectory: '',
          files: expect.arrayContaining([expect.objectContaining({ path: 'util.py' })]),
        }),
      );
    });

    it('should mount sibling workspace files for path-based Python imports', async () => {
      await executeTool(
        'write_file',
        JSON.stringify({
          path: 'pkg/main.py',
          content: 'from shared.util import answer\nprint(answer())\n',
        }),
        CONV_ID,
      );
      await executeTool(
        'write_file',
        JSON.stringify({ path: 'shared/util.py', content: 'def answer():\n    return 42\n' }),
        CONV_ID,
      );

      await executeTool('python', JSON.stringify({ path: 'pkg/main.py' }), CONV_ID);

      expect(executePython).toHaveBeenCalledWith(
        expect.objectContaining({
          scriptPath: 'pkg/main.py',
          workingDirectory: '',
          files: expect.arrayContaining([
            expect.objectContaining({ path: 'pkg/main.py' }),
            expect.objectContaining({ path: 'shared/util.py' }),
          ]),
        }),
      );
    });

    it('should fall back to the worker session workspace for path-based Python scripts when the shared workspace lacks them', async () => {
      await executeTool(
        'write_file',
        JSON.stringify({ path: 'skills/demo/script.py', content: 'print("session script")\n' }),
        'worker-session',
      );

      await executeTool(
        'python',
        JSON.stringify({ path: 'skills/demo/script.py' }),
        'worker-session',
        {
          workspaceConversationId: 'parent-conversation',
          workspaceReadFallbackConversationId: 'worker-session',
        },
      );

      expect(executePython).toHaveBeenCalledWith(
        expect.objectContaining({
          scriptPath: 'skills/demo/script.py',
          files: expect.arrayContaining([
            expect.objectContaining({ path: 'skills/demo/script.py' }),
          ]),
        }),
      );
    });

    it('should write Python script outputs back into the conversation workspace', async () => {
      await executeTool(
        'write_file',
        JSON.stringify({ path: 'scripts/export.py', content: 'print("export")' }),
        CONV_ID,
      );

      executePython.mockResolvedValueOnce({
        success: true,
        output: 'saved',
        files: [
          {
            path: 'outputs/result.txt',
            contentBase64: Buffer.from('done', 'utf8').toString('base64'),
          },
        ],
      });

      const result = await executeTool(
        'python',
        JSON.stringify({ path: 'scripts/export.py' }),
        CONV_ID,
      );

      expect(JSON.parse(result)).toEqual(
        expect.objectContaining({
          summary: 'Python execution completed and wrote 1 workspace file.',
          status: 'completed',
          output: 'saved',
          fileCount: 1,
          files: [expect.objectContaining({ path: 'outputs/result.txt' })],
        }),
      );
      expect(
        __getStore()['file:///mock/documents/workspace/test-conversation/outputs/result.txt'],
      ).toBe('done');
    });

    it('should normalize large Python output into a bounded summary', async () => {
      executePython.mockResolvedValueOnce({
        success: true,
        output: Array.from({ length: 400 }, (_, index) => `line ${index + 1}`).join('\n'),
      });

      const result = await executeTool(
        'python',
        JSON.stringify({ code: 'for i in range(400): print(i)' }),
        CONV_ID,
      );

      expect(JSON.parse(result)).toEqual(
        expect.objectContaining({
          summary: 'Python execution completed with trimmed output for context.',
          status: 'completed',
          truncated: true,
        }),
      );
    });

    it('should surface runtime failures from the Pyodide bridge', async () => {
      executePython.mockResolvedValueOnce({
        success: false,
        output: '',
        error: 'Python runtime unavailable',
      });

      const result = await executeTool('python', JSON.stringify({ code: 'print(42)' }), CONV_ID);

      expect(result).toContain('Python runtime unavailable');
    });
  });

  describe('unknown tool', () => {
    it('should return error for unknown tools', async () => {
      const result = await executeTool('nonexistent_tool', '{}', CONV_ID);
      expect(result).toContain('Error');
      expect(result).toContain('unknown tool');
    });
  });

  describe('invalid JSON', () => {
    it('should handle invalid JSON args gracefully', async () => {
      const result = await executeTool('read_file', 'not json', CONV_ID);
      // Robust arg parsing falls back to {} — tool runs with no args
      expect(typeof result).toBe('string');
    });
  });

  describe('path sanitization', () => {
    it('should strip path traversal attempts', async () => {
      await executeTool(
        'write_file',
        JSON.stringify({ path: 'safe.txt', content: 'safe' }),
        CONV_ID,
      );

      // Try to read with ../
      const result = await executeTool(
        'read_file',
        JSON.stringify({ path: '../../../etc/passwd' }),
        CONV_ID,
      );
      expect(result).toContain('Error');
      expect(result).toContain('not found');
    });

    it('should strip URL-encoded path traversal', async () => {
      const result = await executeTool(
        'read_file',
        JSON.stringify({ path: '..%2F..%2F..%2Fetc%2Fpasswd' }),
        CONV_ID,
      );
      expect(result).toContain('Error');
    });

    it('should strip backslash path traversal', async () => {
      const result = await executeTool(
        'read_file',
        JSON.stringify({ path: '..\\..\\..\\etc\\passwd' }),
        CONV_ID,
      );
      expect(result).toContain('Error');
    });

    it('should strip null bytes', async () => {
      const result = await executeTool(
        'read_file',
        JSON.stringify({ path: 'safe.txt\0.evil' }),
        CONV_ID,
      );
      expect(result).toContain('Error');
    });
  });
});

describe('loadMemory', () => {
  it('should return null when no memory exists', async () => {
    const result = await loadMemory('nonexistent');
    expect(result).toBeNull();
  });

  it('should return memory content when it exists', async () => {
    // loadMemory now reads the shared conversation memory store for the conversation id.
    await executeTool(
      'update_memory',
      JSON.stringify({ content: 'Test memory', mode: 'replace' }),
      'mem-test',
    );
    const result = await loadMemory('mem-test');
    expect(result).toBe('Test memory');
  });
});

describe('executeTool — additional routes', () => {
  const CONV_ID = 'test-routes';

  describe('write_file with subdirectories', () => {
    it('creates nested directories for nested paths', async () => {
      const result = await executeTool(
        'write_file',
        JSON.stringify({ path: 'sub/dir/file.txt', content: 'nested content' }),
        CONV_ID,
      );
      expect(result).toContain('Wrote');
      expect(result).toContain('sub/dir/file.txt');

      // Verify it can be read back
      const read = await executeTool(
        'read_file',
        JSON.stringify({ path: 'sub/dir/file.txt' }),
        CONV_ID,
      );
      expect(read).toBe('nested content');
    });
  });

  describe('list_files with path', () => {
    it('lists files in subdirectory', async () => {
      await executeTool(
        'write_file',
        JSON.stringify({ path: 'subdir/a.txt', content: 'a' }),
        'list-sub-test',
      );
      await executeTool(
        'write_file',
        JSON.stringify({ path: 'subdir/b.txt', content: 'b' }),
        'list-sub-test',
      );

      const result = await executeTool(
        'list_files',
        JSON.stringify({ path: 'subdir' }),
        'list-sub-test',
      );
      expect(result).toContain('a.txt');
      expect(result).toContain('b.txt');
    });

    it('returns error for non-existent subdirectory', async () => {
      const result = await executeTool(
        'list_files',
        JSON.stringify({ path: 'nonexistent' }),
        CONV_ID,
      );
      expect(result).toContain('Error');
      expect(result).toContain('not found');
    });
  });

  describe('notify tool', () => {
    it('returns notification sent status', async () => {
      const result = await executeTool(
        'notify',
        JSON.stringify({ title: 'Test', body: 'Hello' }),
        CONV_ID,
      );
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('notification_displayed');
      expect(parsed.title).toBe('Test');
      expect(parsed.body).toBe('Hello');
      expect(executeNativeTool).toHaveBeenCalledWith(
        'notification_send',
        JSON.stringify({ title: 'Test', body: 'Hello' }),
      );
    });
  });

  describe('image_generate tool', () => {
    it('generates an image with the active provider', async () => {
      const result = await executeTool(
        'image_generate',
        JSON.stringify({ prompt: 'A cat' }),
        CONV_ID,
      );
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('generated');
      expect(parsed.providerId).toBe('openai');
      expect(parsed.fileUri).toBe('file:///mock/cache/generated.png');
      expect(generateImage).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'openai', apiKey: 'sk-image' }),
        { prompt: 'A cat', conversationId: CONV_ID },
      );
    });

    it('routes image generation outputs to the provided workspace conversation', async () => {
      await executeTool(
        'image_generate',
        JSON.stringify({ prompt: 'A delegated cat' }),
        'worker-session',
        { workspaceConversationId: 'parent-conversation' },
      );

      expect(generateImage).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'openai', apiKey: 'sk-image' }),
        { prompt: 'A delegated cat', conversationId: 'parent-conversation' },
      );
    });
  });

  describe('image_edit tool', () => {
    it('edits an image with the active provider', async () => {
      const result = await executeTool(
        'image_edit',
        JSON.stringify({
          prompt: 'Add a red hat while keeping the cat unchanged',
          imagePath: 'inputs/cat.png',
          maskPath: 'inputs/cat-mask.png',
          inputFidelity: 'high',
        }),
        CONV_ID,
      );

      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('edited');
      expect(parsed.providerId).toBe('openai');
      expect(parsed.fileUri).toBe('file:///mock/cache/edited.png');
      expect(editImage).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'openai', apiKey: 'sk-image' }),
        expect.objectContaining({
          prompt: 'Add a red hat while keeping the cat unchanged',
          conversationId: CONV_ID,
          images: [
            expect.objectContaining({
              uri: `file:///mock/documents/workspace/${CONV_ID}/inputs/cat.png`,
              name: 'cat.png',
            }),
          ],
          mask: expect.objectContaining({
            uri: `file:///mock/documents/workspace/${CONV_ID}/inputs/cat-mask.png`,
            name: 'cat-mask.png',
          }),
          inputFidelity: 'high',
        }),
      );
    });

    it('routes image edit outputs to the provided workspace conversation', async () => {
      await executeTool(
        'image_edit',
        JSON.stringify({
          prompt: 'Replace the background with a studio backdrop',
          imagePath: 'worker/source.png',
        }),
        'worker-session',
        { workspaceConversationId: 'parent-conversation' },
      );

      expect(editImage).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'openai', apiKey: 'sk-image' }),
        expect.objectContaining({
          conversationId: 'parent-conversation',
          images: [
            expect.objectContaining({
              uri: 'file:///mock/documents/workspace/parent-conversation/worker/source.png',
            }),
          ],
        }),
      );
    });
  });

  describe('workspace conversation routing', () => {
    it('writes local workspace files into the provided workspace conversation', async () => {
      await executeTool(
        'write_file',
        JSON.stringify({ path: 'nested/worker-output.txt', content: 'delegated change' }),
        'worker-session',
        { workspaceConversationId: 'parent-conversation' },
      );

      const store = __getStore();
      expect(
        store['file:///mock/documents/workspace/parent-conversation/nested/worker-output.txt'],
      ).toBe('delegated change');
      expect(
        store['file:///mock/documents/workspace/worker-session/nested/worker-output.txt'],
      ).toBeUndefined();
    });

    it('falls back to the session workspace for read-only worker files when the shared workspace lacks them', async () => {
      await executeTool(
        'write_file',
        JSON.stringify({ path: 'skills/demo/SKILL.md', content: 'Skill instructions' }),
        'worker-session',
      );

      const result = await executeTool(
        'read_file',
        JSON.stringify({ path: 'skills/demo/SKILL.md' }),
        'worker-session',
        {
          workspaceConversationId: 'parent-conversation',
          workspaceReadFallbackConversationId: 'worker-session',
        },
      );

      expect(result).toBe('Skill instructions');
    });

    it('falls back to the session workspace for JavaScript path execution when the shared workspace lacks worker files', async () => {
      await executeTool(
        'write_file',
        JSON.stringify({
          path: 'tools/double.js',
          content: 'module.exports = (value) => value * 2;',
        }),
        'worker-session',
      );
      await executeTool(
        'write_file',
        JSON.stringify({
          path: 'tools/main.js',
          content: 'const double = require("./double"); module.exports = double(21);',
        }),
        'worker-session',
      );

      const result = await executeTool(
        'javascript',
        JSON.stringify({ path: 'tools/main.js' }),
        'worker-session',
        {
          workspaceConversationId: 'parent-conversation',
          workspaceReadFallbackConversationId: 'worker-session',
        },
      );

      expect(result).toBe('42');
    });
  });

  describe('cron tool', () => {
    it('creates a scheduled task via cron alias', async () => {
      const result = await executeTool(
        'cron',
        JSON.stringify({ schedule: '0 8 * * *', prompt: 'Daily reminder' }),
        CONV_ID,
      );
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('task_created');
      expect(parsed.schedule).toBe('0 8 * * *');
    });

    it('uses command field as fallback for prompt', async () => {
      const result = await executeTool(
        'cron',
        JSON.stringify({ schedule: '*/5 * * * *', command: 'Check status' }),
        CONV_ID,
      );
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('task_created');
    });
  });

  describe('native tool routing', () => {
    it('routes clipboard_read to native executor', async () => {
      const result = await executeTool('clipboard_read', '{}', CONV_ID);
      // Will execute via native executor — clipboard mock returns empty
      expect(typeof result).toBe('string');
    });
  });

  describe('fetch_url with custom method and headers', () => {
    const originalFetch = global.fetch;
    beforeEach(() => {
      global.fetch = jest.fn();
    });
    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('passes custom method and headers', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        status: 200,
        text: () => Promise.resolve('response'),
      });

      const result = await executeTool(
        'fetch_url',
        JSON.stringify({
          url: 'https://api.example.com',
          method: 'post',
          headers: { 'Content-Type': 'application/json' },
          body: '{"key":"value"}',
        }),
        CONV_ID,
      );
      expect(result).toContain('HTTP 200');
      expect((global.fetch as jest.Mock).mock.calls[0][1].method).toBe('POST');
      expect((global.fetch as jest.Mock).mock.calls[0][1].credentials).toBe('omit');
      expect((global.fetch as jest.Mock).mock.calls[0][1].headers).toEqual({
        'Content-Type': 'application/json',
      });
      expect((global.fetch as jest.Mock).mock.calls[0][1].body).toBe('{"key":"value"}');
    });

    it('stringifies non-string header values', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        status: 200,
        text: () => Promise.resolve('response'),
      });

      await executeTool(
        'fetch_url',
        JSON.stringify({
          url: 'https://api.example.com',
          headers: { 'X-Retry-Count': 3, Authorization: 'Bearer token' },
        }),
        CONV_ID,
      );

      expect((global.fetch as jest.Mock).mock.calls[0][1].headers).toEqual({
        'X-Retry-Count': '3',
        Authorization: 'Bearer token',
      });
    });
  });

  describe('permission denied', () => {
    it('returns error when tool is not allowed', async () => {
      const { useToolPermissionsStore } = require('../../src/services/security/permissions');
      const { setPermission } = useToolPermissionsStore.getState();
      setPermission('write_file', false);

      const result = await executeTool(
        'write_file',
        JSON.stringify({ path: 'test.txt', content: 'no' }),
        CONV_ID,
      );
      expect(result).toContain('not allowed');

      // Clean up
      useToolPermissionsStore.getState().reset();
    });
  });

  describe('cron CRUD actions', () => {
    it('lists jobs when empty', async () => {
      const result = await executeTool('cron', JSON.stringify({ action: 'list' }), CONV_ID);
      const parsed = JSON.parse(result);
      expect(parsed.jobs).toEqual([]);
    });

    it('delete requires id', async () => {
      const result = await executeTool('cron', JSON.stringify({ action: 'delete' }), CONV_ID);
      expect(result).toContain('id is required');
    });

    it('enable requires id', async () => {
      const result = await executeTool('cron', JSON.stringify({ action: 'enable' }), CONV_ID);
      expect(result).toContain('id is required');
    });

    it('disable requires id', async () => {
      const result = await executeTool('cron', JSON.stringify({ action: 'disable' }), CONV_ID);
      expect(result).toContain('id is required');
    });

    it('run requires id', async () => {
      const result = await executeTool('cron', JSON.stringify({ action: 'run' }), CONV_ID);
      expect(result).toContain('id is required');
    });

    it('run returns error for non-existent job', async () => {
      const result = await executeTool(
        'cron',
        JSON.stringify({ action: 'run', id: 'nope' }),
        CONV_ID,
      );
      expect(result).toContain('not found');
    });

    it('rejects unknown action', async () => {
      const result = await executeTool('cron', JSON.stringify({ action: 'explode' }), CONV_ID);
      expect(result).toContain('unknown cron action');
    });
  });

  describe('unknown tool', () => {
    it('returns error for unknown tool name', async () => {
      const result = await executeTool('nonexistent_tool_xyz', '{}', CONV_ID);
      expect(result).toContain('unknown tool');
    });
  });

  describe('invalid JSON args', () => {
    it('handles malformed JSON gracefully', async () => {
      const result = await executeTool('write_file', 'not-json{{{', CONV_ID);
      // Robust arg parsing falls back to {} — tool runs with no args
      expect(typeof result).toBe('string');
    });
  });
});
