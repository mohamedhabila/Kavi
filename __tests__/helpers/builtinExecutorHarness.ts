// ---------------------------------------------------------------------------
// Builtin Tool Executor — tests
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
  observeBackgroundSubAgentResult: jest.fn(),
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

jest.mock('../../src/services/llm/support/providerSupport', () => {
  const actual = jest.requireActual('../../src/services/llm/support/providerSupport');
  return {
    ...actual,
    hydrateProviderForRequest: (...args: any[]) => mockHydrateProviderForRequest(...args),
  };
});

import { makeBuiltinExecutorProvider } from '../fixtures/providers';
import {
  executeCanvasCreate,
  executeCanvasDelete,
  executeCanvasUpdate,
} from '../../src/engine/tools/builtin-canvas-mutationExecution';
import { executeCanvasEval } from '../../src/engine/tools/builtin-canvas-runtime';
import { executeSessionSpawn } from '../../src/engine/tools/builtin-session-spawn';
import {
  executeSessionHistory,
  executeSessionList,
} from '../../src/engine/tools/builtin-session-history';
import { executeSessionSend } from '../../src/engine/tools/builtin-session-send';
import { executePdfRead } from '../../src/engine/tools/builtin-utility';
import { executeAudioTranscribe, executeCameraSnap } from '../../src/engine/tools/builtin-media';
import { executeMemorySearch } from '../../src/engine/tools/builtin-memory';

const MOCK_PROVIDER = makeBuiltinExecutorProvider() as any;

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

export {
  executeCanvasCreate,
  executeCanvasDelete,
  executeCanvasUpdate,
  executeCanvasEval,
  executeSessionSpawn,
  executeSessionHistory,
  executeSessionList,
  executeSessionSend,
  executePdfRead,
  executeAudioTranscribe,
  executeCameraSnap,
  executeMemorySearch,
  MOCK_PROVIDER,
  mockChatStoreState,
  mockSettingsState,
  mockHydrateProviderForRequest,
};
