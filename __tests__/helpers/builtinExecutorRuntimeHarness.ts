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
    { id: 'default', name: 'Assistant', description: 'General AI', icon: 'assistant' },
    { id: 'coder', name: 'Coder', description: 'Dev expert', icon: 'code' },
  ],
  getPersona: jest.fn().mockImplementation((id: string) => {
    const personas: any = {
      default: { id: 'default', name: 'Assistant', description: 'General AI', icon: 'assistant' },
      coder: { id: 'coder', name: 'Coder', description: 'Dev expert', icon: 'code' },
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

export function installBuiltinExecutorRuntimeReset(): void {
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
}

export {
  executeCanvasEval,
  executeCanvasList,
  executeCanvasNavigate,
  executeCanvasRead,
  executeCanvasSnapshot,
  executeSessionHistory,
  executeSessionOutput,
  executeSessionStatus,
  executeSessionCancel,
  executeSessionYield,
  executeToolCatalog,
  executeMessageEffect,
  executePollCreate,
  executeSpeak,
  executeAgentsConfigure,
  executeAgentsList,
  executeAgentsSwitch,
  executeMemorySearch,
};
