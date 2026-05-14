// ---------------------------------------------------------------------------
// Tests for new parity executor functions:
// canvas_navigate, canvas_eval, canvas_read, canvas_snapshot,
// sessions_history, sessions_status,
// tool_catalog, speak, agents_list, agents_switch, agents_configure
// ---------------------------------------------------------------------------

jest.mock('../../src/services/canvas/renderer', () => ({
  processCanvasMessage: jest.fn(),
  getSurface: jest.fn().mockReturnValue(undefined),
  getAllSurfaces: jest.fn().mockReturnValue([]),
  getFocusedCanvasSurfaceId: jest.fn().mockReturnValue(null),
  requestCanvasEval: jest.fn().mockResolvedValue(
    JSON.stringify({
      status: 'eval_dispatched',
      surfaceId: 'surf-1',
      note: 'Canvas screen is not active. Navigate to Canvas to see results.',
    }),
  ),
  requestCanvasRead: jest.fn().mockResolvedValue(
    JSON.stringify({
      status: 'read_completed',
      surfaceId: 'surf-1',
      modeUsed: 'source',
      contentType: 'raw_html',
      content: '<html></html>',
    }),
  ),
  requestCanvasSnapshot: jest.fn().mockResolvedValue(
    JSON.stringify({
      status: 'snapshot_requested',
      surfaceId: 'surf-1',
      format: 'png',
      note: 'Canvas screen is not active. Navigate to Canvas to capture.',
    }),
  ),
}));

jest.mock('../../src/services/agents/subAgent', () => ({
  spawnSubAgent: jest.fn().mockResolvedValue({
    sessionId: 'sub-mock-123',
    output: 'Sub agent output',
    toolsUsed: [],
    iterations: 1,
    status: 'completed',
  }),
  launchSubAgent: jest.fn().mockResolvedValue({
    sessionId: 'sub-mock-123',
    status: 'running',
    depth: 1,
  }),
  listActiveSubAgents: jest.fn().mockReturnValue([]),
  getSubAgent: jest.fn().mockReturnValue(undefined),
  getSubAgentsByParent: jest.fn().mockReturnValue([]),
  cancelSubAgent: jest.fn().mockResolvedValue(undefined),
  getSessionContext: jest.fn().mockReturnValue(undefined),
}));

jest.mock('../../src/services/voice/voice', () => ({
  speakText: jest.fn().mockResolvedValue(undefined),
  startRecording: jest.fn().mockResolvedValue(undefined),
  stopRecording: jest.fn().mockResolvedValue('/tmp/audio.m4a'),
  transcribeAudio: jest.fn().mockResolvedValue({
    text: 'hello',
    language: 'en',
    duration: 2.5,
  }),
}));

jest.mock('../../src/services/memory/embeddings', () => ({
  hybridSearch: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../src/services/memory/sqlite-store', () => ({
  indexMemoryToSqlite: jest.fn().mockResolvedValue(0),
  sqliteHybridSearch: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../src/services/memory/store', () => ({
  searchMemory: jest.fn().mockReturnValue([]),
}));

jest.mock('../../src/services/agents/personas', () => ({
  BUILT_IN_PERSONAS: [
    { id: 'default', name: 'Assistant', description: 'General AI', icon: '🤖' },
    { id: 'coder', name: 'Coder', description: 'Dev expert', icon: '💻' },
  ],
  getPersona: jest.fn().mockImplementation((id: string) => {
    const personas: any = {
      default: { id: 'default', name: 'Assistant', description: 'General AI', icon: '🤖' },
      coder: { id: 'coder', name: 'Coder', description: 'Dev expert', icon: '💻' },
    };
    return personas[id];
  }),
}));

jest.mock('../../src/engine/tools/definitions', () => ({
  TOOL_DEFINITIONS: [
    { name: 'read_file', description: 'Read file' },
    { name: 'write_file', description: 'Write file' },
    { name: 'list_files', description: 'List files' },
    { name: 'file_edit', description: 'Edit file' },
    { name: 'glob_search', description: 'Glob search files' },
    { name: 'text_search', description: 'Search text in files' },
    { name: 'web_search', description: 'Search the web' },
    { name: 'web_fetch', description: 'Fetch a web page as clean text' },
    { name: 'javascript', description: 'Run JavaScript' },
    { name: 'python', description: 'Run Python' },
    { name: 'browser_navigate', description: 'Navigate browser' },
    { name: 'browser_click', description: 'Click browser element' },
    { name: 'browser_snapshot', description: 'Snapshot browser page' },
    { name: 'canvas_list', description: 'List canvases' },
    { name: 'canvas_read', description: 'Read canvas' },
    { name: 'canvas_create', description: 'Create canvas' },
    { name: 'image_generate', description: 'Generate image' },
    { name: 'image_edit', description: 'Edit image' },
    { name: 'speak', description: 'Speak text' },
  ],
}));

jest.mock('../../src/services/mcp/manager', () => ({
  mcpManager: {
    getAllStatuses: jest.fn().mockReturnValue([]),
  },
}));

jest.mock('../../src/services/skills/manager', () => ({
  getSkillToolDefinitions: jest.fn().mockReturnValue([]),
  isSkillCompatible: jest.fn().mockReturnValue({ compatible: true }),
  useSkillsStore: {
    getState: jest.fn().mockReturnValue({
      getEnabled: () => [],
    }),
  },
}));

