let mockAsyncStorageData: Record<string, string> = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockAsyncStorageData[key] ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockAsyncStorageData[key] = value;
  }),
  removeItem: jest.fn(async (key: string) => {
    delete mockAsyncStorageData[key];
  }),
}));

jest.mock('../../src/engine/orchestrator', () => ({
  runOrchestrator: jest.fn().mockResolvedValue(undefined),
}));

export const mockFinalizationStreamMessage = jest.fn();

jest.mock('../../src/services/llm/LlmService', () => ({
  LlmService: jest.fn().mockImplementation(() => ({
    streamMessage: (...args: any[]) => mockFinalizationStreamMessage(...args),
  })),
}));

let mockIdCounter = 0;

jest.mock('../../src/utils/id', () => ({
  generateId: jest.fn(() => `mock-id-${++mockIdCounter}`),
}));

import { File } from 'expo-file-system';
import { runOrchestrator } from '../../src/engine/orchestrator';
import {
  __resetSubAgentStateForTests,
  cleanupSubAgents,
  detectOrphans,
  getSessionContext,
  getSubAgent,
  getSubAgentsByParent,
  initSubAgentRegistry,
  isToolAllowedBySandbox,
  launchSubAgent,
  listActiveSubAgents,
  MAX_SPAWN_DEPTH,
  onSubAgentEvent,
  spawnSubAgent,
  startSubAgent,
  type ActiveSubAgent,
} from '../../src/services/agents/subAgent';
import * as throttledStorageModule from '../../src/store/throttledStorage';
import { _getStorageFileUris, flushPendingStorageWrites } from '../../src/store/throttledStorage';

export { runOrchestrator };
export {
  cleanupSubAgents,
  detectOrphans,
  getSessionContext,
  getSubAgent,
  getSubAgentsByParent,
  initSubAgentRegistry,
  isToolAllowedBySandbox,
  launchSubAgent,
  listActiveSubAgents,
  MAX_SPAWN_DEPTH,
  onSubAgentEvent,
  spawnSubAgent,
  startSubAgent,
};
export type { ActiveSubAgent };
export { flushPendingStorageWrites, throttledStorageModule };

const expoFileSystemMock = jest.requireMock('expo-file-system') as {
  __resetStore: () => void;
  __getStore: () => Record<string, string | Uint8Array>;
};

export const REGISTRY_KEY = 'kavi-sub-agents';
export const REGISTRY_CONTEXTS_KEY = 'kavi-sub-agent-contexts';

function createAsyncEventStream(events: any[] = []) {
  return (async function* stream() {
    for (const event of events) {
      yield event;
    }
  })();
}

export function writePersistedJson(key: string, value: unknown): void {
  const { primary } = _getStorageFileUris(key);
  new File(primary).write(JSON.stringify(value));
}

export function readPersistedJson<T>(key: string): T | undefined {
  const { primary } = _getStorageFileUris(key);
  const value = expoFileSystemMock.__getStore()[primary];
  return typeof value === 'string' ? (JSON.parse(value) as T) : undefined;
}

export const mockProvider = {
  id: 'test',
  name: 'Test',
  provider: 'openai' as const,
  apiKey: 'test-key',
  model: 'gpt-4',
  enabled: true,
};

export function resetSubAgentDurabilityMockState() {
  mockAsyncStorageData = {};
  mockIdCounter = 0;
}

export function installSubAgentDurabilityHarness() {
  beforeEach(async () => {
    await __resetSubAgentStateForTests();
    await flushPendingStorageWrites();
    expoFileSystemMock.__resetStore();
    resetSubAgentDurabilityMockState();
    jest.clearAllMocks();
    mockFinalizationStreamMessage.mockReset();
    mockFinalizationStreamMessage.mockImplementation(() => createAsyncEventStream());
    (runOrchestrator as jest.Mock).mockReset();
    (runOrchestrator as jest.Mock).mockImplementation((_cfg: any, callbacks: any) => {
      callbacks.onDone?.();
      return Promise.resolve();
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });
}
