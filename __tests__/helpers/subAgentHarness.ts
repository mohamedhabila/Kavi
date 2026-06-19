jest.mock('../../src/engine/orchestrator', () => ({
  runOrchestrator: jest.fn().mockImplementation((_opts: any, callbacks: any) => {
    callbacks.onToken?.('mock output');
    callbacks.onDone?.();
    return Promise.resolve();
  }),
  MAX_TOOL_ITERATIONS: 25,
}));

let mockIdCounter = 0;
let mockWorkspaceTargets: any[] = [];
jest.mock('../../src/utils/id', () => ({
  generateId: jest.fn(() => `mock-id-${++mockIdCounter}`),
}));

jest.mock('../../src/store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      workspaceTargets: mockWorkspaceTargets,
    }),
  },
}));

jest.mock('../../src/services/storage/SecureStorage', () => ({
  getProviderApiKey: jest.fn().mockResolvedValue(null),
}));

import {
  __resetSubAgentStateForTests,
  cancelSubAgent,
  getSessionContext,
  launchSubAgent,
  spawnSubAgent,
  startSubAgent,
  listActiveSubAgents,
  getSubAgent,
  cleanupSubAgents,
} from '../../src/services/agents/subAgent';
import { LlmService } from '../../src/services/llm/LlmService';
import { useChatStore } from '../../src/store/useChatStore';
import type { LlmProviderConfig } from '../../src/types/provider';

export const mockProvider: LlmProviderConfig = {
  id: 'test',
  name: 'Test',
  type: 'openai' as any,
  apiKey: 'key',
  baseUrl: 'http://test',
  model: 'gpt-5.4',
  models: ['gpt-5.4'],
  enabled: true,
};

function makeStream(...events: any[]) {
  return (async function* () {
    for (const event of events) {
      yield event;
    }
  })();
}

export function makeStructuredFinalizerResponse(
  report: string,
  completionState: 'verified_success' | 'blocked' | 'incomplete',
  usage?: Partial<{
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    totalTokens: number;
  }>,
) {
  return {
    output_parsed: {
      report,
      completionState,
    },
    ...(usage
      ? {
          usage: {
            inputTokens: usage.inputTokens ?? 0,
            outputTokens: usage.outputTokens ?? 0,
            cacheReadTokens: usage.cacheReadTokens ?? 0,
            cacheWriteTokens: usage.cacheWriteTokens ?? 0,
            totalTokens: usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
          },
        }
      : {}),
  };
}


export {
  cancelSubAgent,
  cleanupSubAgents,
  getSessionContext,
  getSubAgent,
  launchSubAgent,
  listActiveSubAgents,
  spawnSubAgent,
  startSubAgent,
};
export { useChatStore };

export let streamMessageSpy: jest.SpyInstance;
export let sendMessageSpy: jest.SpyInstance;

export function installSubAgentTestHarness() {
  beforeEach(async () => {
    await __resetSubAgentStateForTests();
    mockIdCounter = 0;
    mockWorkspaceTargets = [];
    useChatStore.setState({
      conversations: [],
      activeConversationId: null,
      isLoading: false,
    });
    const { runOrchestrator } = require('../../src/engine/orchestrator');
    runOrchestrator.mockReset();
    runOrchestrator.mockImplementation((_opts: any, callbacks: any) => {
      callbacks.onToken?.('mock output');
      callbacks.onDone?.();
      return Promise.resolve();
    });
    streamMessageSpy = jest
      .spyOn(LlmService.prototype, 'streamMessage')
      .mockImplementation(() => makeStream({ type: 'done', content: '' }) as any);
    sendMessageSpy = jest.spyOn(LlmService.prototype, 'sendMessage').mockResolvedValue({});
  });

  afterEach(() => {
    jest.useRealTimers();
    streamMessageSpy.mockRestore();
    sendMessageSpy.mockRestore();
  });
}
