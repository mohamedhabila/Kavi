// ---------------------------------------------------------------------------
// Parity Tool Executor — tests
// ---------------------------------------------------------------------------

// Mock canvas renderer
jest.mock('../../src/services/canvas/renderer', () => ({
  processCanvasMessage: jest.fn(),
  getSurface: jest.fn().mockReturnValue(undefined),
  getAllSurfaces: jest.fn().mockReturnValue([]),
  getFocusedCanvasSurfaceId: jest.fn().mockReturnValue(null),
  requestCanvasEval: jest.fn().mockResolvedValue('eval_result'),
  requestCanvasSnapshot: jest.fn().mockResolvedValue('data:image/png;base64,'),
  setCanvasEventHandler: jest.fn(),
  resolveCanvasEval: jest.fn(),
  resolveCanvasSnapshot: jest.fn(),
}));

// Mock sub-agent
jest.mock('../../src/services/agents/subAgent', () => ({
  spawnSubAgent: jest.fn().mockResolvedValue({
    sessionId: 'sub-mock-123',
    output: 'Sub agent output',
    toolsUsed: [],
    iterations: 1,
    status: 'completed',
  }),
  startSubAgent: jest.fn().mockResolvedValue({
    sessionId: 'sub-mock-123',
    status: 'running',
    depth: 1,
    resultPromise: Promise.resolve({
      sessionId: 'sub-mock-123',
      output: 'Sub agent output',
      toolsUsed: [],
      iterations: 1,
      status: 'completed',
      depth: 1,
    }),
  }),
  launchSubAgent: jest.fn().mockResolvedValue({
    sessionId: 'sub-mock-123',
    status: 'running',
    depth: 1,
  }),
  listActiveSubAgents: jest.fn().mockReturnValue([]),
  getSubAgent: jest.fn().mockReturnValue(undefined),
  getSessionContext: jest.fn().mockReturnValue(undefined),
  waitForSubAgentResultPromise: jest
    .fn()
    .mockImplementation((resultPromise: Promise<any>) => resultPromise),
}));

const mockChatStoreState: { conversations: any[] } = {
  conversations: [],
};

jest.mock('../../src/store/useChatStore', () => ({
  useChatStore: {
    getState: () => mockChatStoreState,
  },
}));

const mockSettingsState = {
  linkUnderstandingEnabled: true,
  mediaUnderstandingEnabled: true,
};

jest.mock('../../src/store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => mockSettingsState,
  },
}));

// Mock voice
jest.mock('../../src/services/voice/voice', () => ({
  startRecording: jest.fn().mockResolvedValue(undefined),
  stopRecording: jest.fn().mockResolvedValue('mock-audio-uri'),
  transcribeAudio: jest.fn().mockResolvedValue({ text: 'hello', language: 'en', duration: 2 }),
}));

// Mock memory store
jest.mock('../../src/services/memory/store', () => ({
  searchMemory: jest.fn().mockReturnValue([]),
}));

// Mock embeddings
jest.mock('../../src/services/memory/embeddings', () => ({
  hybridSearch: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../src/services/memory/sqlite-store', () => ({
  indexMemoryToSqlite: jest.fn().mockResolvedValue(0),
  sqliteHybridSearch: jest.fn().mockResolvedValue([]),
}));

// Mock expo-image-picker
jest.mock('expo-image-picker', () => ({
  launchCameraAsync: jest.fn().mockResolvedValue({
    canceled: false,
    assets: [
      {
        uri: 'file://mock/photo.jpg',
        base64: 'mockbase64data',
        width: 640,
        height: 480,
        mimeType: 'image/jpeg',
      },
    ],
  }),
  CameraType: { front: 'front', back: 'back' },
}));

// Mock id generator
jest.mock('../../src/utils/id', () => ({
  generateId: jest.fn().mockReturnValue('mock-id'),
}));

const mockHydrateProviderForRequest = jest.fn(async (provider) => provider);

jest.mock('../../src/services/llm/providerSupport', () => {
  const actual = jest.requireActual('../../src/services/llm/providerSupport');
  return {
    ...actual,
    hydrateProviderForRequest: (...args: any[]) => mockHydrateProviderForRequest(...args),
  };
});

import {
  executeCanvasCreate,
  executeCanvasUpdate,
  executeCanvasDelete,
  executeCanvasEval,
  executeSessionSpawn,
  executeSessionList,
  executeSessionSend,
  executeSessionHistory,
  executePdfRead,
  executeCameraSnap,
  executeAudioTranscribe,
  executeMemorySearch,
} from '../../src/engine/tools/parity-executor';

const MOCK_PROVIDER = {
  id: 'test',
  name: 'Test',
  type: 'openai',
  apiKey: 'k',
  baseUrl: 'u',
  model: 'gpt-5.4',
  models: ['gpt-5.4'],
  enabled: true,
} as any;