jest.mock('expo-image-picker', () => ({
  launchCameraAsync: jest.fn().mockResolvedValue({ canceled: true }),
  CameraType: { front: 'front', back: 'back' },
}));

jest.mock('../../src/utils/id', () => ({
  generateId: jest.fn().mockReturnValue('mock-id-123'),
}));

import {
  executeCanvasNavigate,
  executeCanvasEval,
  executeCanvasRead,
  executeCanvasSnapshot,
  executeCanvasList,
  executeSessionHistory,
  executeSessionStatus,
  executeSessionCancel,
  executeSessionYield,
  executeToolCatalog,
  executePollCreate,
  executeMessageEffect,
  executeSpeak,
  executeAgentsList,
  executeAgentsSwitch,
  executeAgentsConfigure,
  executeMemorySearch,
} from '../../src/engine/tools/parity-executor';

describe('New Parity Tool Executors', () => {
  beforeEach(() => {
    const renderer = require('../../src/services/canvas/renderer');
    const { mcpManager } = require('../../src/services/mcp/manager');
    const {
      useSkillsStore,
      isSkillCompatible,
      getSkillToolDefinitions,
    } = require('../../src/services/skills/manager');
    renderer.processCanvasMessage.mockReset();
    renderer.processCanvasMessage.mockImplementation(() => undefined);
    renderer.getSurface.mockReset();
    renderer.getSurface.mockReturnValue(undefined);
    renderer.getAllSurfaces.mockReset();
    renderer.getAllSurfaces.mockReturnValue([]);
    renderer.getFocusedCanvasSurfaceId.mockReset();
    renderer.getFocusedCanvasSurfaceId.mockReturnValue(null);
    renderer.requestCanvasEval.mockReset();
    renderer.requestCanvasEval.mockResolvedValue(
      JSON.stringify({
        status: 'eval_dispatched',
        surfaceId: 'surf-1',
        note: 'Canvas screen is not active. Navigate to Canvas to see results.',
      }),
    );
    renderer.requestCanvasRead.mockReset();
    renderer.requestCanvasRead.mockResolvedValue(
      JSON.stringify({
        status: 'read_completed',
        surfaceId: 'surf-1',
        modeUsed: 'source',
        contentType: 'raw_html',
        content: '<html></html>',
      }),
    );
    renderer.requestCanvasSnapshot.mockReset();
    renderer.requestCanvasSnapshot.mockResolvedValue(
      JSON.stringify({
        status: 'snapshot_requested',
        surfaceId: 'surf-1',
        format: 'png',
        note: 'Canvas screen is not active. Navigate to Canvas to capture.',
      }),
    );
    mcpManager.getAllStatuses.mockReturnValue([]);
    useSkillsStore.getState.mockReturnValue({
      getEnabled: () => [],
    });
    isSkillCompatible.mockReturnValue({ compatible: true });
    getSkillToolDefinitions.mockReturnValue([]);

    jest.clearAllMocks();
    const sqliteStore = require('../../src/services/memory/sqlite-store');
    sqliteStore.indexMemoryToSqlite.mockReset();
    sqliteStore.indexMemoryToSqlite.mockResolvedValue(0);
    sqliteStore.sqliteHybridSearch.mockReset();
    sqliteStore.sqliteHybridSearch.mockResolvedValue([]);
  });

  // ── Canvas Navigate ──────────────────────────────────────────────

  describe('executeCanvasNavigate', () => {
    it('returns error for non-existent surface', async () => {
      const result = await executeCanvasNavigate({ surfaceId: 'none', url: 'https://example.com' });
      expect(result).toContain('Error');
      expect(result).toContain('unable to find canvas surface');
    });

    it('processes navigate message for existing surface', async () => {
      const { getSurface, processCanvasMessage } = require('../../src/services/canvas/renderer');
      getSurface.mockImplementation((id: string) =>
        id === 'surf-1' ? { id: 'surf-1', state: 'active' } : undefined,
      );

      const result = await executeCanvasNavigate({
        surfaceId: 'surf-1',
        url: 'https://example.com',
      });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('navigated');
      expect(parsed.url).toBe('https://example.com/');
      expect(processCanvasMessage).toHaveBeenCalledWith({
        type: 'navigate',
        surfaceId: 'surf-1',
        url: 'https://example.com/',
      });
    });

    it('rejects local file paths and non-http urls', async () => {
      const { getSurface, processCanvasMessage } = require('../../src/services/canvas/renderer');
      getSurface.mockImplementation((id: string) =>
        id === 'surf-1' ? { id: 'surf-1', state: 'active' } : undefined,
      );

      const result = await executeCanvasNavigate({
        surfaceId: 'surf-1',
        url: 'file:///tmp/index.html',
      });

      expect(result).toContain('Error');
      expect(result).toContain('http or https');
      expect(processCanvasMessage).not.toHaveBeenCalled();
    });

    it('falls back to the focused surface when alias id is wrong', async () => {
      const {
        getAllSurfaces,
        getFocusedCanvasSurfaceId,
        getSurface,
        processCanvasMessage,
      } = require('../../src/services/canvas/renderer');
      getAllSurfaces.mockReturnValueOnce([
        { id: 'surf-9', title: 'Focused Canvas', state: 'active' },
      ]);
      getFocusedCanvasSurfaceId.mockReturnValueOnce('surf-9');
      getSurface.mockImplementation((id: string) =>
        id === 'surf-9' ? { id: 'surf-9', state: 'active' } : undefined,
      );

      const result = await executeCanvasNavigate({
        canvas: 'wrong-name',
        url: 'https://example.com/app',
      } as any);
      const parsed = JSON.parse(result);

      expect(parsed.status).toBe('navigated');
      expect(parsed.surfaceId).toBe('surf-9');
      expect(parsed.note).toContain('Using focused surface');
      expect(processCanvasMessage).toHaveBeenCalledWith({
        type: 'navigate',
        surfaceId: 'surf-9',
        url: 'https://example.com/app',
      });
    });
  });

  // ── Canvas Eval ──────────────────────────────────────────────────

  describe('executeCanvasEval', () => {
    it('returns JSON error for non-existent surface', async () => {
      const result = await executeCanvasEval({ surfaceId: 'none', script: 'alert(1)' });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('error');
      expect(parsed.error).toContain('unable to find canvas surface');
    });

    it('dispatches eval for existing surface', async () => {
      const { getSurface, requestCanvasEval } = require('../../src/services/canvas/renderer');
      getSurface.mockImplementation((id: string) =>
        id === 'surf-1' ? { id: 'surf-1', title: 'Test' } : undefined,
      );
      requestCanvasEval.mockResolvedValueOnce(
        JSON.stringify({ status: 'eval_completed', surfaceId: 'surf-1', result: '42' }),
      );

      const result = await executeCanvasEval({ surfaceId: 'surf-1', script: 'return 42' });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('eval_completed');
      expect(requestCanvasEval).toHaveBeenCalledWith('surf-1', 'return 42');
    });

    it('accepts the code alias and focused surface fallback', async () => {
      const {
        getAllSurfaces,
        getFocusedCanvasSurfaceId,
        getSurface,
        requestCanvasEval,
      } = require('../../src/services/canvas/renderer');
      getAllSurfaces.mockReturnValueOnce([{ id: 'surf-1', title: 'Test', state: 'active' }]);
      getFocusedCanvasSurfaceId.mockReturnValueOnce('surf-1');
      getSurface.mockImplementation((id: string) =>
        id === 'surf-1' ? { id: 'surf-1', title: 'Test' } : undefined,
      );
      requestCanvasEval.mockResolvedValueOnce(
        JSON.stringify({ status: 'eval_completed', surfaceId: 'surf-1', result: 'ok' }),
      );

      const result = await executeCanvasEval({
        surface: 'missing-surface',
        code: 'document.title',
      } as any);
      const parsed = JSON.parse(result);

      expect(parsed.status).toBe('eval_completed');
      expect(parsed.note).toContain('Using focused surface');
      expect(requestCanvasEval).toHaveBeenCalledWith('surf-1', 'document.title');
    });

    it('returns a JSON error when script is missing', async () => {
      const { getSurface } = require('../../src/services/canvas/renderer');
      getSurface.mockImplementation((id: string) =>
        id === 'surf-1' ? { id: 'surf-1', title: 'Test' } : undefined,
      );

      const result = await executeCanvasEval({ surfaceId: 'surf-1' } as any);
      const parsed = JSON.parse(result);

      expect(parsed.status).toBe('error');
      expect(parsed.error).toContain('script');
    });
  });

  describe('executeCanvasList', () => {
    it('lists existing surfaces and returns edit guidance', async () => {
      const {
        getAllSurfaces,
        getFocusedCanvasSurfaceId,
      } = require('../../src/services/canvas/renderer');
      getAllSurfaces.mockReturnValueOnce([
        {
          id: 'surf-1',
          title: 'Draft Board',
          state: 'active',
          renderMode: 'components',
          components: [{ id: 'c1', type: 'text', props: { text: 'Hello' } }],
          dataModel: { mode: 'draft' },
        },
      ]);
      getFocusedCanvasSurfaceId.mockReturnValueOnce('surf-1');

      const result = await executeCanvasList({});
      const parsed = JSON.parse(result);

      expect(parsed.status).toBe('listed');
      expect(parsed.count).toBe(1);
      expect(parsed.focusedSurfaceId).toBe('surf-1');
      expect(parsed.surfaces[0]).toMatchObject({
        surfaceId: 'surf-1',
        title: 'Draft Board',
        componentCount: 1,
        dataKeys: ['mode'],
        isFocused: true,
      });
      expect(parsed.guidance).toContain('canvas_update');
      expect(parsed.guidance).toContain('canvas_read');
      expect(parsed.guidance).toContain('avoid unrelated workspace file tools');
    });
  });

  describe('executeCanvasRead', () => {
    it('reads canvas content for an existing surface', async () => {
      const { getSurface, requestCanvasRead } = require('../../src/services/canvas/renderer');
      getSurface.mockImplementation((id: string) =>
        id === 'surf-1' ? { id: 'surf-1', title: 'Read Test' } : undefined,
      );
      requestCanvasRead.mockResolvedValueOnce(
        JSON.stringify({
          status: 'read_completed',
          surfaceId: 'surf-1',
          modeUsed: 'source',
          contentType: 'raw_html',
          content: '<html><body>Read me</body></html>',
        }),
      );

      const result = await executeCanvasRead({ surfaceId: 'surf-1' });
      const parsed = JSON.parse(result);

      expect(parsed.status).toBe('read_completed');
      expect(parsed.contentType).toBe('raw_html');
      expect(requestCanvasRead).toHaveBeenCalledWith('surf-1', {
        mode: 'auto',
        maxChars: undefined,
      });
    });

    it('accepts aliases and focused-surface fallback', async () => {
      const {
        getAllSurfaces,
        getFocusedCanvasSurfaceId,
        getSurface,
        requestCanvasRead,
      } = require('../../src/services/canvas/renderer');
      getAllSurfaces.mockReturnValueOnce([
        { id: 'surf-3', title: 'Live Preview', state: 'active' },
      ]);
      getFocusedCanvasSurfaceId.mockReturnValueOnce('surf-3');
      getSurface.mockImplementation((id: string) =>
        id === 'surf-3' ? { id: 'surf-3', title: 'Live Preview' } : undefined,
      );
      requestCanvasRead.mockResolvedValueOnce(
        JSON.stringify({
          status: 'read_completed',
          surfaceId: 'surf-3',
          modeUsed: 'dom',
          contentType: 'live_dom',
          content: '<html>dom</html>',
        }),
      );

      const result = await executeCanvasRead({
        canvas: 'missing-surface',
        readMode: 'dom',
        maxLength: 4096,
      } as any);
      const parsed = JSON.parse(result);

      expect(parsed.status).toBe('read_completed');
      expect(parsed.note).toContain('Using focused surface');
      expect(requestCanvasRead).toHaveBeenCalledWith('surf-3', { mode: 'dom', maxChars: 4096 });
    });
  });

  // ── Canvas Snapshot ──────────────────────────────────────────────

  describe('executeCanvasSnapshot', () => {
    it('returns error for non-existent surface', async () => {
      const { requestCanvasSnapshot } = require('../../src/services/canvas/renderer');
      requestCanvasSnapshot.mockResolvedValueOnce(`Error: surface not found: none`);

      const result = await executeCanvasSnapshot({ surfaceId: 'none' });
      expect(result).toContain('Error');
    });

    it('requests snapshot with default format', async () => {
      const { getSurface, requestCanvasSnapshot } = require('../../src/services/canvas/renderer');
      getSurface.mockImplementation((id: string) =>
        id === 'surf-1' ? { id: 'surf-1', title: 'Snap' } : undefined,
      );
      requestCanvasSnapshot.mockResolvedValueOnce(
        JSON.stringify({ status: 'snapshot_captured', surfaceId: 'surf-1', format: 'png' }),
      );

      const result = await executeCanvasSnapshot({ surfaceId: 'surf-1' });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('snapshot_captured');
      expect(requestCanvasSnapshot).toHaveBeenCalledWith('surf-1', 'png', undefined);
    });

    it('requests snapshot with jpeg format', async () => {
      const { getSurface, requestCanvasSnapshot } = require('../../src/services/canvas/renderer');
      getSurface.mockImplementation((id: string) =>
        id === 'surf-1' ? { id: 'surf-1', title: 'Snap' } : undefined,
      );
      requestCanvasSnapshot.mockResolvedValueOnce(
        JSON.stringify({ status: 'snapshot_captured', surfaceId: 'surf-1', format: 'jpeg' }),
      );

      const result = await executeCanvasSnapshot({
        surfaceId: 'surf-1',
        format: 'jpeg',
        quality: 0.5,
      });
      const parsed = JSON.parse(result);
      expect(requestCanvasSnapshot).toHaveBeenCalledWith('surf-1', 'jpeg', 0.5);
    });

    it('reuses the focused surface when no explicit id is supplied', async () => {
      const {
        getAllSurfaces,
        getFocusedCanvasSurfaceId,
        getSurface,
        requestCanvasSnapshot,
      } = require('../../src/services/canvas/renderer');
      getAllSurfaces.mockReturnValueOnce([{ id: 'surf-7', title: 'Preview', state: 'active' }]);
      getFocusedCanvasSurfaceId.mockReturnValueOnce('surf-7');
      getSurface.mockImplementation((id: string) =>
        id === 'surf-7' ? { id: 'surf-7', title: 'Preview' } : undefined,
      );
      requestCanvasSnapshot.mockResolvedValueOnce(
        JSON.stringify({ status: 'snapshot_captured', surfaceId: 'surf-7', format: 'png' }),
      );

      const result = await executeCanvasSnapshot({} as any);
      const parsed = JSON.parse(result);

      expect(parsed.status).toBe('snapshot_captured');
      expect(parsed.note).toContain('Using focused surface');
      expect(requestCanvasSnapshot).toHaveBeenCalledWith('surf-7', 'png', undefined);
    });
  });

  // ── Session History ──────────────────────────────────────────────

  describe('executeSessionHistory', () => {
    it('returns error for non-existent session', async () => {
      const result = await executeSessionHistory({ sessionId: 'none' });
      expect(result).toContain('Error');
      expect(result).toContain('session not found');
    });

    it('returns history for existing session', async () => {
      const { getSubAgent } = require('../../src/services/agents/subAgent');
      getSubAgent.mockReturnValueOnce({
        sessionId: 'sub-1',
        status: 'completed',
        startedAt: 1000,
        output: 'Hello from sub-agent',
      });

      const result = await executeSessionHistory({ sessionId: 'sub-1' });
      const parsed = JSON.parse(result);
      expect(parsed.sessionId).toBe('sub-1');
      expect(parsed.status).toBe('completed');
      expect(parsed.messages).toHaveLength(1);
      expect(parsed.messages[0].content).toBe('Hello from sub-agent');
    });
  });

  // ── Session Status ───────────────────────────────────────────────

  describe('executeSessionStatus', () => {
    it('returns error for non-existent session', async () => {
      const result = await executeSessionStatus({ sessionId: 'none' });
      expect(result).toContain('Error');
    });

    it('returns status for existing session', async () => {
      const { getSubAgent } = require('../../src/services/agents/subAgent');
      getSubAgent.mockReturnValueOnce({
        sessionId: 'sub-1',
        status: 'running',
        startedAt: Date.now() - 5000,
        output: 'In progress...',
        currentActivity: 'Reading repository files',
        activeToolName: 'read_file',
      });

      const result = await executeSessionStatus({ sessionId: 'sub-1' });
      const parsed = JSON.parse(result);
      expect(parsed.sessionId).toBe('sub-1');
      expect(parsed.status).toBe('running');
      expect(parsed.hasOutput).toBe(true);
      expect(parsed.currentActivity).toBe('Reading repository files');
      expect(parsed.activeToolName).toBe('read_file');
      expect(parsed.elapsedMs).toBeGreaterThan(0);
      expect(parsed.recommendedWaitMs).toBeGreaterThan(0);
      expect(parsed.guidance).toContain('sessions_cancel');
    });
  });

  describe('executeSessionCancel', () => {
    it('cancels a running session', async () => {
      const { getSubAgent, cancelSubAgent } = require('../../src/services/agents/subAgent');
      getSubAgent.mockReturnValueOnce({
        sessionId: 'sub-1',
        status: 'running',
        startedAt: Date.now() - 5000,
      });

      const result = await executeSessionCancel({ sessionId: 'sub-1', reason: 'Wrong approach' });
      const parsed = JSON.parse(result);

      expect(cancelSubAgent).toHaveBeenCalledWith('sub-1', 'Wrong approach');
      expect(parsed.status).toBe('cancel_requested');
      expect(parsed.sessionId).toBe('sub-1');
    });
  });

  describe('executeSessionYield', () => {
    it('returns a terminal finalize signal when there are no running sub-agents', async () => {
      const result = await executeSessionYield({}, 'conv-1');
      const parsed = JSON.parse(result);

      expect(parsed.status).toBe('completed');
      expect(parsed.finalizeSupervisor).toBe(true);
      expect(parsed.pendingSessions).toEqual([]);
      expect(parsed.guidance).toContain('Finalize the supervisor response');
    });

    it('returns a checkpoint result when background sub-agents exist', async () => {
      const { getSubAgentsByParent } = require('../../src/services/agents/subAgent');
      getSubAgentsByParent.mockReturnValueOnce([
        {
          sessionId: 'sub-1',
          status: 'running',
          startedAt: 123,
        },
      ]);

      const result = await executeSessionYield(
        { message: 'Waiting for research worker' },
        'conv-1',
      );
      const parsed = JSON.parse(result);

      expect(parsed.status).toBe('checkpointed');
      expect(parsed.autoResumeSupported).toBe(false);
      expect(parsed.finalizeSupervisor).toBe(false);
      expect(parsed.message).toBe('Waiting for research worker');
      expect(parsed.pendingSessions).toHaveLength(1);
      expect(parsed.pendingSessions[0].sessionId).toBe('sub-1');
    });
  });

  // ── Tool Catalog ─────────────────────────────────────────────────

  describe('executeToolCatalog', () => {
    it('returns all categories when no filter', async () => {
      const result = await executeToolCatalog({});
      const parsed = JSON.parse(result);
      expect(parsed.categories).toBeDefined();
      expect(Array.isArray(parsed.categories)).toBe(true);
      expect(parsed.categories.length).toBeGreaterThan(0);
      expect(parsed.guidance).toContain('category="files"');

      const categoryNames = parsed.categories.map((c: any) => c.category);
      expect(categoryNames).toContain('files');
      expect(categoryNames).toContain('browser');
      expect(categoryNames).toContain('workspace');
      expect(categoryNames).toContain('canvas');
      expect(categoryNames).toContain('sessions');
      expect(categoryNames).toContain('agents');
      expect(categoryNames).toContain('native');
      expect(categoryNames).toContain('media');
      expect(categoryNames).toContain('memory');
      expect(categoryNames).toContain('web');
      expect(categoryNames).toContain('code');
    });

    it('filters by category', async () => {
      const result = await executeToolCatalog({ category: 'canvas' });
      const parsed = JSON.parse(result);
      expect(parsed.category).toBe('canvas');
      expect(parsed.purpose).toContain('session canvas previews');
      expect(parsed.tools).toBeDefined();
      expect(parsed.tools).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'canvas_read' })]),
      );
      expect(parsed.guidance).toContain('canvas_list');
      expect(parsed.guidance).toContain('canvas_read');
      expect(parsed.guidance).toContain('workspace file tools');
    });

    it('returns browser tools when filtering by browser', async () => {
      const result = await executeToolCatalog({ category: 'browser' });
      const parsed = JSON.parse(result);

      expect(parsed.category).toBe('browser');
      expect(parsed.purpose).toContain('control websites interactively');
      expect(parsed.tools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'browser_navigate' }),
          expect.objectContaining({ name: 'browser_click' }),
          expect.objectContaining({ name: 'browser_snapshot' }),
        ]),
      );
      expect(parsed.activation).toEqual(
        expect.objectContaining({
          callableNextTurn: true,
          recommendedToolNames: expect.arrayContaining(['browser_navigate']),
          category: 'browser',
        }),
      );
      expect(parsed.activation.rationale).toContain('website automation');
    });

    it('returns supporting activation tools when a category has more than the primary recommendation set', async () => {
      const result = await executeToolCatalog({ category: 'files' });
      const parsed = JSON.parse(result);

      expect(parsed.category).toBe('files');
      expect(parsed.activation).toEqual(
        expect.objectContaining({
          callableNextTurn: true,
          recommendedToolNames: expect.arrayContaining([
            'read_file',
            'write_file',
            'list_files',
            'file_edit',
          ]),
          supportingToolNames: expect.arrayContaining(['glob_search', 'text_search']),
          category: 'files',
        }),
      );
    });

    it('returns both javascript and python when filtering by code', async () => {
      const result = await executeToolCatalog({ category: 'code' });
      const parsed = JSON.parse(result);

      expect(parsed.category).toBe('code');
      expect(parsed.tools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'javascript' }),
          expect.objectContaining({ name: 'python' }),
        ]),
      );
      expect(parsed.activation).toEqual(
        expect.objectContaining({
          callableNextTurn: true,
          recommendedToolNames: expect.arrayContaining(['javascript', 'python']),
          category: 'code',
        }),
      );
      expect(parsed.guidance).toContain('python');
      expect(parsed.guidance).toContain('capability-extension tool');
      expect(parsed.guidance).toContain('DOCX/XLSX/HTML/SVG/CSV');
    });

    it('returns both image generation and image editing when filtering by media', async () => {
      const result = await executeToolCatalog({ category: 'media' });
      const parsed = JSON.parse(result);

      expect(parsed.category).toBe('media');
      expect(parsed.purpose).toContain('generate, or edit media');
      expect(parsed.tools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'image_generate' }),
          expect.objectContaining({ name: 'image_edit' }),
        ]),
      );
      expect(parsed.activation).toEqual(
        expect.objectContaining({
          callableNextTurn: true,
          recommendedToolNames: expect.arrayContaining(['image_generate', 'image_edit']),
          category: 'media',
        }),
      );
      expect(parsed.guidance).toContain('image_edit');
    });

    it('searches tools by natural-language query and recommends the best matches', async () => {
      const result = await executeToolCatalog({
        query: 'inspect a website and interact with the page',
      });
      const parsed = JSON.parse(result);

      expect(parsed.mode).toBe('search');
      expect(parsed.query).toBe('inspect a website and interact with the page');
      expect(parsed.matches).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'browser_navigate', category: 'browser' }),
          expect.objectContaining({ name: 'browser_snapshot', category: 'browser' }),
        ]),
      );
      expect(parsed.activation).toEqual(
        expect.objectContaining({
          callableNextTurn: true,
          recommendedToolNames: expect.arrayContaining(['browser_snapshot']),
          supportingToolNames: expect.arrayContaining(['browser_navigate']),
        }),
      );
      expect(parsed.guidance).toContain('matched tools next');
    });

    it('returns a structured error for unknown categories', async () => {
      const result = await executeToolCatalog({ category: 'unknown' });
      const parsed = JSON.parse(result);

      expect(parsed.error).toContain('Unknown tool_catalog category');
      expect(parsed.availableCategories).toContain('files');
      expect(parsed.availableCategories).toContain('browser');
      expect(parsed.guidance).toContain('query="what you need to do"');
    });

    it('includes connected MCP tools and installed skills in the catalog', async () => {
      const { mcpManager } = require('../../src/services/mcp/manager');
      const {
        useSkillsStore,
        getSkillToolDefinitions,
      } = require('../../src/services/skills/manager');

      mcpManager.getAllStatuses.mockReturnValue([
        {
          id: 'srv-1',
          name: 'Docs MCP',
          state: 'connected',
          tools: [{ name: 'search_docs', description: 'Search docs', inputSchema: {} }],
        },
      ]);
      useSkillsStore.getState.mockReturnValue({
        getEnabled: () => [
          {
            id: 'skill-1',
            enabled: true,
            installedAt: 1,
            metadata: {
              name: 'Weather Skill',
              description: 'Forecast helper',
              version: '1.0.0',
              invocationPolicy: 'auto',
              tools: [],
            },
            source: {
              source: 'clawhub',
              id: 'skill-1',
              url: 'https://hub.kavi.dev/skill-1',
            },
          },
        ],
      });
      getSkillToolDefinitions.mockReturnValue([
        {
          name: 'skill__weather__forecast',
          description: '[Weather Skill] Forecast helper',
          input_schema: { type: 'object', properties: {} },
        },
      ]);

      const result = await executeToolCatalog({});
      const parsed = JSON.parse(result);

      expect(parsed.mode).toBe('overview');
      expect(parsed.totalMcpTools).toBe(1);
      expect(parsed.totalSkills).toBe(1);
      expect(parsed.totalSkillTools).toBe(1);
      expect(parsed.activation).toEqual(
        expect.objectContaining({
          callableNextTurn: false,
          requiresCategorySelection: true,
        }),
      );
      expect(parsed.categories).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            category: 'mcp',
            sampleTools: ['mcp__srv-1__search_docs'],
            inspectWith: 'tool_catalog category="mcp"',
          }),
          expect.objectContaining({
            category: 'skills',
            sampleTools: ['skill__weather__forecast'],
            inspectWith: 'tool_catalog category="skills"',
            skills: ['Weather Skill'],
          }),
        ]),
      );
    });

    it('returns detailed MCP and skills listings for dynamic categories', async () => {
      const { mcpManager } = require('../../src/services/mcp/manager');
      const {
        useSkillsStore,
        getSkillToolDefinitions,
      } = require('../../src/services/skills/manager');

      mcpManager.getAllStatuses.mockReturnValue([
        {
          id: 'srv-1',
          name: 'Docs MCP',
          state: 'connected',
          tools: [{ name: 'search_docs', description: 'Search docs', inputSchema: {} }],
        },
        {
          id: 'srv-2',
          name: 'Private MCP',
          state: 'error',
          tools: [],
          authRequired: true,
        },
      ]);
      useSkillsStore.getState.mockReturnValue({
        getEnabled: () => [
          {
            id: 'skill-1',
            enabled: true,
            installedAt: 1,
            metadata: {
              name: 'Weather Skill',
              description: 'Forecast helper',
              version: '1.0.0',
              invocationPolicy: 'manual',
              tools: [],
            },
            source: {
              source: 'clawhub',
              id: 'skill-1',
              url: 'https://hub.kavi.dev/skill-1',
            },
          },
        ],
      });
      getSkillToolDefinitions.mockReturnValue([
        {
          name: 'skill__weather__forecast',
          description: '[Weather Skill] Forecast helper',
          input_schema: { type: 'object', properties: {} },
        },
      ]);

      const mcpResult = JSON.parse(await executeToolCatalog({ category: 'mcp' }));
      expect(mcpResult.mode).toBe('category');
      expect(mcpResult.tools).toEqual([
        expect.objectContaining({
          name: 'mcp__srv-1__search_docs',
          serverName: 'Docs MCP',
        }),
      ]);
      expect(mcpResult.activation).toEqual(
        expect.objectContaining({
          callableNextTurn: true,
          recommendedToolNames: ['mcp__srv-1__search_docs'],
          category: 'mcp',
        }),
      );
      expect(mcpResult.pendingServers).toEqual([
        expect.objectContaining({
          name: 'Private MCP',
          authRequired: true,
        }),
      ]);

      const skillsResult = JSON.parse(await executeToolCatalog({ category: 'skills' }));
      expect(skillsResult.mode).toBe('category');
      expect(skillsResult.skills).toEqual([
        expect.objectContaining({
          name: 'Weather Skill',
          invocationPolicy: 'manual',
          location: 'skills/weather-skill-skill-1/SKILL.md',
        }),
      ]);
      expect(skillsResult.tools).toEqual([
        expect.objectContaining({
          name: 'skill__weather__forecast',
        }),
      ]);
      expect(skillsResult.activation).toEqual(
        expect.objectContaining({
          callableNextTurn: true,
          recommendedToolNames: ['skill__weather__forecast'],
          category: 'skills',
        }),
      );
    });

    it('searches inside MCP tools when category and query are both provided', async () => {
      const { mcpManager } = require('../../src/services/mcp/manager');

      mcpManager.getAllStatuses.mockReturnValue([
        {
          id: 'srv-1',
          name: 'Docs MCP',
          state: 'connected',
          tools: [
            {
              name: 'search_docs',
              description: 'Search product documentation and API references',
              inputSchema: {},
            },
            { name: 'create_issue', description: 'Create an issue', inputSchema: {} },
          ],
        },
      ]);

      const result = JSON.parse(
        await executeToolCatalog({ category: 'mcp', query: 'search documentation references' }),
      );

      expect(result.mode).toBe('search');
      expect(result.category).toBe('mcp');
      expect(result.matches).toEqual([
        expect.objectContaining({
          name: 'mcp__srv-1__search_docs',
          category: 'mcp',
          serverName: 'Docs MCP',
        }),
      ]);
      expect(result.activation).toEqual(
        expect.objectContaining({
          callableNextTurn: true,
          recommendedToolNames: ['mcp__srv-1__search_docs'],
          category: 'mcp',
        }),
      );
    });

    it('keeps MCP catalog results truthful when the current tool policy hides dynamic tools', async () => {
      const { mcpManager } = require('../../src/services/mcp/manager');

      mcpManager.getAllStatuses.mockReturnValue([
        {
          id: 'srv-1',
          name: 'Docs MCP',
          state: 'connected',
          tools: [{ name: 'search_docs', description: 'Search docs', inputSchema: {} }],
        },
      ]);

      const result = JSON.parse(
        await executeToolCatalog(
          { category: 'mcp' },
          { availableToolNames: new Set(['tool_catalog']) },
        ),
      );

      expect(result.category).toBe('mcp');
      expect(result.tools).toEqual([]);
      expect(result.activation).toEqual(
        expect.objectContaining({
          callableNextTurn: false,
          recommendedToolNames: [],
        }),
      );
      expect(result.guidance).toContain('No callable MCP tools are available');
    });
  });

  describe('interactive helpers', () => {
    it('creates poll payloads with normalized options', async () => {
      const result = await executePollCreate({
        question: 'Pick a plan',
        options: ['Alpha', ' Beta ', ''],
      });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('created');
      expect(parsed.poll.options).toHaveLength(2);
      expect(parsed.poll.options[1].label).toBe('Beta');
    });

    it('validates message effect ids', async () => {
      const result = await executeMessageEffect({ effectId: 'confetti' });
      expect(JSON.parse(result).effectId).toBe('confetti');

      const invalid = await executeMessageEffect({ effectId: 'unknown' });
      expect(JSON.parse(invalid).status).toBe('error');
    });
  });

  // ── Speak ────────────────────────────────────────────────────────

  describe('executeSpeak', () => {
    it('speaks text with default provider', async () => {
      const voice = require('../../src/services/voice/voice');
      const result = await executeSpeak({ text: 'Hello world' });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('spoken');
      expect(parsed.textLength).toBe(11);
      expect(parsed.provider).toBe('system');
      expect(voice.speakText).toHaveBeenCalledWith('Hello world', 'system');
    });

    it('speaks with specified provider', async () => {
      const voice = require('../../src/services/voice/voice');
      const result = await executeSpeak({ text: 'Hi', provider: 'openai' });
      const parsed = JSON.parse(result);
      expect(parsed.provider).toBe('openai');
      expect(voice.speakText).toHaveBeenCalledWith('Hi', 'openai');
    });

    it('handles speak errors', async () => {
      const voice = require('../../src/services/voice/voice');
      voice.speakText.mockRejectedValueOnce(new Error('TTS unavailable'));

      const result = await executeSpeak({ text: 'Hi' });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('error');
      expect(parsed.error).toContain('TTS unavailable');
    });
  });

  // ── Agents List ──────────────────────────────────────────────────

  describe('executeAgentsList', () => {
    it('returns built-in personas', async () => {
      const result = await executeAgentsList();
      const parsed = JSON.parse(result);
      expect(parsed.agents).toBeDefined();
      expect(parsed.agents.length).toBeGreaterThanOrEqual(2);

      const names = parsed.agents.map((a: any) => a.name);
      expect(names).toContain('Assistant');
      expect(names).toContain('Coder');
    });
  });

  // ── Agents Switch ───────────────────────────────────────────────

  describe('executeAgentsSwitch', () => {
    it('switches to an existing persona', async () => {
      const result = await executeAgentsSwitch({ personaId: 'coder' });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('switched');
      expect(parsed.personaId).toBe('coder');
      expect(parsed.name).toBe('Coder');
    });

    it('returns error for unknown persona', async () => {
      const result = await executeAgentsSwitch({ personaId: 'unknown' });
      expect(result).toContain('Error');
      expect(result).toContain('persona not found');
    });
  });

  // ── Agents Configure ─────────────────────────────────────────────

  describe('executeAgentsConfigure', () => {
    it('creates a new custom persona', async () => {
      const result = await executeAgentsConfigure({
        personaId: 'custom-1',
        name: 'My Agent',
        systemPrompt: 'You are a custom agent.',
      });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('created');
      expect(parsed.persona.name).toBe('My Agent');
    });

    it('configures an existing persona', async () => {
      // First create it
      await executeAgentsConfigure({
        personaId: 'custom-2',
        name: 'Agent A',
        systemPrompt: 'Original prompt',
      });

      // Then update it
      const result = await executeAgentsConfigure({
        personaId: 'custom-2',
        name: 'Agent B',
        temperature: 0.7,
      });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('configured');
      expect(parsed.persona.name).toBe('Agent B');
    });
  });

  // ── Memory Search with Citations ─────────────────────────────────

  describe('executeMemorySearch (with citations)', () => {
    it('returns citation-formatted results', async () => {
      const { sqliteHybridSearch } = require('../../src/services/memory/sqlite-store');
      sqliteHybridSearch.mockResolvedValueOnce([
        { source: 'MEMORY.md', snippet: 'User prefers dark mode', score: 0.9 },
        { source: 'daily/2024-01-15.md', snippet: 'Discussed project setup', score: 0.6 },
      ]);

      const result = await executeMemorySearch({ query: 'preferences' });
      const parsed = JSON.parse(result);
      expect(parsed.method).toBe('text');
      expect(parsed.results).toHaveLength(2);
      expect(parsed.results[0].citation).toBe('[1] MEMORY.md');
      expect(parsed.results[0].relevance).toBe('90%');
      expect(parsed.results[1].citation).toBe('[2] daily/2024-01-15.md');
    });
  });
});
