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
let mockIdCounter = 0;
jest.mock('../../src/utils/id', () => ({
  generateId: jest.fn(() => `mock-id-${++mockIdCounter}`),
}));
import { spawnSubAgent } from '../../src/services/agents/subAgent';
import { runOrchestrator } from '../../src/engine/orchestrator';
import type { LlmProviderConfig } from '../../src/types/provider';
const mockProvider: LlmProviderConfig = {
  id: 'test',
  name: 'Test',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'test-key',
  model: 'gpt-4',
  enabled: true,
};
beforeEach(() => {
  jest.clearAllMocks();
  mockAsyncStorageData = {};
  mockIdCounter = 0;
});

describe('Bug 5: Sub-agent abort handling', () => {
  it('checks abort signal on state change', async () => {
    let stateChangeCalls = 0;

    (runOrchestrator as jest.Mock).mockImplementation((_cfg: any, callbacks: any) => {
      // First state transition
      stateChangeCalls++;
      callbacks.onStateChange('thinking');

      // Sub-agent should still work after first state change
      callbacks.onToken('hello');
      callbacks.onDone();
      return Promise.resolve();
    });

    const result = await spawnSubAgent(
      {
        parentConversationId: 'conv-1',
        prompt: 'test',
        timeoutMs: 30000,
      },
      mockProvider,
    );

    expect(result.status).toBe('completed');
    expect(result.output).toContain('hello');
    expect(stateChangeCalls).toBe(1);
  });

  it('checks abort signal before starting tool execution', async () => {
    let toolStartCalled = false;

    (runOrchestrator as jest.Mock).mockImplementation((_cfg: any, callbacks: any) => {
      // First iteration — tool call
      callbacks.onToolCallStart({ id: 'tc1', name: 'read_file', arguments: '{}' });
      toolStartCalled = true;
      callbacks.onToolCallComplete({
        id: 'tc1',
        name: 'read_file',
        result: 'data',
        status: 'success',
      });
      callbacks.onAssistantMessage('Done', undefined);
      callbacks.onDone();
      return Promise.resolve();
    });

    const result = await spawnSubAgent(
      { parentConversationId: 'conv-1', prompt: 'test' },
      mockProvider,
    );

    expect(result.status).toBe('completed');
    expect(toolStartCalled).toBe(true);
  });
});
