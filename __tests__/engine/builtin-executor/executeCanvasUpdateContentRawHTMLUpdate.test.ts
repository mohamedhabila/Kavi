// ---------------------------------------------------------------------------
// Tests - Builtin Tool Executor: executeCanvasUpdate — content (raw HTML) update
// ---------------------------------------------------------------------------

import { executeCanvasUpdate } from '../../helpers/builtinExecutorHarness';

describe('Builtin Tool Executor', () => {
  describe('executeCanvasUpdate — content (raw HTML) update', () => {
    it('sends updateContent message when content field provided', async () => {
      const { getSurface, processCanvasMessage } = require('../../../src/services/canvas/renderer');
      getSurface.mockImplementation((id: string) =>
        id === 'surf-html' ? { id: 'surf-html', title: 'HTML Surface' } : undefined,
      );
      const result = await executeCanvasUpdate({
        surfaceId: 'surf-html',
        content: '<h1>Updated HTML</h1>',
      });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('updated');
      expect(processCanvasMessage).toHaveBeenCalledWith({
        type: 'updateContent',
        surfaceId: 'surf-html',
        rawHtml: '<h1>Updated HTML</h1>',
        sourceBundle: { sourceType: 'content' },
      });
    });

    it('sends both updateContent and updateComponents when both provided', async () => {
      const { getSurface, processCanvasMessage } = require('../../../src/services/canvas/renderer');
      getSurface.mockImplementation((id: string) =>
        id === 'surf-both' ? { id: 'surf-both', title: 'Both' } : undefined,
      );
      const result = await executeCanvasUpdate({
        surfaceId: 'surf-both',
        content: '<div>HTML</div>',
        components: [{ id: 'c1', type: 'text', props: { text: 'Hi' } }],
      });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('updated');
      expect(processCanvasMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'updateContent' }),
      );
      expect(processCanvasMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'updateComponents' }),
      );
    });

    it('loads replacement HTML from a conversation workspace filePath', async () => {
      const { getSurface, processCanvasMessage } = require('../../../src/services/canvas/renderer');
      getSurface.mockImplementation((id: string) =>
        id === 'surf-file' ? { id: 'surf-file', title: 'File Surface' } : undefined,
      );

      const result = await executeCanvasUpdate(
        {
          surfaceId: 'surf-file',
          filePath: 'canvas/updated.html',
        } as any,
        {
          conversationId: 'conv-1',
          readConversationFile: async () =>
            '<html><body><main>Updated from file</main></body></html>',
        },
      );
      const parsed = JSON.parse(result);

      expect(parsed.status).toBe('updated');
      expect(parsed.appliedUpdates).toContain('filePath:canvas/updated.html');
      expect(parsed.sourceBundle).toEqual(
        expect.objectContaining({
          sourceType: 'file',
          filePath: 'canvas/updated.html',
          entryFilePath: 'canvas/updated.html',
          importedFiles: ['canvas/updated.html'],
        }),
      );
      expect(parsed.sourceBundle.bundleEntryUri).toContain('canvas-bundles-v1');
      expect(processCanvasMessage).toHaveBeenCalledWith({
        type: 'updateContent',
        surfaceId: 'surf-file',
        rawHtml: '<html><body><main>Updated from file</main></body></html>',
        sourceBundle: expect.objectContaining({
          sourceType: 'file',
          filePath: 'canvas/updated.html',
          entryFilePath: 'canvas/updated.html',
          importedFiles: ['canvas/updated.html'],
        }),
      });
    });

    it('rejects canvas_update when both content and filePath are provided', async () => {
      const { getSurface } = require('../../../src/services/canvas/renderer');
      getSurface.mockImplementation((id: string) =>
        id === 'surf-bad' ? { id: 'surf-bad', title: 'Bad' } : undefined,
      );

      const result = await executeCanvasUpdate(
        {
          surfaceId: 'surf-bad',
          content: '<html><body>inline</body></html>',
          filePath: 'canvas/updated.html',
        } as any,
        {
          readConversationFile: async () => '<html><body>file</body></html>',
        },
      );

      expect(result).toContain('content, filePath, or directoryPath');
    });

    it('rejects canvas_update when filePath and contentEdits are both provided', async () => {
      const { getSurface } = require('../../../src/services/canvas/renderer');
      getSurface.mockImplementation((id: string) =>
        id === 'surf-edits'
          ? {
              id: 'surf-edits',
              title: 'Edits',
              renderMode: 'html',
              rawHtml: '<div>old</div>',
            }
          : undefined,
      );

      const result = await executeCanvasUpdate(
        {
          surfaceId: 'surf-edits',
          filePath: 'canvas/updated.html',
          contentEdits: [{ oldText: 'old', newText: 'new' }],
        } as any,
        {
          readConversationFile: async () => '<html><body>file</body></html>',
        },
      );

      expect(result).toContain('content, filePath, directoryPath, or contentEdits');
    });

    it('rejects canvas_update filePath without workspace context', async () => {
      const { getSurface } = require('../../../src/services/canvas/renderer');
      getSurface.mockImplementation((id: string) =>
        id === 'surf-noctx' ? { id: 'surf-noctx', title: 'No Context' } : undefined,
      );

      const result = await executeCanvasUpdate({
        surfaceId: 'surf-noctx',
        filePath: 'canvas/updated.html',
      } as any);

      expect(result).toContain('requires an active conversation workspace');
    });
  });
});