describe('Parity Tool Executor', () => {
  beforeEach(() => {
    const renderer = require('../../src/services/canvas/renderer');
    renderer.processCanvasMessage.mockReset();
    renderer.processCanvasMessage.mockImplementation(() => undefined);
    renderer.getSurface.mockReset();
    renderer.getSurface.mockReturnValue(undefined);
    renderer.getAllSurfaces.mockReset();
    renderer.getAllSurfaces.mockReturnValue([]);
    renderer.getFocusedCanvasSurfaceId.mockReset();
    renderer.getFocusedCanvasSurfaceId.mockReturnValue(null);
    renderer.requestCanvasEval.mockReset();
    renderer.requestCanvasEval.mockResolvedValue('eval_result');
    renderer.requestCanvasSnapshot.mockReset();
    renderer.requestCanvasSnapshot.mockResolvedValue('data:image/png;base64,');
    mockChatStoreState.conversations = [];
    mockSettingsState.linkUnderstandingEnabled = true;
    mockSettingsState.mediaUnderstandingEnabled = true;
    mockHydrateProviderForRequest.mockReset();
    mockHydrateProviderForRequest.mockImplementation(async (provider) => provider);

    jest.clearAllMocks();
    const sqliteStore = require('../../src/services/memory/sqlite-store');
    sqliteStore.indexMemoryToSqlite.mockReset();
    sqliteStore.indexMemoryToSqlite.mockResolvedValue(0);
    sqliteStore.sqliteHybridSearch.mockReset();
    sqliteStore.sqliteHybridSearch.mockResolvedValue([]);
  });

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
      const { processCanvasMessage } = require('../../src/services/canvas/renderer');

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
      const { processCanvasMessage } = require('../../src/services/canvas/renderer');

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
      const { processCanvasMessage } = require('../../src/services/canvas/renderer');

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
      const { processCanvasMessage } = require('../../src/services/canvas/renderer');

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

  describe('executeCanvasUpdate', () => {
    it('returns error for non-existent surface', async () => {
      const result = await executeCanvasUpdate({
        surfaceId: 'nonexistent',
        components: [{ id: 'c1', type: 'text', props: { text: 'v2' } }],
      });
      expect(result).toContain('Error');
    });

    it('updates an existing surface', async () => {
      const { getSurface } = require('../../src/services/canvas/renderer');
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
      const { getSurface } = require('../../src/services/canvas/renderer');
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
      const { getSurface, processCanvasMessage } = require('../../src/services/canvas/renderer');
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
      const { getSurface, processCanvasMessage } = require('../../src/services/canvas/renderer');
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
      const { getSurface, processCanvasMessage } = require('../../src/services/canvas/renderer');
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
      const { getSurface, processCanvasMessage } = require('../../src/services/canvas/renderer');
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
      const { getSurface, processCanvasMessage } = require('../../src/services/canvas/renderer');
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

  describe('executeCanvasDelete', () => {
    it('deletes a surface', async () => {
      const { getSurface } = require('../../src/services/canvas/renderer');
      getSurface.mockImplementation((id: string) =>
        id === 'any-surface' ? { id: 'any-surface', title: 'Delete Me' } : undefined,
      );

      const result = await executeCanvasDelete({ surfaceId: 'any-surface' });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('deleted');
    });
  });

  describe('executeSessionSpawn', () => {
    it('launches a background sub-agent session by default', async () => {
      const result = await executeSessionSpawn(
        { prompt: 'Research something' },
        'parent-conv-1',
        {
          id: 'test',
          name: 'Test',
          type: 'openai',
          apiKey: 'k',
          baseUrl: 'u',
          model: 'gpt-5.4',
          models: ['gpt-5.4'],
          enabled: true,
        },
        undefined,
      );
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('running');
      expect(parsed.sessionId).toContain('sub-');
    });

    it('rejects missing or blank worker prompts before attempting launch', async () => {
      const { launchSubAgent } = require('../../src/services/agents/subAgent');

      const result = await executeSessionSpawn(
        { prompt: '   ' as any },
        'parent-conv-1',
        {
          id: 'test',
          name: 'Test',
          type: 'openai',
          apiKey: 'k',
          baseUrl: 'u',
          model: 'gpt-5.4',
          models: ['gpt-5.4'],
          enabled: true,
        },
        undefined,
      );

      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('error');
      expect(parsed.error).toBe('Worker prompt must be a non-empty string.');
      expect(launchSubAgent).not.toHaveBeenCalled();
    });

    it('requires an explicit workstream binding when a multi-workstream plan already exists', async () => {
      const { launchSubAgent } = require('../../src/services/agents/subAgent');
      mockChatStoreState.conversations = [
        {
          id: 'parent-conv-1',
          activeAgentRunId: 'run-42',
          agentRuns: [
            {
              id: 'run-42',
              status: 'running',
              plan: {
                objective: 'Build the feature',
                successCriteria: ['Ship it'],
                stopConditions: ['Blocked'],
                workstreams: [
                  { id: 'workstream-1', title: 'Architecture' },
                  { id: 'workstream-2', title: 'Implementation', dependencies: ['workstream-1'] },
                ],
                updatedAt: 1,
              },
            },
          ],
          messages: [],
        },
      ];

      const result = await executeSessionSpawn(
        { prompt: 'Build the feature end-to-end', name: 'Lead Developer' },
        'parent-conv-1',
        {
          id: 'test',
          name: 'Test',
          type: 'openai',
          apiKey: 'k',
          baseUrl: 'u',
          model: 'gpt-5.4',
          models: ['gpt-5.4'],
          enabled: true,
        },
        undefined,
      );

      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('blocked');
      expect(parsed.reason).toBe('missing_workstream_binding');
      expect(parsed.availableWorkstreams).toEqual([
        expect.objectContaining({ id: 'workstream-1', title: 'Architecture' }),
        expect.objectContaining({ id: 'workstream-2', title: 'Implementation' }),
      ]);
      expect(launchSubAgent).not.toHaveBeenCalled();
    });

    it('does not treat punctuated no-dependency sentinels as real blockers on the first spawn', async () => {
      const { launchSubAgent } = require('../../src/services/agents/subAgent');
      mockChatStoreState.conversations = [
        {
          id: 'parent-conv-1',
          activeAgentRunId: 'run-42',
          agentRuns: [
            {
              id: 'run-42',
              status: 'running',
              plan: {
                objective: 'Build the feature',
                successCriteria: ['Ship it'],
                stopConditions: ['Blocked'],
                workstreams: [
                  { id: 'workstream-1', title: 'Architecture' },
                  { id: 'workstream-2', title: 'Implementation', dependencies: ['workstream-1'] },
                ],
                updatedAt: 1,
              },
            },
          ],
          messages: [],
        },
      ];

      const result = await executeSessionSpawn(
        {
          prompt: 'Build the feature end-to-end',
          name: 'Lead Developer',
          dependsOnWorkstreams: 'none.',
        },
        'parent-conv-1',
        {
          id: 'test',
          name: 'Test',
          type: 'openai',
          apiKey: 'k',
          baseUrl: 'u',
          model: 'gpt-5.4',
          models: ['gpt-5.4'],
          enabled: true,
        },
        undefined,
      );

      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('blocked');
      expect(parsed.reason).toBe('missing_workstream_binding');
      expect(parsed.availableWorkstreams).toEqual([
        expect.objectContaining({ id: 'workstream-1', title: 'Architecture' }),
        expect.objectContaining({ id: 'workstream-2', title: 'Implementation' }),
      ]);
      expect(launchSubAgent).not.toHaveBeenCalled();
    });

    it('blocks dependent workstreams until prerequisites complete', async () => {
      const { launchSubAgent, listActiveSubAgents } = require('../../src/services/agents/subAgent');
      listActiveSubAgents.mockReturnValueOnce([
        {
          sessionId: 'sub-arch-1',
          parentConversationId: 'parent-conv-1',
          agentRunId: 'run-42',
          workstreamId: 'workstream-1',
          depth: 0,
          startedAt: 10,
          updatedAt: 20,
          status: 'running',
          sandboxPolicy: 'inherit',
        },
      ]);
      mockChatStoreState.conversations = [
        {
          id: 'parent-conv-1',
          activeAgentRunId: 'run-42',
          agentRuns: [
            {
              id: 'run-42',
              status: 'running',
              plan: {
                objective: 'Build the feature',
                successCriteria: ['Ship it'],
                stopConditions: ['Blocked'],
                workstreams: [
                  { id: 'workstream-1', title: 'Architecture' },
                  { id: 'workstream-2', title: 'Implementation', dependencies: ['Architecture'] },
                ],
                updatedAt: 1,
              },
            },
          ],
          messages: [],
        },
      ];

      const result = await executeSessionSpawn(
        {
          prompt: 'Implement the approved design',
          workstreamId: 'workstream-2',
          name: 'Developer',
        },
        'parent-conv-1',
        {
          id: 'test',
          name: 'Test',
          type: 'openai',
          apiKey: 'k',
          baseUrl: 'u',
          model: 'gpt-5.4',
          models: ['gpt-5.4'],
          enabled: true,
        },
        undefined,
      );

      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('blocked');
      expect(parsed.reason).toBe('blocked_dependencies');
      expect(parsed.workstreamId).toBe('workstream-2');
      expect(parsed.unmetDependencyIds).toEqual(['workstream-1']);
      expect(parsed.blockingDependencies).toEqual([
        expect.objectContaining({
          workstreamId: 'workstream-1',
          status: 'running',
          sessionIds: ['sub-arch-1'],
        }),
      ]);
      expect(launchSubAgent).not.toHaveBeenCalled();
    });

    it('blocks re-spawning a plan-linked workstream after it already completed', async () => {
      const { launchSubAgent, listActiveSubAgents } = require('../../src/services/agents/subAgent');
      listActiveSubAgents.mockReturnValueOnce([
        {
          sessionId: 'sub-review-1',
          parentConversationId: 'parent-conv-1',
          agentRunId: 'run-42',
          workstreamId: 'workstream-2',
          depth: 0,
          startedAt: 10,
          updatedAt: 20,
          status: 'completed',
          sandboxPolicy: 'inherit',
        },
      ]);
      mockChatStoreState.conversations = [
        {
          id: 'parent-conv-1',
          activeAgentRunId: 'run-42',
          agentRuns: [
            {
              id: 'run-42',
              status: 'running',
              plan: {
                objective: 'Build the feature',
                successCriteria: ['Ship it'],
                stopConditions: ['Blocked'],
                workstreams: [
                  { id: 'workstream-1', title: 'Architecture' },
                  { id: 'workstream-2', title: 'Review', dependencies: ['workstream-1'] },
                ],
                updatedAt: 1,
              },
            },
          ],
          messages: [],
        },
      ];

      const result = await executeSessionSpawn(
        {
          prompt: 'Review the implementation again.',
          workstreamId: 'workstream-2',
          name: 'Reviewer',
        },
        'parent-conv-1',
        {
          id: 'test',
          name: 'Test',
          type: 'openai',
          apiKey: 'k',
          baseUrl: 'u',
          model: 'gpt-5.4',
          models: ['gpt-5.4'],
          enabled: true,
        },
        undefined,
      );

      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('blocked');
      expect(parsed.reason).toBe('workstream_already_completed');
      expect(parsed.workstreamId).toBe('workstream-2');
      expect(parsed.completedSessionIds).toEqual(['sub-review-1']);
      expect(parsed.guidance).toContain('sessions_output');
      expect(parsed.guidance).toContain('sessions_send');
      expect(launchSubAgent).not.toHaveBeenCalled();
    });

    it('passes the bound workstream id through to launched workers once prerequisites are complete', async () => {
      const { launchSubAgent, listActiveSubAgents } = require('../../src/services/agents/subAgent');
      listActiveSubAgents.mockReturnValueOnce([
        {
          sessionId: 'sub-arch-1',
          parentConversationId: 'parent-conv-1',
          agentRunId: 'run-42',
          workstreamId: 'workstream-1',
          depth: 0,
          startedAt: 10,
          updatedAt: 20,
          status: 'completed',
          sandboxPolicy: 'inherit',
        },
      ]);
      mockChatStoreState.conversations = [
        {
          id: 'parent-conv-1',
          activeAgentRunId: 'run-42',
          agentRuns: [
            {
              id: 'run-42',
              status: 'running',
              plan: {
                objective: 'Build the feature',
                successCriteria: ['Ship it'],
                stopConditions: ['Blocked'],
                workstreams: [
                  { id: 'workstream-1', title: 'Architecture' },
                  { id: 'workstream-2', title: 'Implementation', dependencies: ['workstream-1'] },
                ],
                updatedAt: 1,
              },
            },
          ],
          messages: [],
        },
      ];

      const result = await executeSessionSpawn(
        {
          prompt: 'Implement the approved design',
          workstreamId: 'Implementation',
          name: 'Developer',
        },
        'parent-conv-1',
        {
          id: 'test',
          name: 'Test',
          type: 'openai',
          apiKey: 'k',
          baseUrl: 'u',
          model: 'gpt-5.4',
          models: ['gpt-5.4'],
          enabled: true,
        },
        undefined,
      );

      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('running');
      expect(parsed.workstreamId).toBe('workstream-2');
      expect(launchSubAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          parentConversationId: 'parent-conv-1',
          workstreamId: 'workstream-2',
        }),
        expect.anything(),
        undefined,
      );
    });

    it('allows dependent workstreams when a prerequisite already completed under an aliased workstream id and a later worker is still running', async () => {
      const { launchSubAgent, listActiveSubAgents } = require('../../src/services/agents/subAgent');
      listActiveSubAgents.mockReturnValueOnce([
        {
          sessionId: 'sub-arch-1',
          parentConversationId: 'parent-conv-1',
          agentRunId: 'run-42',
          workstreamId: 'Architecture',
          depth: 0,
          startedAt: 10,
          updatedAt: 20,
          status: 'completed',
          sandboxPolicy: 'inherit',
        },
        {
          sessionId: 'sub-arch-2',
          parentConversationId: 'parent-conv-1',
          agentRunId: 'run-42',
          workstreamId: 'workstream-1',
          depth: 0,
          startedAt: 30,
          updatedAt: 40,
          status: 'running',
          sandboxPolicy: 'inherit',
        },
      ]);
      mockChatStoreState.conversations = [
        {
          id: 'parent-conv-1',
          activeAgentRunId: 'run-42',
          agentRuns: [
            {
              id: 'run-42',
              status: 'running',
              plan: {
                objective: 'Build the feature',
                successCriteria: ['Ship it'],
                stopConditions: ['Blocked'],
                workstreams: [
                  { id: 'workstream-1', title: 'Architecture' },
                  { id: 'workstream-2', title: 'Implementation', dependencies: ['Architecture'] },
                ],
                updatedAt: 1,
              },
            },
          ],
          messages: [],
        },
      ];

      const result = await executeSessionSpawn(
        {
          prompt: 'Implement the approved design',
          workstreamId: 'Implementation',
          name: 'Developer',
        },
        'parent-conv-1',
        {
          id: 'test',
          name: 'Test',
          type: 'openai',
          apiKey: 'k',
          baseUrl: 'u',
          model: 'gpt-5.4',
          models: ['gpt-5.4'],
          enabled: true,
        },
        undefined,
      );

      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('running');
      expect(parsed.workstreamId).toBe('workstream-2');
      expect(launchSubAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          parentConversationId: 'parent-conv-1',
          workstreamId: 'workstream-2',
        }),
        expect.anything(),
        undefined,
      );
    });

    it('normalizes stringified dependsOnWorkstreams values instead of throwing a configuration error', async () => {
      const { launchSubAgent, listActiveSubAgents } = require('../../src/services/agents/subAgent');
      listActiveSubAgents.mockReturnValueOnce([
        {
          sessionId: 'sub-arch-1',
          parentConversationId: 'parent-conv-1',
          agentRunId: 'run-42',
          workstreamId: 'workstream-1',
          depth: 0,
          startedAt: 10,
          updatedAt: 20,
          status: 'completed',
          sandboxPolicy: 'inherit',
        },
      ]);
      mockChatStoreState.conversations = [
        {
          id: 'parent-conv-1',
          activeAgentRunId: 'run-42',
          agentRuns: [
            {
              id: 'run-42',
              status: 'running',
              plan: {
                objective: 'Build the feature',
                successCriteria: ['Ship it'],
                stopConditions: ['Blocked'],
                workstreams: [
                  { id: 'workstream-1', title: 'Architecture' },
                  {
                    id: 'workstream-2',
                    title: 'Architecture Review',
                    dependencies: ['Architecture'],
                  },
                ],
                updatedAt: 1,
              },
            },
          ],
          messages: [],
        },
      ];

      const result = await executeSessionSpawn(
        {
          prompt: 'Review ARCHITECTURE.md and keep the response brief.',
          workstreamId: 'Architecture Review',
          dependsOnWorkstreams: '["workstream-1"]' as any,
          name: 'Architecture Reviewer',
        },
        'parent-conv-1',
        {
          id: 'test',
          name: 'Test',
          type: 'openai',
          apiKey: 'k',
          baseUrl: 'u',
          model: 'gpt-5.4',
          models: ['gpt-5.4'],
          enabled: true,
        },
        undefined,
      );

      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('running');
      expect(parsed.workstreamId).toBe('workstream-2');
      expect(launchSubAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          parentConversationId: 'parent-conv-1',
          workstreamId: 'workstream-2',
          name: 'Architecture Reviewer',
        }),
        expect.anything(),
        undefined,
      );
    });

    it('infers the matching Anthropic research workstream from a descriptive worker name when the title is markdown-decorated', async () => {
      const { launchSubAgent } = require('../../src/services/agents/subAgent');
      mockChatStoreState.conversations = [
        {
          id: 'parent-conv-1',
          activeAgentRunId: 'run-42',
          agentRuns: [
            {
              id: 'run-42',
              status: 'running',
              plan: {
                objective: 'Compare providers',
                successCriteria: ['Finish the research'],
                stopConditions: ['Blocked'],
                workstreams: [
                  { id: 'workstream-1', title: '**Anthropic Research**' },
                  { id: 'workstream-2', title: '**OpenAI Research**' },
                  { id: 'workstream-3', title: '**Google Gemini Research**' },
                ],
                updatedAt: 1,
              },
            },
          ],
          messages: [],
        },
      ];

      const result = await executeSessionSpawn(
        {
          prompt:
            'Research Anthropic official docs, tool-use behavior, and orchestration guidance.',
          name: 'Anthropic Research Agent',
        },
        'parent-conv-1',
        {
          id: 'anthropic',
          name: 'Anthropic',
          type: 'anthropic',
          apiKey: 'k',
          baseUrl: 'https://api.anthropic.com/v1',
          model: 'claude-sonnet-4-6',
          availableModels: ['claude-sonnet-4-6'],
          enabled: true,
        },
        undefined,
      );

      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('running');
      expect(parsed.workstreamId).toBe('workstream-1');
      expect(launchSubAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          parentConversationId: 'parent-conv-1',
          workstreamId: 'workstream-1',
          name: 'Anthropic Research Agent',
        }),
        expect.anything(),
        undefined,
      );
    });

    it('handles spawn error', async () => {
      const { launchSubAgent } = require('../../src/services/agents/subAgent');
      launchSubAgent.mockRejectedValueOnce(new Error('spawn failed'));
      const result = await executeSessionSpawn({ prompt: 'fail' }, 'conv-1', {
        id: 'test',
        name: 'Test',
        type: 'openai',
        apiKey: 'k',
        baseUrl: 'u',
        model: 'gpt-5.4',
        models: ['gpt-5.4'],
        enabled: true,
      });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('error');
      expect(parsed.error).toBe('spawn failed');
    });

    it('can wait for completion when requested', async () => {
      const { waitForSubAgentResultPromise } = require('../../src/services/agents/subAgent');
      const result = await executeSessionSpawn(
        { prompt: 'Research something', waitForCompletion: true },
        'parent-conv-1',
        {
          id: 'test',
          name: 'Test',
          type: 'openai',
          apiKey: 'k',
          baseUrl: 'u',
          model: 'gpt-5.4',
          models: ['gpt-5.4'],
          enabled: true,
        },
        undefined,
      );
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('completed');
      expect(waitForSubAgentResultPromise).toHaveBeenCalledWith(expect.any(Promise), 15000);
    });

    it('prefers the inherited parent model over the provider default', async () => {
      const { launchSubAgent } = require('../../src/services/agents/subAgent');

      await executeSessionSpawn(
        { prompt: 'Research something' },
        'parent-conv-1',
        {
          id: 'openai',
          name: 'OpenAI',
          type: 'openai',
          apiKey: 'k',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-5.4',
          availableModels: ['gpt-5.4', 'gpt-5.4-mini'],
          enabled: true,
        },
        undefined,
        'gpt-5.4-mini',
      );

      expect(launchSubAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          parentConversationId: 'parent-conv-1',
          model: 'gpt-5.4-mini',
        }),
        expect.anything(),
        undefined,
      );
    });

    it('prefers an explicit worker model over the inherited parent model when it matches the provider', async () => {
      const { launchSubAgent } = require('../../src/services/agents/subAgent');

      await executeSessionSpawn(
        { prompt: 'Research something', model: '  claude-sonnet-4-6  ' },
        'parent-conv-1',
        {
          id: 'anthropic',
          name: 'Anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          apiKey: 'k',
          model: 'claude-opus-4-6',
          availableModels: ['claude-opus-4-6', 'claude-sonnet-4-6'],
          enabled: true,
        },
        undefined,
        'gpt-5.4-mini',
      );

      expect(launchSubAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          parentConversationId: 'parent-conv-1',
          model: 'claude-sonnet-4-6',
        }),
        expect.anything(),
        undefined,
      );
    });

    it('falls back to the worker provider model when the inherited parent model targets a different provider family', async () => {
      const { launchSubAgent } = require('../../src/services/agents/subAgent');

      await executeSessionSpawn(
        { prompt: 'Research something' },
        'parent-conv-1',
        {
          id: 'anthropic',
          name: 'Anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          apiKey: 'k',
          model: 'claude-sonnet-4-6',
          availableModels: ['claude-opus-4-6', 'claude-sonnet-4-6'],
          enabled: true,
        },
        undefined,
        'openai/gpt-5.4',
      );

      expect(launchSubAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          parentConversationId: 'parent-conv-1',
          model: 'claude-sonnet-4-6',
        }),
        expect.anything(),
        undefined,
      );
    });

    it('passes the active agent run id through to launched workers', async () => {
      const { launchSubAgent } = require('../../src/services/agents/subAgent');
      mockChatStoreState.conversations = [
        {
          id: 'parent-conv-1',
          activeAgentRunId: 'run-42',
        },
      ];

      await executeSessionSpawn(
        { prompt: 'Research something' },
        'parent-conv-1',
        {
          id: 'test',
          name: 'Test',
          type: 'openai',
          apiKey: 'k',
          baseUrl: 'u',
          model: 'gpt-5.4',
          models: ['gpt-5.4'],
          enabled: true,
        },
        undefined,
      );

      expect(launchSubAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          parentConversationId: 'parent-conv-1',
          agentRunId: 'run-42',
        }),
        expect.anything(),
        undefined,
      );
    });

    it('ignores timeoutMs hints so delegated workers stay untimed', async () => {
      const { launchSubAgent } = require('../../src/services/agents/subAgent');

      await executeSessionSpawn(
        { prompt: 'Research something', timeoutMs: 5000 } as any,
        'parent-conv-1',
        {
          id: 'test',
          name: 'Test',
          type: 'openai',
          apiKey: 'k',
          baseUrl: 'u',
          model: 'gpt-5.4',
          models: ['gpt-5.4'],
          enabled: true,
        },
        undefined,
      );

      expect(launchSubAgent).toHaveBeenCalledWith(
        expect.not.objectContaining({ timeoutMs: expect.anything() }),
        expect.anything(),
        undefined,
      );
    });

    it('ignores maxIterations hints so delegated workers keep the roomy default budget', async () => {
      const { launchSubAgent } = require('../../src/services/agents/subAgent');

      await executeSessionSpawn(
        { prompt: 'Research something', maxIterations: 4 } as any,
        'parent-conv-1',
        {
          id: 'test',
          name: 'Test',
          type: 'openai',
          apiKey: 'k',
          baseUrl: 'u',
          model: 'gpt-5.4',
          models: ['gpt-5.4'],
          enabled: true,
        },
        undefined,
      );

      expect(launchSubAgent).toHaveBeenCalledWith(
        expect.not.objectContaining({ maxIterations: expect.anything() }),
        expect.anything(),
        undefined,
      );
    });

    it('inherits the latest attached user turn into the worker seed without forwarding inline payload bytes', async () => {
      const { launchSubAgent } = require('../../src/services/agents/subAgent');
      mockChatStoreState.conversations = [
        {
          id: 'parent-conv-1',
          activeAgentRunId: 'run-42',
          messages: [
            {
              id: 'user-1',
              role: 'user',
              content: 'Please inspect this screenshot',
              timestamp: 1,
              attachments: [
                {
                  id: 'att-1',
                  type: 'image',
                  uri: 'file:///tmp/screenshot.png',
                  name: 'screenshot.png',
                  mimeType: 'image/png',
                  size: 2048,
                  base64: 'should-not-be-forwarded',
                },
              ],
            },
          ],
        },
      ];

      await executeSessionSpawn(
        { prompt: 'Analyze the attached screenshot' },
        'parent-conv-1',
        {
          id: 'test',
          name: 'Test',
          type: 'openai',
          apiKey: 'k',
          baseUrl: 'u',
          model: 'gpt-5.4',
          models: ['gpt-5.4'],
          enabled: true,
        },
        undefined,
      );

      expect(launchSubAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          initialMessages: [
            expect.objectContaining({
              role: 'user',
              content: 'Analyze the attached screenshot',
              attachments: [
                expect.objectContaining({
                  id: 'att-1',
                  uri: 'file:///tmp/screenshot.png',
                }),
              ],
            }),
          ],
          linkUnderstandingEnabled: true,
          mediaUnderstandingEnabled: true,
        }),
        expect.anything(),
        undefined,
      );

      const forwardedAttachment = launchSubAgent.mock.calls[0][0].initialMessages[0].attachments[0];
      expect(forwardedAttachment.base64).toBeUndefined();
    });

    it('preserves parent session ancestry and resolves the owning conversation for nested workers', async () => {
      const {
        getSubAgent,
        listActiveSubAgents,
        launchSubAgent,
      } = require('../../src/services/agents/subAgent');

      getSubAgent.mockReturnValueOnce({
        sessionId: 'sub-child',
        parentConversationId: 'sub-root',
        agentRunId: 'run-42',
      });
      listActiveSubAgents.mockReturnValueOnce([
        { sessionId: 'sub-child', parentConversationId: 'sub-root' },
        { sessionId: 'sub-root', parentConversationId: 'parent-conv-1' },
      ]);

      await executeSessionSpawn(
        { prompt: 'Research the nested task' },
        'sub-child',
        {
          id: 'test',
          name: 'Test',
          type: 'openai',
          apiKey: 'k',
          baseUrl: 'u',
          model: 'gpt-5.4',
          models: ['gpt-5.4'],
          enabled: true,
        },
        undefined,
      );

      expect(launchSubAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          parentConversationId: 'parent-conv-1',
          parentSessionId: 'sub-child',
          workspaceConversationId: 'parent-conv-1',
          agentRunId: 'run-42',
        }),
        expect.anything(),
        undefined,
      );
    });
  });

  describe('executeSessionList', () => {
    it('lists active sessions', async () => {
      const result = await executeSessionList();
      const parsed = JSON.parse(result);
      expect(parsed).toHaveProperty('sessions');
    });

    it('lists non-empty sessions', async () => {
      const { listActiveSubAgents } = require('../../src/services/agents/subAgent');
      listActiveSubAgents.mockReturnValueOnce([
        { sessionId: 's1', status: 'running', prompt: 'Task 1', startedAt: Date.now() },
      ]);
      const result = await executeSessionList();
      const parsed = JSON.parse(result);
      expect(parsed.sessions.length).toBe(1);
    });
  });

  describe('executeSessionSend', () => {
    it('returns error for non-existent session', async () => {
      const result = await executeSessionSend(
        {
          sessionId: 'sub-123',
          message: 'Hello sub-agent',
        },
        MOCK_PROVIDER,
      );
      expect(result).toContain('Error');
    });

    it('returns running status for active session', async () => {
      const { getSubAgent } = require('../../src/services/agents/subAgent');
      getSubAgent.mockReturnValueOnce({ status: 'running', sessionId: 'running-1' });
      const result = await executeSessionSend(
        { sessionId: 'running-1', message: 'ping' },
        MOCK_PROVIDER,
      );
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('running');
      expect(parsed.message).toContain('still processing');
    });

    it('rejects blank follow-up messages before re-spawning a worker', async () => {
      const { getSubAgent, launchSubAgent } = require('../../src/services/agents/subAgent');
      getSubAgent.mockReturnValueOnce({
        status: 'completed',
        output: 'Previous answer',
        parentConversationId: 'conv-1',
      });

      const result = await executeSessionSend(
        { sessionId: 'done-1', message: '   ' as any },
        MOCK_PROVIDER,
      );
      const parsed = JSON.parse(result);

      expect(parsed.status).toBe('error');
      expect(parsed.error).toBe('Worker message must be a non-empty string.');
      expect(launchSubAgent).not.toHaveBeenCalled();
    });

    it('launches a follow-up worker in the background by default', async () => {
      const {
        getSubAgent,
        getSessionContext,
        launchSubAgent,
      } = require('../../src/services/agents/subAgent');
      getSubAgent.mockReturnValueOnce({
        status: 'completed',
        output: 'Previous answer',
        parentConversationId: 'conv-1',
      });
      getSessionContext.mockReturnValueOnce({
        config: {
          prompt: 'Original task',
          systemPrompt: 'You are a focused worker.',
          tools: ['read_file'],
          sandboxPolicy: 'safe-only',
          workstreamId: 'workstream-2',
          name: 'Research Worker',
        },
        provider: MOCK_PROVIDER,
        conversationSummary: 'Previous answer',
        messages: [
          {
            id: 'm1',
            role: 'user',
            content: 'Original task',
            enrichedContent:
              'Original task\n\n<attachment_context>Image shows a failing CI build.</attachment_context>',
            timestamp: 1,
            attachments: [
              {
                id: 'att-1',
                type: 'image',
                uri: 'file:///tmp/build.png',
                name: 'build.png',
                mimeType: 'image/png',
                size: 1024,
              },
            ],
          },
          { id: 'm2', role: 'assistant', content: 'Previous answer', timestamp: 2 },
        ],
      });
      launchSubAgent.mockResolvedValueOnce({
        sessionId: 'new-123',
        status: 'running',
        depth: 2,
      });
      const result = await executeSessionSend(
        { sessionId: 'old-123', message: 'Tell me more' },
        MOCK_PROVIDER,
      );
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('running');
      expect(parsed.sessionId).toBe('new-123');
      expect(parsed.previousSessionId).toBe('old-123');
      expect(parsed.workstreamId).toBe('workstream-2');
      expect(parsed.guidance).toContain('running in the background');
      expect(launchSubAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          parentConversationId: 'conv-1',
          parentSessionId: 'old-123',
          prompt: 'Tell me more',
          systemPrompt: 'You are a focused worker.',
          tools: ['read_file'],
          sandboxPolicy: 'safe-only',
          workstreamId: 'workstream-2',
          name: 'Research Worker',
          initialMessages: expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              content: 'Original task',
              enrichedContent:
                'Original task\n\n<attachment_context>Image shows a failing CI build.</attachment_context>',
              attachments: [expect.objectContaining({ id: 'att-1', uri: 'file:///tmp/build.png' })],
            }),
            expect.objectContaining({ role: 'assistant', content: 'Previous answer' }),
            expect.objectContaining({ role: 'user', content: 'Tell me more' }),
          ]),
          linkUnderstandingEnabled: true,
          mediaUnderstandingEnabled: true,
        }),
        MOCK_PROVIDER,
        undefined,
      );
    });

    it('resolves the owning conversation for follow-up workers from nested sessions', async () => {
      const {
        getSubAgent,
        listActiveSubAgents,
        launchSubAgent,
      } = require('../../src/services/agents/subAgent');

      getSubAgent.mockReturnValueOnce({
        sessionId: 'old-nested',
        status: 'completed',
        output: 'Previous answer',
        parentConversationId: 'sub-root',
      });
      listActiveSubAgents.mockReturnValueOnce([
        { sessionId: 'old-nested', parentConversationId: 'sub-root' },
        { sessionId: 'sub-root', parentConversationId: 'conv-1' },
      ]);
      launchSubAgent.mockResolvedValueOnce({
        sessionId: 'new-nested',
        status: 'running',
        depth: 2,
      });

      await executeSessionSend(
        { sessionId: 'old-nested', message: 'Continue the nested task' },
        MOCK_PROVIDER,
      );

      expect(launchSubAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          parentConversationId: 'conv-1',
          parentSessionId: 'old-nested',
          workspaceConversationId: 'conv-1',
        }),
        MOCK_PROVIDER,
        undefined,
      );
    });

    it.each([
      {
        label: 'OpenAI Responses replay',
        provider: {
          ...MOCK_PROVIDER,
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-5.4',
        },
        assistantMessage: {
          id: 'a-openai',
          role: 'assistant',
          content: 'Checking the file.',
          timestamp: 2,
          providerReplay: {
            openaiResponseOutput: [
              {
                id: 'rs_prev',
                type: 'reasoning',
                summary: [{ type: 'summary_text', text: 'Need file contents' }],
              },
              {
                id: 'msg_prev',
                type: 'message',
                role: 'assistant',
                content: [{ type: 'output_text', text: 'Checking the file.', annotations: [] }],
              },
            ],
          },
          toolCalls: [
            {
              id: 'call_openai_1',
              name: 'read_file',
              arguments: '{"path":"notes.txt"}',
              status: 'completed',
              raw: {
                id: 'call_openai_1',
                type: 'function',
                function: { name: 'read_file', arguments: '{"path":"notes.txt"}' },
              },
            },
          ],
        },
      },
      {
        label: 'Anthropic assistant blocks',
        provider: {
          ...MOCK_PROVIDER,
          id: 'anthropic',
          name: 'Anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          model: 'claude-sonnet-4-6',
        },
        assistantMessage: {
          id: 'a-anthropic',
          role: 'assistant',
          content: '',
          timestamp: 2,
          toolCalls: [
            {
              id: 'toolu_1',
              name: 'read_file',
              arguments: '{"path":"notes.txt"}',
              status: 'completed',
              raw: {
                id: 'toolu_1',
                type: 'function',
                function: { name: 'read_file', arguments: '{"path":"notes.txt"}' },
                extra_content: {
                  anthropic: {
                    assistant_blocks: [
                      { type: 'thinking', thinking: 'Inspect the file first.', signature: 'sig-A' },
                      {
                        type: 'tool_use',
                        id: 'toolu_1',
                        name: 'read_file',
                        input: { path: 'notes.txt' },
                      },
                    ],
                  },
                },
              },
            },
          ],
        },
      },
      {
        label: 'Gemini native replay',
        provider: {
          ...MOCK_PROVIDER,
          id: 'gemini',
          name: 'Gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
          model: 'gemini-2.5-pro',
        },
        assistantMessage: {
          id: 'a-gemini',
          role: 'assistant',
          content: '',
          timestamp: 2,
          providerReplay: {
            geminiParts: [
              {
                functionCall: { id: 'tc1', name: 'read_file', args: { path: 'notes.txt' } },
                thoughtSignature: 'sig-G',
              },
            ],
          },
          toolCalls: [
            {
              id: 'tc1',
              name: 'read_file',
              arguments: '{"path":"notes.txt"}',
              status: 'completed',
              raw: {
                id: 'tc1',
                type: 'function',
                function: { name: 'read_file', arguments: '{"path":"notes.txt"}' },
                extra_content: { google: { thought_signature: 'sig-G' } },
              },
            },
          ],
        },
      },
    ])(
      'preserves $label in follow-up worker transcripts',
      async ({ provider, assistantMessage }) => {
        const {
          getSubAgent,
          getSessionContext,
          launchSubAgent,
        } = require('../../src/services/agents/subAgent');
        getSubAgent.mockReturnValueOnce({
          status: 'completed',
          output: 'Previous answer',
          parentConversationId: 'conv-1',
        });
        getSessionContext.mockReturnValueOnce({
          config: {
            prompt: 'Original task',
            tools: ['read_file'],
          },
          provider,
          conversationSummary: 'Previous answer',
          messages: [
            { id: 'u1', role: 'user', content: 'Original task', timestamp: 1 },
            assistantMessage,
            {
              id: 't1',
              role: 'tool',
              content: 'file contents',
              toolCallId: assistantMessage.toolCalls[0].id,
              timestamp: 3,
            },
          ],
        });
        launchSubAgent.mockResolvedValueOnce({
          sessionId: 'new-follow-up',
          status: 'running',
          depth: 2,
        });

        await executeSessionSend({ sessionId: 'old-ctx', message: 'Continue the task' }, provider);

        const followUpConfig = launchSubAgent.mock.calls[0][0];
        const replayedAssistantMessage = followUpConfig.initialMessages.find(
          (message: any) => message.role === 'assistant',
        );

        expect(replayedAssistantMessage.toolCalls).toEqual(assistantMessage.toolCalls);
        if (assistantMessage.providerReplay) {
          expect(replayedAssistantMessage.providerReplay).toEqual(assistantMessage.providerReplay);
        } else {
          expect(replayedAssistantMessage.providerReplay).toBeUndefined();
        }
        expect(followUpConfig.initialMessages.at(-1)).toMatchObject({
          role: 'user',
          content: 'Continue the task',
        });
      },
    );

    it('can wait for follow-up completion when requested', async () => {
      const {
        getSubAgent,
        startSubAgent,
        waitForSubAgentResultPromise,
      } = require('../../src/services/agents/subAgent');
      getSubAgent.mockReturnValueOnce({
        status: 'completed',
        output: 'Done',
        parentConversationId: 'conv-1',
      });
      startSubAgent.mockResolvedValueOnce({
        sessionId: 'new-222',
        status: 'running',
        depth: 2,
        resultPromise: Promise.resolve({
          sessionId: 'new-222',
          output: 'Follow-up answer',
          toolsUsed: ['read_file'],
          iterations: 2,
          status: 'completed',
          depth: 2,
        }),
      });

      const result = await executeSessionSend(
        { sessionId: 'old-222', message: 'Tell me more', waitForCompletion: true },
        MOCK_PROVIDER,
      );
      const parsed = JSON.parse(result);

      expect(parsed.status).toBe('completed');
      expect(parsed.sessionId).toBe('new-222');
      expect(parsed.previousSessionId).toBe('old-222');
      expect(parsed.output).toBe('Follow-up answer');
      expect(waitForSubAgentResultPromise).toHaveBeenCalledWith(expect.any(Promise), 15000);
      expect(startSubAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          parentConversationId: 'conv-1',
          parentSessionId: 'old-222',
          prompt: 'Previous conversation output:\nDone\n\nFollow-up message: Tell me more',
        }),
        MOCK_PROVIDER,
        undefined,
      );
    });

    it('passes provider to launchSubAgent on re-spawn', async () => {
      const { getSubAgent, launchSubAgent } = require('../../src/services/agents/subAgent');
      getSubAgent.mockReturnValueOnce({
        status: 'completed',
        output: 'Done',
        parentConversationId: 'conv-1',
      });
      launchSubAgent.mockResolvedValueOnce({
        sessionId: 'new-456',
        status: 'running',
        depth: 2,
      });
      await executeSessionSend({ sessionId: 'old-789', message: 'more' }, MOCK_PROVIDER);
      expect(launchSubAgent).toHaveBeenCalledWith(
        expect.objectContaining({ parentConversationId: 'conv-1' }),
        MOCK_PROVIDER,
        undefined,
      );
    });

    it('falls back to a summary prompt when stored transcript context is unavailable', async () => {
      const {
        getSubAgent,
        getSessionContext,
        launchSubAgent,
      } = require('../../src/services/agents/subAgent');
      getSubAgent.mockReturnValueOnce({
        status: 'timeout',
        output: 'Previous timeout summary',
        parentConversationId: 'conv-1',
      });
      getSessionContext.mockReturnValueOnce(undefined);
      launchSubAgent.mockResolvedValueOnce({
        sessionId: 'new-321',
        status: 'running',
        depth: 2,
      });

      await executeSessionSend(
        { sessionId: 'old-timeout', message: 'retry with stricter scope' },
        MOCK_PROVIDER,
      );

      expect(launchSubAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining(
            'Previous conversation output:\nPrevious timeout summary',
          ),
        }),
        MOCK_PROVIDER,
        undefined,
      );
    });

    it('does not inherit a previous worker timeout into follow-up workers', async () => {
      const {
        getSubAgent,
        getSessionContext,
        launchSubAgent,
      } = require('../../src/services/agents/subAgent');
      getSubAgent.mockReturnValueOnce({
        status: 'completed',
        output: 'Done',
        parentConversationId: 'conv-1',
      });
      getSessionContext.mockReturnValueOnce({
        config: {
          parentConversationId: 'conv-1',
          prompt: 'Original task',
          timeoutMs: 5000,
          maxIterations: 12,
        },
        provider: MOCK_PROVIDER,
        conversationSummary: 'Done',
        messages: [{ id: 'u1', role: 'user', content: 'Original task', timestamp: 1 }],
      });
      launchSubAgent.mockResolvedValueOnce({
        sessionId: 'new-timeout-free',
        status: 'running',
        depth: 2,
      });

      await executeSessionSend(
        { sessionId: 'old-timeout', message: 'Continue without a deadline' },
        MOCK_PROVIDER,
      );

      expect(launchSubAgent).toHaveBeenCalledWith(expect.any(Object), MOCK_PROVIDER, undefined);
      expect(launchSubAgent.mock.calls[0][0].timeoutMs).toBeUndefined();
      expect(launchSubAgent.mock.calls[0][0].maxIterations).toBeUndefined();
    });

    it('does not inherit a previous worker maxIterations cap into follow-up workers', async () => {
      const {
        getSubAgent,
        getSessionContext,
        launchSubAgent,
      } = require('../../src/services/agents/subAgent');
      getSubAgent.mockReturnValueOnce({
        status: 'completed',
        output: 'Done',
        parentConversationId: 'conv-1',
      });
      getSessionContext.mockReturnValueOnce({
        config: {
          parentConversationId: 'conv-1',
          prompt: 'Original task',
          maxIterations: 12,
        },
        provider: MOCK_PROVIDER,
        conversationSummary: 'Done',
        messages: [{ id: 'u1', role: 'user', content: 'Original task', timestamp: 1 }],
      });
      launchSubAgent.mockResolvedValueOnce({
        sessionId: 'new-no-cap',
        status: 'running',
        depth: 2,
      });

      await executeSessionSend(
        { sessionId: 'old-max-iterations', message: 'Continue with the default budget' },
        MOCK_PROVIDER,
      );

      expect(launchSubAgent).toHaveBeenCalledWith(
        expect.not.objectContaining({ maxIterations: expect.anything() }),
        MOCK_PROVIDER,
        undefined,
      );
    });

    it('re-spawns with the inherited parent model over the provider default', async () => {
      const { getSubAgent, launchSubAgent } = require('../../src/services/agents/subAgent');
      getSubAgent.mockReturnValueOnce({
        status: 'completed',
        output: 'Done',
        parentConversationId: 'conv-1',
      });
      launchSubAgent.mockResolvedValueOnce({
        sessionId: 'new-999',
        status: 'running',
        depth: 2,
      });

      await executeSessionSend(
        { sessionId: 'old-999', message: 'more' },
        MOCK_PROVIDER,
        'gpt-5.4-mini',
      );

      expect(launchSubAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          parentConversationId: 'conv-1',
          model: 'gpt-5.4-mini',
        }),
        MOCK_PROVIDER,
        undefined,
      );
    });

    it('preserves the stored worker provider and model when the supervisor model targets a different family', async () => {
      const {
        getSubAgent,
        getSessionContext,
        launchSubAgent,
      } = require('../../src/services/agents/subAgent');
      const storedProvider = {
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: '',
        model: 'claude-opus-4-6',
        availableModels: ['claude-opus-4-6', 'claude-sonnet-4-6'],
        enabled: true,
      };
      const hydratedProvider = {
        ...storedProvider,
        apiKey: 'sk-anthropic',
      };

      getSubAgent.mockReturnValueOnce({
        status: 'completed',
        output: 'Done',
        parentConversationId: 'conv-1',
      });
      getSessionContext.mockReturnValueOnce({
        config: {
          parentConversationId: 'conv-1',
          prompt: 'Original task',
          model: 'claude-sonnet-4-6',
        },
        provider: storedProvider,
        allProviders: [storedProvider],
        conversationSummary: 'Done',
        messages: [{ id: 'u1', role: 'user', content: 'Original task', timestamp: 1 }],
      });
      mockHydrateProviderForRequest.mockResolvedValueOnce(hydratedProvider);
      launchSubAgent.mockResolvedValueOnce({
        sessionId: 'new-anthropic',
        status: 'running',
        depth: 2,
      });

      await executeSessionSend(
        { sessionId: 'old-anthropic', message: 'continue' },
        MOCK_PROVIDER,
        'gpt-5.4-mini',
      );

      expect(mockHydrateProviderForRequest).toHaveBeenCalledWith(storedProvider);
      expect(launchSubAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          parentConversationId: 'conv-1',
          model: 'claude-sonnet-4-6',
        }),
        hydratedProvider,
        [hydratedProvider],
      );
    });

    it('returns an error when the stored worker provider no longer has an API key', async () => {
      const {
        getSubAgent,
        getSessionContext,
        launchSubAgent,
      } = require('../../src/services/agents/subAgent');
      const storedProvider = {
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: '',
        model: 'claude-sonnet-4-6',
        enabled: true,
      };

      getSubAgent.mockReturnValueOnce({
        status: 'completed',
        output: 'Done',
        parentConversationId: 'conv-1',
      });
      getSessionContext.mockReturnValueOnce({
        config: {
          parentConversationId: 'conv-1',
          prompt: 'Original task',
          model: 'claude-sonnet-4-6',
        },
        provider: storedProvider,
        conversationSummary: 'Done',
        messages: [{ id: 'u1', role: 'user', content: 'Original task', timestamp: 1 }],
      });
      mockHydrateProviderForRequest.mockResolvedValueOnce(storedProvider);

      const result = await executeSessionSend(
        { sessionId: 'old-missing-key', message: 'continue' },
        MOCK_PROVIDER,
        'gpt-5.4-mini',
      );
      const parsed = JSON.parse(result);

      expect(parsed.status).toBe('error');
      expect(parsed.error).toContain('Worker provider "Anthropic" has no API key configured.');
      expect(launchSubAgent).not.toHaveBeenCalled();
    });

    it('handles re-spawn failure', async () => {
      const { getSubAgent, launchSubAgent } = require('../../src/services/agents/subAgent');
      getSubAgent.mockReturnValueOnce({
        status: 'completed',
        output: 'Done',
        parentConversationId: 'conv-1',
      });
      launchSubAgent.mockRejectedValueOnce(new Error('spawn failed'));
      const result = await executeSessionSend(
        { sessionId: 'old-456', message: 'more' },
        MOCK_PROVIDER,
      );
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('error');
      expect(parsed.error).toContain('spawn failed');
    });
  });

  describe('executeSessionHistory', () => {
    it('returns persisted transcript messages when bounded session context is available', async () => {
      const { getSubAgent, getSessionContext } = require('../../src/services/agents/subAgent');
      getSubAgent.mockReturnValueOnce({
        sessionId: 'hist-1',
        status: 'completed',
        startedAt: 10,
        updatedAt: 20,
        currentActivity: 'Done',
        output: 'Final output',
        activityLog: [{ timestamp: 15, kind: 'status', text: 'Completed read_file' }],
      });
      getSessionContext.mockReturnValueOnce({
        config: {
          parentConversationId: 'conv-1',
          prompt: 'Inspect the repository',
          linkUnderstandingEnabled: true,
          mediaUnderstandingEnabled: true,
        },
        provider: MOCK_PROVIDER,
        systemPrompt: 'You are a focused worker.',
        conversationSummary: 'Repository inspection completed.',
        messages: [
          {
            id: 'm1',
            role: 'user',
            content: 'Inspect the repository',
            timestamp: 11,
            attachments: [
              {
                id: 'att-1',
                type: 'file',
                uri: 'file:///tmp/report.pdf',
                name: 'report.pdf',
                mimeType: 'application/pdf',
                size: 2048,
              },
            ],
          },
          {
            id: 'm2',
            role: 'assistant',
            content: 'Reading the main config file.',
            timestamp: 12,
            toolCalls: [{ id: 'tc-1', name: 'read_file', arguments: '{}', status: 'completed' }],
          },
          {
            id: 'm3',
            role: 'tool',
            content: '{"summary":"Config loaded"}',
            toolCallId: 'tc-1',
            timestamp: 13,
          },
          {
            id: 'm4',
            role: 'assistant',
            content: 'Repository inspection completed.',
            timestamp: 14,
          },
        ],
      });

      const result = await executeSessionHistory({ sessionId: 'hist-1', maxMessages: 4 });
      const parsed = JSON.parse(result);

      expect(parsed.historySource).toBe('persisted-transcript');
      expect(parsed.conversationSummary).toBe('Repository inspection completed.');
      expect(parsed.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: 'Inspect the repository',
            attachments: [expect.objectContaining({ id: 'att-1', name: 'report.pdf' })],
          }),
          expect.objectContaining({
            role: 'tool',
            content: '{"summary":"Config loaded"}',
            toolCallId: 'tc-1',
          }),
        ]),
      );
      expect(
        parsed.messages.find((message: any) => message.role === 'assistant')?.toolCalls,
      ).toEqual([expect.objectContaining({ id: 'tc-1', name: 'read_file', status: 'completed' })]);
    });

    it('falls back to activity log history without breaking JSON structure', async () => {
      const { getSubAgent, getSessionContext } = require('../../src/services/agents/subAgent');
      getSubAgent.mockReturnValueOnce({
        sessionId: 'hist-2',
        status: 'completed',
        startedAt: 100,
        updatedAt: 200,
        currentActivity: 'Idle',
        output: 'A'.repeat(6000),
        activityLog: Array.from({ length: 6 }, (_, index) => ({
          timestamp: 110 + index,
          kind: index % 2 === 0 ? 'status' : 'message',
          text: `Activity ${index}`,
        })),
      });
      getSessionContext.mockReturnValueOnce(undefined);

      const result = await executeSessionHistory({ sessionId: 'hist-2', maxMessages: 6 });
      const parsed = JSON.parse(result);

      expect(parsed.historySource).toBe('activity-log');
      expect(parsed.messages.length).toBeGreaterThan(0);
      expect(parsed.messages[parsed.messages.length - 1]).toEqual(
        expect.objectContaining({
          role: 'assistant',
        }),
      );
      expect(typeof result).toBe('string');
    });
  });

  describe('executePdfRead', () => {
    it('returns info for local PDF path', async () => {
      const result = await executePdfRead({ path: '/mock/docs/test.pdf' });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('unsupported');
    });

    it('extracts text from HTML rendition', async () => {
      const htmlBody =
        '<html><body><p>Important document content here for testing extraction</p>' +
        '<p>Second paragraph with enough text to pass the 100 char minimum threshold</p></body></html>';
      (global as any).fetch = jest.fn().mockResolvedValue({
        ok: true,
        headers: { get: (h: string) => (h === 'content-type' ? 'text/html; charset=utf-8' : null) },
        text: jest.fn().mockResolvedValue(htmlBody),
      });

      const result = await executePdfRead({ path: 'https://example.com/doc.pdf' });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('extracted');
      expect(parsed.method).toBe('html_rendition');
      expect(parsed.content).toContain('Important document content');
      delete (global as any).fetch;
    });

    it('fetches PDF from URL', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        headers: new Map([
          ['content-type', 'application/pdf'],
          ['content-length', '12345'],
        ]),
        text: jest.fn().mockResolvedValue('PDF content here'),
      });
      // Make headers.get work like a real Headers object
      mockFetch.mockResolvedValue({
        ok: true,
        headers: {
          get: (h: string) =>
            h === 'content-type' ? 'application/pdf' : h === 'content-length' ? '12345' : null,
        },
        text: jest.fn().mockResolvedValue('PDF content here'),
      });
      (global as any).fetch = mockFetch;

      const result = await executePdfRead({ path: 'https://example.com/doc.pdf' });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('fetched_but_not_parsed');
      expect(parsed.suggestion).toContain('PDF text extraction');

      delete (global as any).fetch;
    });

    it('returns direct text for non-HTML non-PDF responses', async () => {
      (global as any).fetch = jest.fn().mockResolvedValue({
        ok: true,
        headers: { get: (h: string) => (h === 'content-type' ? 'text/plain' : null) },
        text: jest.fn().mockResolvedValue('Plain text document content'),
      });

      const result = await executePdfRead({ path: 'https://example.com/doc.txt' });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('extracted');
      expect(parsed.method).toBe('direct_text');
      expect(parsed.content).toContain('Plain text document');
      delete (global as any).fetch;
    });

    it('handles HTTP error status', async () => {
      (global as any).fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        headers: { get: () => null },
      });

      const result = await executePdfRead({ path: 'https://example.com/missing.pdf' });
      const parsed = JSON.parse(result);
      expect(parsed.error).toContain('HTTP 404');
      delete (global as any).fetch;
    });

    it('handles URL fetch error', async () => {
      const mockFetch = jest.fn().mockRejectedValue(new Error('Network error'));
      (global as any).fetch = mockFetch;

      const result = await executePdfRead({ path: 'https://example.com/fail.pdf' });
      const parsed = JSON.parse(result);
      expect(parsed.error).toContain('Network error');

      delete (global as any).fetch;
    });
  });

  describe('executeCameraSnap', () => {
    it('takes a photo', async () => {
      const result = await executeCameraSnap({});
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('captured');
    });

    it('handles cancelled photo', async () => {
      const ImagePicker = require('expo-image-picker');
      ImagePicker.launchCameraAsync.mockResolvedValueOnce({ canceled: true, assets: [] });
      const result = await executeCameraSnap({});
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('cancelled');
    });

    it('handles camera error with JSON format', async () => {
      const ImagePicker = require('expo-image-picker');
      ImagePicker.launchCameraAsync.mockRejectedValueOnce(new Error('Camera denied'));
      const result = await executeCameraSnap({});
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('error');
      expect(parsed.error).toBe('Camera denied');
    });

    it('uses front camera when specified', async () => {
      const result = await executeCameraSnap({ camera: 'front', quality: 0.5 });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('captured');
    });
  });

  describe('executeAudioTranscribe', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    const flushPromisesAndTimers = async () => {
      // Alternate between flushing microtask queue and advancing timers
      for (let i = 0; i < 10; i++) {
        await Promise.resolve();
        jest.advanceTimersByTime(1000);
      }
    };

    it('returns transcription result', async () => {
      const promise = executeAudioTranscribe({ durationMs: 100 });
      await flushPromisesAndTimers();
      const result = await promise;
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('transcribed');
      expect(parsed.text).toBe('hello');
    });

    it('handles null audio URI', async () => {
      const voice = require('../../src/services/voice/voice');
      voice.stopRecording.mockResolvedValueOnce(null);
      const promise = executeAudioTranscribe({});
      await flushPromisesAndTimers();
      const result = await promise;
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('error');
      expect(parsed.error).toContain('No audio');
    });

    it('handles transcription error', async () => {
      const voice = require('../../src/services/voice/voice');
      voice.startRecording.mockRejectedValueOnce(new Error('mic denied'));
      const result = await executeAudioTranscribe({});
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('error');
      expect(parsed.error).toBe('mic denied');
    });
  });

  describe('executeMemorySearch', () => {
    it('searches memory for a query', async () => {
      const result = await executeMemorySearch({ query: 'test search' });
      const parsed = JSON.parse(result);
      expect(parsed).toHaveProperty('results');
      expect(parsed.method).toBe('text');
    });

    it('handles missing query gracefully', async () => {
      const result = await executeMemorySearch({ query: '' });
      expect(typeof result).toBe('string');
    });

    it('uses hybrid search when embedding config provided', async () => {
      const { sqliteHybridSearch } = require('../../src/services/memory/sqlite-store');
      sqliteHybridSearch.mockResolvedValueOnce([{ source: 'MEMORY.md', snippet: 'result', score: 0.9 }]);
      const result = await executeMemorySearch(
        { query: 'search test', maxResults: 5 },
        { provider: 'openai', apiKey: 'k' },
      );
      const parsed = JSON.parse(result);
      expect(parsed.method).toBe('hybrid');
    });

    it('returns a degraded sqlite result on hybrid error', async () => {
      const { sqliteHybridSearch } = require('../../src/services/memory/sqlite-store');
      sqliteHybridSearch.mockRejectedValueOnce(new Error('embed fail'));
      const result = await executeMemorySearch(
        { query: 'fallback', maxResults: 5 },
        { provider: 'openai', apiKey: 'k' },
      );
      const parsed = JSON.parse(result);
      expect(parsed.method).toBe('hybrid');
      expect(parsed.index).toBe('sqlite');
      expect(parsed.degraded).toBe(true);
    });
  });

  describe('executeCanvasEval', () => {
    it('returns error for non-existent surface', async () => {
      const result = await executeCanvasEval({ surfaceId: 'missing', script: 'console.log(1)' });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('error');
      expect(parsed.error).toContain('unable to find canvas surface');
    });

    it('evaluates script on existing surface', async () => {
      const { getSurface } = require('../../src/services/canvas/renderer');
      getSurface.mockImplementation((id: string) =>
        id === 'surf-1' ? { id: 'surf-1', title: 'Test' } : undefined,
      );
      const result = await executeCanvasEval({ surfaceId: 'surf-1', script: '1+1' });
      expect(result).toBe('eval_result');
    });

    it('catches eval errors and returns JSON', async () => {
      const { getSurface, requestCanvasEval } = require('../../src/services/canvas/renderer');
      getSurface.mockImplementation((id: string) =>
        id === 'surf-1' ? { id: 'surf-1', title: 'Test' } : undefined,
      );
      requestCanvasEval.mockRejectedValueOnce(new Error('eval syntax error'));
      const result = await executeCanvasEval({ surfaceId: 'surf-1', script: 'bad((' });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('error');
      expect(parsed.error).toBe('eval syntax error');
    });
  });

  describe('executeCanvasUpdate — error handling', () => {
    it('catches processCanvasMessage errors and returns JSON error', async () => {
      const { getSurface, processCanvasMessage } = require('../../src/services/canvas/renderer');
      getSurface.mockImplementation((id: string) =>
        id === 'surf-1' ? { id: 'surf-1', title: 'Test' } : undefined,
      );
      processCanvasMessage.mockImplementationOnce(() => {
        throw new Error('render crash');
      });
      const result = await executeCanvasUpdate({
        surfaceId: 'surf-1',
        components: [{ id: 'c1', type: 'text', props: { text: 'v2' } }],
      });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('error');
      expect(parsed.error).toBe('render crash');
    });
  });

  describe('executeCanvasUpdate — content (raw HTML) update', () => {
    it('sends updateContent message when content field provided', async () => {
      const { getSurface, processCanvasMessage } = require('../../src/services/canvas/renderer');
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
      const { getSurface, processCanvasMessage } = require('../../src/services/canvas/renderer');
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
      const { getSurface, processCanvasMessage } = require('../../src/services/canvas/renderer');
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
      const { getSurface } = require('../../src/services/canvas/renderer');
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
      const { getSurface } = require('../../src/services/canvas/renderer');
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
      const { getSurface } = require('../../src/services/canvas/renderer');
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

  describe('executeSessionSend — error safety', () => {
    it('handles non-Error thrown objects in re-spawn failure', async () => {
      const { getSubAgent, launchSubAgent } = require('../../src/services/agents/subAgent');
      getSubAgent.mockReturnValueOnce({
        status: 'completed',
        output: 'Done',
        parentConversationId: 'conv-1',
      });
      launchSubAgent.mockRejectedValueOnce('string error');
      const result = await executeSessionSend(
        { sessionId: 'old-789', message: 'more' },
        MOCK_PROVIDER,
      );
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('error');
      expect(parsed.error).toBe('string error');
    });
  });

  describe('executeCameraSnap — error safety', () => {
    it('handles non-Error thrown objects', async () => {
      const ImagePicker = require('expo-image-picker');
      ImagePicker.launchCameraAsync.mockRejectedValueOnce({ code: 'PERMS' });
      const result = await executeCameraSnap({});
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('error');
      expect(typeof parsed.error).toBe('string');
    });
  });
});
