// ---------------------------------------------------------------------------
// Tests for new builtin executor functions:
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
    {
      name: 'read_file',
      description: 'Read file',
      input_schema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
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
    {
      name: 'expo_eas_create_project',
      description: 'Create a new Expo EAS project',
      contract: {
        category: 'expo',
        capabilities: ['write'],
        resourceKinds: ['expo_account', 'expo_project'],
        sideEffects: ['remote_mutation'],
        riskHints: ['requires_approval'],
        providesEvidence: ['expo_project'],
        workflowStages: ['guarded_resource_creation', 'mutate_remote_state'],
      },
    },
    {
      name: 'expo_eas_list_projects',
      description: 'List linked Expo EAS projects',
      contract: {
        category: 'expo',
        capabilities: ['discover', 'read'],
        resourceKinds: ['expo_account', 'expo_project'],
        sideEffects: ['none'],
        riskHints: ['read_only', 'idempotent'],
        providesEvidence: ['expo_project'],
        workflowStages: ['discover_resource'],
      },
    },
    {
      name: 'expo_eas_status',
      description: 'Inspect Expo EAS project status',
      contract: {
        category: 'expo',
        capabilities: ['read', 'verify'],
        resourceKinds: ['expo_project'],
        sideEffects: ['none'],
        riskHints: ['read_only', 'idempotent'],
        providesEvidence: ['expo_project', 'expo_project_ready'],
        workflowStages: ['inspect_resource', 'verify_evidence'],
      },
    },
    {
      name: 'expo_eas_probe',
      description: 'Probe Expo EAS project readiness',
      contract: {
        category: 'expo',
        capabilities: ['verify'],
        resourceKinds: ['expo_project', 'eas_workflow', 'github_repo'],
        sideEffects: ['none'],
        riskHints: ['read_only', 'idempotent'],
        providesEvidence: ['expo_project_ready', 'verification', 'blocker'],
        workflowStages: ['inspect_resource', 'verify_evidence'],
      },
    },
    {
      name: 'expo_eas_workflow_runs',
      description: 'List Expo EAS workflow runs',
      contract: {
        category: 'expo',
        capabilities: ['monitor', 'verify'],
        resourceKinds: ['expo_project', 'eas_workflow'],
        sideEffects: ['none'],
        riskHints: ['read_only', 'idempotent'],
        providesEvidence: ['eas_workflow_triggered', 'verification'],
        workflowStages: ['monitor_external_execution', 'verify_evidence'],
      },
    },
    {
      name: 'expo_eas_workflow_status',
      description: 'Inspect Expo EAS workflow status',
      contract: {
        category: 'expo',
        capabilities: ['monitor', 'verify'],
        resourceKinds: ['expo_project', 'eas_workflow'],
        sideEffects: ['none'],
        riskHints: ['read_only', 'idempotent'],
        providesEvidence: ['eas_workflow_terminal', 'verification', 'blocker'],
        workflowStages: ['monitor_external_execution', 'verify_evidence'],
      },
    },
    {
      name: 'expo_eas_workflow_wait',
      description: 'Wait for Expo EAS workflow completion',
      contract: {
        category: 'expo',
        capabilities: ['monitor', 'wait', 'verify'],
        resourceKinds: ['expo_project', 'eas_workflow'],
        sideEffects: ['none'],
        riskHints: ['read_only', 'idempotent'],
        providesEvidence: ['eas_workflow_terminal', 'verification', 'blocker'],
        workflowStages: [
          'monitor_external_execution',
          'await_external_execution',
          'verify_evidence',
        ],
      },
    },
    {
      name: 'expo_eas_graphql',
      description: 'Run an Expo GraphQL query',
      contract: {
        category: 'expo',
        capabilities: ['read', 'write', 'verify'],
        resourceKinds: ['expo_account', 'expo_project', 'eas_workflow'],
        sideEffects: ['remote_mutation'],
        riskHints: ['open_world', 'requires_approval'],
        providesEvidence: ['verification', 'blocker'],
        workflowStages: ['inspect_resource', 'mutate_remote_state', 'verify_evidence'],
      },
    },
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
  executeCanvasEval,
  executeCanvasList,
  executeCanvasNavigate,
  executeCanvasRead,
  executeCanvasSnapshot,
} from '../../src/engine/tools/builtin-canvas-runtime';
import {
  executeSessionHistory,
  executeSessionOutput,
} from '../../src/engine/tools/builtin-session-history';
import { executeSessionStatus } from '../../src/engine/tools/builtin-session-status';
import {
  executeSessionCancel,
  executeSessionYield,
} from '../../src/engine/tools/builtin-session-control';
import { executeToolCatalog } from '../../src/engine/tools/builtin-tool-catalog';
import {
  executeMessageEffect,
  executePollCreate,
} from '../../src/engine/tools/builtin-interaction';
import { executeSpeak } from '../../src/engine/tools/builtin-media';
import {
  executeAgentsConfigure,
  executeAgentsList,
  executeAgentsSwitch,
} from '../../src/engine/tools/builtin-agents';
import { executeMemorySearch } from '../../src/engine/tools/builtin-memory';

