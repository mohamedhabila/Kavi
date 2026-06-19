import type { Skill } from '../../src/services/skills/types';
import {
  __getStore,
  executeTool,
  getSurface,
  indexMemoryToSqlite,
  mockChatStoreState,
  mockListWorkspaceDirectory,
  mockReadWorkspaceFile,
  mockSettingsState,
  mockWriteWorkspaceFile,
  registerSkill,
  REMOTE_WORKSPACE_TARGET,
  sqliteHybridSearch,
  unregisterSkill,
} from '../helpers/toolsExecutorHarness';

describe('executeTool', () => {
  const CONV_ID = 'test-conversation';

  it('derives hybrid memory search from the active provider when embeddings are supported', async () => {
    sqliteHybridSearch.mockResolvedValueOnce([
      { source: 'MEMORY.md', snippet: 'remember this detail', score: 0.92, scope: 'global' },
    ]);

    const result = await executeTool(
      'memory_search',
      JSON.stringify({ query: 'remember this detail' }),
      CONV_ID,
    );
    const parsed = JSON.parse(result);

    expect(parsed.method).toBe('hybrid');
    expect(indexMemoryToSqlite).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openai',
        apiKey: 'sk-image',
        baseUrl: 'https://api.openai.com/v1',
      }),
      undefined,
      expect.objectContaining({
        scope: 'all',
      }),
    );
    expect(sqliteHybridSearch).toHaveBeenCalledWith(
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
      const parsed = JSON.parse(result);
      expect(parsed).toEqual(
        expect.objectContaining({
          status: 'written',
          path: 'test.txt',
          size: 11,
          sha256: '64ec88ca00b268e5ba1a35678a1b5316d212f4f366b2477232534a8aeca37f3c',
        }),
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

  describe('attached workspace target routing', () => {
    beforeEach(() => {
      mockChatStoreState.conversations = [
        {
          id: CONV_ID,
          workspaceTargetId: REMOTE_WORKSPACE_TARGET.id,
        },
      ];
      mockSettingsState.workspaceTargets = [REMOTE_WORKSPACE_TARGET as any];
    });

    it('routes read_file through the attached workspace target', async () => {
      mockReadWorkspaceFile.mockResolvedValue({
        path: 'docs/notes.md',
        content: 'remote workspace notes',
        size: 22,
      });

      const result = await executeTool(
        'read_file',
        JSON.stringify({ path: 'docs/notes.md' }),
        CONV_ID,
      );

      expect(result).toBe('remote workspace notes');
      expect(mockReadWorkspaceFile).toHaveBeenCalledWith(
        expect.objectContaining({ id: REMOTE_WORKSPACE_TARGET.id }),
        'docs/notes.md',
      );
    });

    it('routes write_file through the attached workspace target', async () => {
      mockWriteWorkspaceFile.mockResolvedValue({
        path: 'src/app.ts',
        size: 17,
      });

      const result = await executeTool(
        'write_file',
        JSON.stringify({ path: 'src/app.ts', content: 'export default 1;' }),
        CONV_ID,
      );

      expect(result).toContain('Wrote 17 chars to src/app.ts');
      expect(mockWriteWorkspaceFile).toHaveBeenCalledWith(
        expect.objectContaining({ id: REMOTE_WORKSPACE_TARGET.id }),
        'src/app.ts',
        'export default 1;',
      );
      expect(
        __getStore()['file:///mock/documents/workspace/test-conversation/src/app.ts'],
      ).toBeUndefined();
    });

    it('routes list_files through the attached workspace target', async () => {
      mockListWorkspaceDirectory.mockResolvedValue({
        path: '.',
        entries: [
          { name: 'src', isDirectory: true },
          { name: 'README.md', isDirectory: false },
        ],
      });

      const result = await executeTool('list_files', JSON.stringify({}), CONV_ID);

      expect(result).toContain('src/');
      expect(result).toContain('README.md');
      expect(mockListWorkspaceDirectory).toHaveBeenCalledWith(
        expect.objectContaining({ id: REMOTE_WORKSPACE_TARGET.id }),
        '.',
      );
    });

    it('routes file_edit through the attached workspace target', async () => {
      mockReadWorkspaceFile.mockResolvedValue({
        path: 'src/app.ts',
        content: 'const value = 1;\n',
        size: 17,
      });
      mockWriteWorkspaceFile.mockResolvedValue({
        path: 'src/app.ts',
        size: 17,
      });

      const result = await executeTool(
        'file_edit',
        JSON.stringify({
          path: 'src/app.ts',
          oldText: '1',
          newText: '2',
        }),
        CONV_ID,
      );

      expect(result).toContain('Successfully edited src/app.ts');
      expect(mockWriteWorkspaceFile).toHaveBeenCalledWith(
        expect.objectContaining({ id: REMOTE_WORKSPACE_TARGET.id }),
        'src/app.ts',
        'const value = 2;\n',
      );
    });

    it('routes text_search through the attached workspace target', async () => {
      mockListWorkspaceDirectory.mockImplementation(async (_target: unknown, path: string) => {
        if (path === '.') {
          return {
            path: '.',
            entries: [
              { name: 'src', isDirectory: true },
              { name: 'README.md', isDirectory: false },
            ],
          };
        }

        if (path === 'src') {
          return {
            path: 'src',
            entries: [{ name: 'app.ts', isDirectory: false }],
          };
        }

        throw new Error(`directory not found: ${path}`);
      });
      mockReadWorkspaceFile.mockImplementation(async (_target: unknown, path: string) => {
        if (path === 'README.md') {
          return { path, content: 'No match here', size: 13 };
        }

        if (path === 'src/app.ts') {
          return { path, content: 'const needle = true;\n', size: 21 };
        }

        throw new Error(`file not found: ${path}`);
      });

      const result = await executeTool('text_search', JSON.stringify({ query: 'needle' }), CONV_ID);

      expect(result).toContain('src/app.ts');
      expect(result).toContain('needle');
      expect(mockListWorkspaceDirectory).toHaveBeenCalledWith(
        expect.objectContaining({ id: REMOTE_WORKSPACE_TARGET.id }),
        '.',
      );
      expect(mockReadWorkspaceFile).toHaveBeenCalledWith(
        expect.objectContaining({ id: REMOTE_WORKSPACE_TARGET.id }),
        'src/app.ts',
      );
    });
  });
});
