// ---------------------------------------------------------------------------
// Tests - Builtin Tool Executor: executeCanvasUpdate
// ---------------------------------------------------------------------------

import { executeCanvasUpdate } from '../../helpers/builtinExecutorHarness';

describe('Builtin Tool Executor', () => {
  describe('executeCanvasUpdate', () => {
    it('returns error for non-existent surface', async () => {
      const result = await executeCanvasUpdate({
        surfaceId: 'nonexistent',
        components: [{ id: 'c1', type: 'text', props: { text: 'v2' } }],
      });
      expect(result).toContain('Error');
    });

    it('updates an existing surface', async () => {
      const { getSurface } = require('../../../src/services/canvas/renderer');
      getSurface.mockImplementation((id: string) =>
        id === 'surf-1'
          ? {
              id: 'surf-1',
              title: 'Old',
              components: [{ id: 'c1', type: 'text', props: { text: 'v1' } }],
              active: true,
            }
          : undefined,
      );
      const result = await executeCanvasUpdate({
        surfaceId: 'surf-1',
        components: [{ id: 'c1', type: 'text', props: { text: 'v2' } }],
      });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('updated');
    });

    it('updates with data operations', async () => {
      const { getSurface } = require('../../../src/services/canvas/renderer');
      getSurface.mockImplementation((id: string) =>
        id === 'surf-2'
          ? {
              id: 'surf-2',
              title: 'Data',
              components: [],
              active: true,
              data: {},
            }
          : undefined,
      );
      const result = await executeCanvasUpdate({
        surfaceId: 'surf-2',
        dataOperations: [{ path: 'items', op: 'set', value: [1, 2] }],
      });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('updated');
    });

    it('accepts alias fields for html and patch operations', async () => {
      const { getSurface, processCanvasMessage } = require('../../../src/services/canvas/renderer');
      getSurface.mockImplementation((id: string) =>
        id === 'surf-3'
          ? {
              id: 'surf-3',
              title: 'Alias Update',
              components: [],
              active: true,
              data: {},
            }
          : undefined,
      );

      const result = await executeCanvasUpdate({
        canvasId: 'surf-3',
        html: '<html><body>Updated</body></html>',
        patch: [{ path: '/items', op: 'set', value: [1, 2, 3] }],
      } as any);
      const parsed = JSON.parse(result);

      expect(parsed.status).toBe('updated');
      expect(processCanvasMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'updateContent',
          surfaceId: 'surf-3',
          rawHtml: '<html><body>Updated</body></html>',
          sourceBundle: { sourceType: 'content' },
        }),
      );
      expect(processCanvasMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'updateDataModel',
          surfaceId: 'surf-3',
          operations: [{ op: 'replace', path: '/items', value: [1, 2, 3] }],
        }),
      );
    });

    it('applies focused contentEdits to an existing html canvas', async () => {
      const { getSurface, processCanvasMessage } = require('../../../src/services/canvas/renderer');
      getSurface.mockImplementation((id: string) =>
        id === 'surf-html'
          ? {
              id: 'surf-html',
              title: 'Focused HTML',
              renderMode: 'html',
              rawHtml: '<section><h1>Old title</h1><p>Body</p></section>',
              components: [],
              dataModel: {},
            }
          : undefined,
      );

      const result = await executeCanvasUpdate({
        surfaceId: 'surf-html',
        contentEdits: [{ oldText: '<h1>Old title</h1>', newText: '<h1>New title</h1>' }],
      } as any);
      const parsed = JSON.parse(result);

      expect(parsed.status).toBe('updated');
      expect(parsed.appliedUpdates).toContain('contentEdits:1');
      expect(processCanvasMessage).toHaveBeenCalledWith({
        type: 'updateContent',
        surfaceId: 'surf-html',
        rawHtml: '<section><h1>New title</h1><p>Body</p></section>',
        sourceBundle: { sourceType: 'content' },
      });
    });

    it('updates an html canvas from directoryPath', async () => {
      const { getSurface, processCanvasMessage } = require('../../../src/services/canvas/renderer');
      getSurface.mockImplementation((id: string) =>
        id === 'surf-dir'
          ? {
              id: 'surf-dir',
              title: 'Directory Update',
              renderMode: 'html',
              rawHtml: '<html><body>Old</body></html>',
              components: [],
              dataModel: {},
            }
          : undefined,
      );

      const result = await executeCanvasUpdate(
        {
          surfaceId: 'surf-dir',
          directoryPath: 'canvas/app',
        } as any,
        {
          conversationId: 'conv-1',
          listConversationDirectory: async (path: string) => {
            if (path === 'canvas/app') {
              return [
                { path: 'canvas/app/index.html', kind: 'file' },
                { path: 'canvas/app/styles.css', kind: 'file' },
              ];
            }
            return [];
          },
          readConversationFile: async (path: string) => {
            switch (path) {
              case 'canvas/app/index.html':
                return '<html><head><title>Updated Dir</title><link rel="stylesheet" href="./styles.css"></head><body><main>Updated</main></body></html>';
              case 'canvas/app/styles.css':
                return 'main { color: red; }';
              default:
                throw new Error(`unexpected path: ${path}`);
            }
          },
        },
      );
      const parsed = JSON.parse(result);

      expect(parsed.status).toBe('updated');
      expect(parsed.appliedUpdates).toContain('directoryPath:canvas/app');
      expect(parsed.sourceBundle).toEqual(
        expect.objectContaining({
          sourceType: 'directory',
          directoryPath: 'canvas/app',
          entryFilePath: 'canvas/app/index.html',
          importedFiles: expect.arrayContaining(['canvas/app/index.html', 'canvas/app/styles.css']),
        }),
      );
      expect(processCanvasMessage).toHaveBeenCalledWith({
        type: 'updateContent',
        surfaceId: 'surf-dir',
        rawHtml: expect.stringContaining('<link rel="stylesheet" href="./styles.css">'),
        sourceBundle: expect.objectContaining({
          sourceType: 'directory',
          directoryPath: 'canvas/app',
          entryFilePath: 'canvas/app/index.html',
          importedFiles: expect.arrayContaining(['canvas/app/index.html', 'canvas/app/styles.css']),
        }),
      });
    });

    it('applies componentOperations to an existing component canvas', async () => {
      const { getSurface, processCanvasMessage } = require('../../../src/services/canvas/renderer');
      getSurface.mockImplementation((id: string) =>
        id === 'surf-components'
          ? {
              id: 'surf-components',
              title: 'Focused Components',
              renderMode: 'components',
              components: [{ id: 'c1', type: 'text', props: { text: 'before' } }],
              dataModel: {},
            }
          : undefined,
      );

      const result = await executeCanvasUpdate({
        surfaceId: 'surf-components',
        componentOperations: [{ op: 'replace', path: '/0/props/text', value: 'after' }],
      } as any);
      const parsed = JSON.parse(result);

      expect(parsed.status).toBe('updated');
      expect(parsed.appliedUpdates).toContain('componentOperations:1');
      expect(processCanvasMessage).toHaveBeenCalledWith({
        type: 'updateComponents',
        surfaceId: 'surf-components',
        components: [{ id: 'c1', type: 'text', props: { text: 'after' } }],
      });
    });

    it('fails html contentEdits atomically before sending updates', async () => {
      const { getSurface, processCanvasMessage } = require('../../../src/services/canvas/renderer');
      getSurface.mockImplementation((id: string) =>
        id === 'surf-atomic'
          ? {
              id: 'surf-atomic',
              title: 'Atomic HTML',
              renderMode: 'html',
              rawHtml: '<div>alpha beta</div>',
              components: [],
              dataModel: {},
            }
          : undefined,
      );

      const result = await executeCanvasUpdate({
        surfaceId: 'surf-atomic',
        contentEdits: [
          { oldText: 'alpha', newText: 'ALPHA' },
          { oldText: 'missing', newText: 'noop' },
        ],
      } as any);

      expect(result).toContain('did not match oldText');
      expect(processCanvasMessage).not.toHaveBeenCalled();
    });
  });
});