describe('New Builtin Tool Executors', () => {
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
      expect(parsed.status).toBe('snapshot_captured');
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
      expect(parsed.guidance).toContain('sessions_wait');
      expect(parsed.guidance).toContain('polling again');
    });
  });

  describe('executeSessionOutput', () => {
    it('includes compact terminal worker activity evidence', async () => {
      const { getSubAgent } = require('../../src/services/agents/subAgent');
      getSubAgent.mockReturnValueOnce({
        sessionId: 'sub-1',
        status: 'completed',
        startedAt: 1000,
        updatedAt: 2000,
        depth: 1,
        sandboxPolicy: 'inherit',
        output: 'completion_state: verified_success\nWorker done.',
        lastToolResultPreview: 'read_file: verified requested file content.',
        activityLog: [
          { timestamp: 1000, kind: 'tool', text: 'Using read_file: result.txt' },
          { timestamp: 1100, kind: 'result', text: 'read_file: verified requested file content.' },
        ],
      });

      const result = await executeSessionOutput({ sessionId: 'sub-1' });
      const parsed = JSON.parse(result);

      expect(parsed.status).toBe('completed');
      expect(parsed.output).toContain('completion_state: verified_success');
      expect(parsed.lastToolResultPreview).toBe('read_file: verified requested file content.');
      expect(parsed.recentActivity).toEqual([
        { timestamp: 1000, kind: 'tool', text: 'Using read_file: result.txt' },
        { timestamp: 1100, kind: 'result', text: 'read_file: verified requested file content.' },
      ]);
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
      expect(parsed.availableCategories).toBeUndefined();
      expect(parsed.categories[0].purpose).toBeUndefined();

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
      expect(parsed.categories.every((entry: any) => entry.sampleTools.length <= 3)).toBe(true);
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
    });

    it('returns the full calendar mutation workflow when filtering by calendar', async () => {
      const result = await executeToolCatalog({ category: 'calendar' });
      const parsed = JSON.parse(result);

      expect(parsed.category).toBe('calendar');
      expect(parsed.tools.map((tool: any) => tool.name)).toEqual(
        expect.arrayContaining([
          'calendar_list',
          'calendar_events',
          'calendar_create_event',
          'calendar_update_event',
        ]),
      );
    });

    it('ignores unsupported capability filters without hiding category matches', async () => {
      const result = await executeToolCatalog({
        category: 'calendar',
        query: 'calendar create update event',
        capabilities: ['create', 'update', 'write'],
      });
      const parsed = JSON.parse(result);

      expect(parsed.mode).toBe('search');
      expect(parsed.capabilities).toEqual(['write']);
      expect(parsed.tools.map((tool: any) => tool.name)).toEqual(
        expect.arrayContaining(['calendar_create_event', 'calendar_update_event']),
      );
      expect(parsed.totalMatches).toBeGreaterThanOrEqual(2);
    });

    it('treats native catalog search as the structured device-resource family', async () => {
      const result = await executeToolCatalog({
        category: 'native',
        query: 'calendar create update event',
        capabilities: ['create', 'update', 'write'],
      });
      const parsed = JSON.parse(result);

      expect(parsed.mode).toBe('search');
      expect(parsed.category).toBe('native');
      expect(parsed.capabilities).toEqual(['write']);
      expect(parsed.tools.map((tool: any) => tool.name)).toEqual(
        expect.arrayContaining(['calendar_create_event', 'calendar_update_event']),
      );
    });

    it('does not let unknown search categories suppress structural query matches', async () => {
      const result = await executeToolCatalog({
        category: 'mobile',
        query: 'calendar create update event',
        capabilities: ['create', 'update', 'write'],
      });
      const parsed = JSON.parse(result);

      expect(parsed.mode).toBe('search');
      expect(parsed.category).toBeUndefined();
      expect(parsed.tools.map((tool: any) => tool.name)).toEqual(
        expect.arrayContaining(['calendar_create_event', 'calendar_update_event']),
      );
    });

    it('falls back to category matches when a natural query has no structural overlap', async () => {
      const result = await executeToolCatalog({
        category: 'calendar',
        query: 'schedule meeting',
        capabilities: ['write'],
      });
      const parsed = JSON.parse(result);

      expect(parsed.mode).toBe('search');
      expect(parsed.category).toBe('calendar');
      expect(parsed.tools.map((tool: any) => tool.name)).toEqual(
        expect.arrayContaining(['calendar_create_event', 'calendar_update_event']),
      );
    });

    it('returns category workflow coverage for multi-capability discovery hints', async () => {
      const result = await executeToolCatalog({
        category: 'calendar',
        query: 'E2E Native Review Updated by E2E',
        capabilities: ['read', 'write', 'verify'],
      });
      const parsed = JSON.parse(result);
      const toolNames = parsed.tools.map((tool: any) => tool.name);

      expect(parsed.mode).toBe('search');
      expect(parsed.category).toBe('calendar');
      expect(parsed.capabilities).toEqual(['read', 'write', 'verify']);
      expect(toolNames).toEqual(
        expect.arrayContaining([
          'calendar_list',
          'calendar_events',
          'calendar_create_event',
          'calendar_update_event',
        ]),
      );
    });

    it('returns the full category tool list without activation scaffolding', async () => {
      const result = await executeToolCatalog({ category: 'files' });
      const parsed = JSON.parse(result);

      expect(parsed.category).toBe('files');
      expect(parsed.tools.map((tool: any) => tool.name)).toEqual(
        expect.arrayContaining([
          'read_file',
          'list_files',
          'glob_search',
          'text_search',
          'write_file',
          'file_edit',
        ]),
      );
      const readFile = parsed.tools.find((tool: any) => tool.name === 'read_file');
      expect(readFile.schemaDigest).toMatch(/^schema-fnv1a32:[0-9a-f]{8}$/);
      expect(readFile.input_schema).toBeUndefined();
      expect(parsed.activation).toBeUndefined();
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
    });

    it('preserves the explicit category tool order for activation', async () => {
      const result = await executeToolCatalog({ category: 'expo' });
      const parsed = JSON.parse(result);
      const listedNames = parsed.tools.map((tool: any) => tool.name);

      expect(listedNames.slice(0, 4)).toEqual([
        'expo_eas_create_project',
        'expo_eas_list_projects',
        'expo_eas_status',
        'expo_eas_probe',
      ]);
    });

    it('classifies GitHub skill tools from explicit contracts instead of registry inference', async () => {
      const { getSkillToolDefinitions } = require('../../src/services/skills/manager');

      getSkillToolDefinitions.mockReturnValue([
        {
          name: 'skill__github__repos',
          description: '[GitHub] List repositories',
          contract: {
            category: 'github',
            capabilities: ['discover'],
            resourceKinds: ['github_repo'],
            sideEffects: ['none'],
            workflowStages: ['discover_resource'],
          },
        },
        {
          name: 'skill__github__commit_files',
          description: '[GitHub] Commit files',
          contract: {
            category: 'github',
            capabilities: ['write', 'commit', 'push'],
            resourceKinds: ['github_repo', 'github_branch', 'conversation_workspace'],
            sideEffects: ['remote_mutation'],
            workflowStages: ['persist_artifact', 'mutate_remote_state', 'verify_evidence'],
          },
        },
      ]);

      const result = await executeToolCatalog({ category: 'github' });
      const parsed = JSON.parse(result);

      expect(parsed.category).toBe('github');
      expect(parsed.tools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'skill__github__repos' }),
          expect.objectContaining({ name: 'skill__github__commit_files' }),
        ]),
      );
      const listedNames = parsed.tools.map((tool: any) => tool.name);
      expect(listedNames.indexOf('skill__github__repos')).toBeLessThan(
        listedNames.indexOf('skill__github__commit_files'),
      );
    });

    it('returns a structured error for unknown categories', async () => {
      const result = await executeToolCatalog({ category: 'unknown' });
      const parsed = JSON.parse(result);

      expect(parsed.error).toContain('Unknown tool_catalog category');
      expect(parsed.availableCategories).toContain('files');
      expect(parsed.availableCategories).toContain('browser');
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
              url: 'https://clawhub.ai/api/v1/skills/skill-1/file?path=SKILL.md',
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
      expect(parsed.categories).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            category: 'mcp',
            sampleTools: ['mcp__srv-1__search_docs'],
          }),
          expect.objectContaining({
            category: 'skills',
            sampleTools: ['skill__weather__forecast'],
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
              url: 'https://clawhub.ai/api/v1/skills/skill-1/file?path=SKILL.md',
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
          schemaDigest: expect.stringMatching(/^schema-fnv1a32:[0-9a-f]{8}$/),
        }),
      ]);
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
          schemaDigest: expect.stringMatching(/^schema-fnv1a32:[0-9a-f]{8}$/),
        }),
      ]);
    });

    it('marks MCP catalog results discoverable when the current tool policy hides dynamic tools', async () => {
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
      expect(result.tools).toEqual([
        expect.objectContaining({
          name: 'mcp__srv-1__search_docs',
          schemaVersion: 'tool-catalog-entry-v1',
          schemaDigest: expect.stringMatching(/^schema-fnv1a32:[0-9a-f]{8}$/),
          activation: {
            name: 'mcp__srv-1__search_docs',
            eligible: true,
            callableNow: false,
            reason: 'discoverable',
          },
        }),
      ]);
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
