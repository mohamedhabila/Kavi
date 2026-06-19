import {
  __getStore,
  editImage,
  executeNativeTool,
  executeTool,
  generateImage,
} from '../helpers/toolsExecutorHarness';

describe('executeTool additional routes', () => {
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
        'notification_send',
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
      expect(typeof result).toBe('string');
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
      expect(typeof result).toBe('string');
    });
  });
});
