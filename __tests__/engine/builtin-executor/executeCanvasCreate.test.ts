// ---------------------------------------------------------------------------
// Tests - Builtin Tool Executor: executeCanvasCreate
// ---------------------------------------------------------------------------

import { executeCanvasCreate } from '../../helpers/builtinExecutorHarness';

describe('Builtin Tool Executor', () => {
  describe('executeCanvasCreate', () => {
    it('creates a canvas surface', async () => {
      const result = await executeCanvasCreate({
        title: 'Test Canvas',
        components: [{ id: 'c1', type: 'text', props: { text: 'Hello' } }],
      });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('created');
      expect(parsed.surfaceId).toContain('surface-');
    });

    it('handles missing components', async () => {
      const result = await executeCanvasCreate({ title: 'Empty', components: [] });
      expect(typeof result).toBe('string');
    });

    it('normalizes HTML aliases and derives the title when needed', async () => {
      const { processCanvasMessage } = require('../../../src/services/canvas/renderer');

      const result = await executeCanvasCreate({
        html: '<html><head><title>Alias Title</title></head><body><h1>Hello</h1></body></html>',
      } as any);
      const parsed = JSON.parse(result);

      expect(parsed.status).toBe('created');
      expect(parsed.title).toBe('Alias Title');
      expect(parsed.renderMode).toBe('html');
      expect(processCanvasMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'createSurface',
          title: 'Alias Title',
          rawHtml: expect.stringContaining('<title>Alias Title</title>'),
        }),
      );
    });

    it('loads HTML from a conversation workspace filePath', async () => {
      const { processCanvasMessage } = require('../../../src/services/canvas/renderer');

      const result = await executeCanvasCreate(
        {
          filePath: '/canvas/preview.html',
        } as any,
        {
          conversationId: 'conv-1',
          readConversationFile: async () =>
            '<html><head><title>File Canvas</title></head><body><h1>Hi</h1></body></html>',
        },
      );
      const parsed = JSON.parse(result);

      expect(parsed.status).toBe('created');
      expect(parsed.title).toBe('File Canvas');
      expect(parsed.renderMode).toBe('html');
      expect(parsed.sourceBundle).toEqual(
        expect.objectContaining({
          sourceType: 'file',
          filePath: 'canvas/preview.html',
          entryFilePath: 'canvas/preview.html',
          importedFiles: ['canvas/preview.html'],
        }),
      );
      expect(parsed.sourceBundle.bundleEntryUri).toContain('canvas-bundles-v1');
      expect(parsed.sourceBundle.bundleRootUri).toContain('canvas-bundles-v1');
      expect(processCanvasMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'createSurface',
          title: 'File Canvas',
          rawHtml: expect.stringContaining('<body><h1>Hi</h1></body>'),
        }),
      );
    });

    it('persists local stylesheet and script files referenced by filePath HTML into a bundle', async () => {
      const { processCanvasMessage } = require('../../../src/services/canvas/renderer');

      const result = await executeCanvasCreate(
        {
          filePath: 'canvas/app/index.html',
        } as any,
        {
          conversationId: 'conv-1',
          readConversationFile: async (path: string) => {
            switch (path) {
              case 'canvas/app/index.html':
                return '<html><head><title>Bundled</title><link rel="stylesheet" href="./styles.css"></head><body><h1>Hi</h1><script src="./app.js"></script></body></html>';
              case 'canvas/app/styles.css':
                return 'body { background: #123456; color: white; }';
              case 'canvas/app/app.js':
                return 'window.__CANVAS_READY__ = true;';
              default:
                throw new Error(`unexpected path: ${path}`);
            }
          },
        },
      );
      const parsed = JSON.parse(result);

      expect(parsed.status).toBe('created');
      expect(parsed.sourceBundle).toEqual(
        expect.objectContaining({
          sourceType: 'file',
          filePath: 'canvas/app/index.html',
          entryFilePath: 'canvas/app/index.html',
          importedFiles: expect.arrayContaining([
            'canvas/app/index.html',
            'canvas/app/styles.css',
            'canvas/app/app.js',
          ]),
        }),
      );
      expect(parsed.sourceBundle.bundleEntryUri).toContain('canvas-bundles-v1');
      expect(processCanvasMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'createSurface',
          rawHtml: expect.stringContaining('<script src="./app.js"></script>'),
          sourceBundle: expect.objectContaining({
            sourceType: 'file',
            filePath: 'canvas/app/index.html',
            entryFilePath: 'canvas/app/index.html',
            importedFiles: expect.arrayContaining([
              'canvas/app/index.html',
              'canvas/app/styles.css',
              'canvas/app/app.js',
            ]),
          }),
        }),
      );
    });

    it('loads a multi-file canvas from directoryPath', async () => {
      const { processCanvasMessage } = require('../../../src/services/canvas/renderer');

      const result = await executeCanvasCreate(
        {
          directoryPath: 'canvas/site',
        } as any,
        {
          conversationId: 'conv-1',
          listConversationDirectory: async (path: string) => {
            if (path === 'canvas/site') {
              return [
                { path: 'canvas/site/index.html', kind: 'file' },
                { path: 'canvas/site/styles.css', kind: 'file' },
                { path: 'canvas/site/app.js', kind: 'file' },
              ];
            }
            return [];
          },
          readConversationFile: async (path: string) => {
            switch (path) {
              case 'canvas/site/index.html':
                return '<html><head><title>Directory Canvas</title><link rel="stylesheet" href="./styles.css"></head><body><main>Directory app</main><script src="./app.js"></script></body></html>';
              case 'canvas/site/styles.css':
                return 'main { font-weight: 700; }';
              case 'canvas/site/app.js':
                return 'window.directoryAppLoaded = true;';
              default:
                throw new Error(`unexpected path: ${path}`);
            }
          },
        },
      );
      const parsed = JSON.parse(result);

      expect(parsed.status).toBe('created');
      expect(parsed.title).toBe('Directory Canvas');
      expect(parsed.sourceBundle).toEqual(
        expect.objectContaining({
          sourceType: 'directory',
          directoryPath: 'canvas/site',
          entryFilePath: 'canvas/site/index.html',
          importedFiles: expect.arrayContaining([
            'canvas/site/index.html',
            'canvas/site/styles.css',
            'canvas/site/app.js',
          ]),
        }),
      );
      expect(parsed.sourceBundle.bundleEntryUri).toContain('canvas-bundles-v1');
      expect(processCanvasMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'createSurface',
          sourceBundle: expect.objectContaining({
            sourceType: 'directory',
            directoryPath: 'canvas/site',
            entryFilePath: 'canvas/site/index.html',
            importedFiles: expect.arrayContaining([
              'canvas/site/index.html',
              'canvas/site/styles.css',
              'canvas/site/app.js',
            ]),
          }),
        }),
      );
    });

    it('recursively bundles supported files from directoryPath', async () => {
      const result = await executeCanvasCreate(
        {
          directoryPath: 'canvas/site',
        } as any,
        {
          conversationId: 'conv-1',
          listConversationDirectory: async (path: string) => {
            if (path === 'canvas/site') {
              return [
                { path: 'canvas/site/index.html', kind: 'file' },
                { path: 'canvas/site/styles.css', kind: 'file' },
                { path: 'canvas/site/nested', kind: 'directory' },
              ];
            }

            if (path === 'canvas/site/nested') {
              return [
                { path: 'canvas/site/nested/feature.js', kind: 'file' },
                { path: 'canvas/site/nested/other.html', kind: 'file' },
                { path: 'canvas/site/nested/ignore.txt', kind: 'file' },
              ];
            }

            return [];
          },
          readConversationFile: async (path: string) => {
            switch (path) {
              case 'canvas/site/index.html':
                return '<html><body><main>Directory app</main></body></html>';
              case 'canvas/site/styles.css':
                return 'main { font-weight: 700; }';
              case 'canvas/site/nested/feature.js':
                return 'window.featureReady = true;';
              case 'canvas/site/nested/other.html':
                return '<html><body>Nested page</body></html>';
              default:
                throw new Error(`unexpected path: ${path}`);
            }
          },
        },
      );
      const parsed = JSON.parse(result);

      expect(parsed.sourceBundle.importedFiles).toEqual([
        'canvas/site/index.html',
        'canvas/site/nested/feature.js',
        'canvas/site/nested/other.html',
        'canvas/site/styles.css',
      ]);
    });

    it('rejects ambiguous directoryPath inputs without entryFile', async () => {
      const result = await executeCanvasCreate(
        {
          directoryPath: 'canvas/site',
        } as any,
        {
          conversationId: 'conv-1',
          listConversationDirectory: async (path: string) => {
            if (path === 'canvas/site') {
              return [
                { path: 'canvas/site/a.html', kind: 'file' },
                { path: 'canvas/site/b.html', kind: 'file' },
              ];
            }
            return [];
          },
          readConversationFile: async () => '<html></html>',
        },
      );

      expect(result).toContain('multiple HTML files');
      expect(result).toContain('entryFile');
    });

    it('rejects canvas_create when both content and filePath are provided', async () => {
      const result = await executeCanvasCreate(
        {
          title: 'Bad Canvas',
          content: '<html><body>inline</body></html>',
          filePath: 'canvas/preview.html',
        } as any,
        {
          readConversationFile: async () => '<html><body>file</body></html>',
        },
      );

      expect(result).toContain('content, filePath, or directoryPath');
    });

    it('rejects non-html file paths for canvas_create', async () => {
      const result = await executeCanvasCreate(
        {
          title: 'Bad Canvas',
          filePath: 'canvas/preview.txt',
        } as any,
        {
          readConversationFile: async () => '<html><body>file</body></html>',
        },
      );

      expect(result).toContain('.html or .htm');
    });

    it('rejects non-html file contents for canvas_create', async () => {
      const result = await executeCanvasCreate(
        {
          title: 'Bad Canvas',
          filePath: 'canvas/preview.html',
        } as any,
        {
          readConversationFile: async () => 'just text',
        },
      );

      expect(result).toContain('must contain HTML markup');
    });
  });
});
