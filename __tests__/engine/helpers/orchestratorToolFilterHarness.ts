import type { OrchestratorCallbacks, OrchestratorOptions } from '../../../src/engine/orchestrator';
import type { ToolMessageOutcome } from '../../../src/engine/toolExecution/toolMessageOutcome';
import type { Message } from '../../../src/types/message';
import type { LlmProviderConfig } from '../../../src/types/provider';

export const mockStreamMessage = jest.fn();
let mockWorkspaceTargets: any[] = [];
let mockDisableLongTermMemory = false;
const mockMemoryAuthoritySnapshot = Object.freeze({
  processEpochs: Object.freeze({ restrictive: 0, projection: 0 }),
  restrictiveRevision: Object.freeze({
    kind: 'restrictive' as const,
    memoryOwnerId: 'test-memory-owner',
    value: 0,
  }),
  projectionRevision: Object.freeze({
    kind: 'projection' as const,
    memoryOwnerId: 'test-memory-owner',
    value: 0,
  }),
  policy: Object.freeze({ enabled: true as const, revision: 0 }),
});

jest.mock('../../../src/services/llm/LlmService', () => ({
  LlmService: jest.fn().mockImplementation(() => ({
    streamMessage: mockStreamMessage,
  })),
}));

export const mockExecuteTool = jest
  .fn()
  .mockResolvedValue({ status: 'completed', content: 'tool result' });
jest.mock('../../../src/engine/tools/index', () => ({
  executeTool: (...args: any[]) => mockExecuteTool(...args),
  normalizeToolName: jest.fn((name: string) => name.trim()),
}));

jest.mock('../../../src/services/events/bus', () => ({
  emitSessionEvent: jest.fn().mockResolvedValue(undefined),
  emitAgentEvent: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../src/services/usage/tracker', () => ({
  recordUsage: jest.fn(),
  normalizeUsage: jest.fn().mockReturnValue({
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
  }),
}));

jest.mock('../../../src/services/mcp/manager', () => ({
  mcpManager: {
    getAllToolDefinitions: jest.fn().mockReturnValue([]),
    getAllStatuses: jest.fn().mockReturnValue([]),
    getClients: jest.fn().mockReturnValue(new Map()),
  },
}));

jest.mock('../../../src/services/skills/manager', () => ({
  getAllLoadedSkills: jest.fn().mockReturnValue([]),
  getSkillToolDefinitions: jest.fn().mockReturnValue([]),
  getSkillSystemPrompts: jest.fn().mockResolvedValue(''),
  filterToolsByInvocationPolicy: jest.fn().mockImplementation((tools: any[]) => tools),
}));

jest.mock('../../../src/services/memory/livingMemoryBridge', () => ({
  buildLivingMemorySections: jest.fn().mockImplementation(async () => ({
    memoryReadEpoch: 0,
    memoryAuthoritySnapshot: mockMemoryAuthoritySnapshot,
    sections: [],
    cacheableSignature: '00000000',
    focusBlockText: '',
    openThreadLabels: [],
    recalledFactCount: 0,
    recalledEpisodeCount: 0,
  })),
}));

jest.mock('../../../src/services/memory/memoryAuthority', () => {
  const actual = jest.requireActual('../../../src/services/memory/memoryAuthority');
  return {
    ...actual,
    captureMemoryAuthoritySnapshot: jest.fn(() =>
      mockDisableLongTermMemory ? null : mockMemoryAuthoritySnapshot,
    ),
    isMemoryProjectionSnapshotCurrent: jest.fn(() => !mockDisableLongTermMemory),
    isMemoryProjectionSnapshotDurablyCurrent: jest.fn(() => !mockDisableLongTermMemory),
    isRestrictiveMemoryAuthoritySnapshotCurrent: jest.fn(() => !mockDisableLongTermMemory),
    isRestrictiveMemoryAuthoritySnapshotDurablyCurrent: jest.fn(() => !mockDisableLongTermMemory),
  };
});

jest.mock('../../../src/services/memory/policy', () => ({
  canReadLongTermMemory: jest.fn(() => !mockDisableLongTermMemory),
  canUseNetworkMemoryProvider: jest.fn(() => !mockDisableLongTermMemory),
  canWriteLongTermMemory: jest.fn(() => !mockDisableLongTermMemory),
  captureMemoryReadEpoch: jest.fn(() => (mockDisableLongTermMemory ? null : 0)),
  getMemoryPolicyEpoch: jest.fn().mockReturnValue(0),
  isLongTermMemoryEnabled: jest.fn(() => !mockDisableLongTermMemory),
  isMemoryPolicyEpochCurrent: jest.fn(() => !mockDisableLongTermMemory),
  isMemoryReadEpochCurrent: jest.fn(() => !mockDisableLongTermMemory),
}));

jest.mock('../../../src/services/commands/parser', () => ({
  isSlashCommand: jest.fn().mockReturnValue(false),
  parseCommand: jest.fn().mockReturnValue(null),
}));

jest.mock('../../../src/services/commands/builtins', () => ({
  getCommand: jest.fn().mockReturnValue(null),
}));

jest.mock('../../../src/services/agents/personas', () => ({
  getPersona: jest.fn().mockReturnValue(undefined),
  resolvePersonaSystemPrompt: jest.fn((_p: any, prompt: string) => prompt),
  resolvePersonaModel: jest.fn((_p: any, pId: string, m: string) => ({
    providerId: pId,
    model: m,
  })),
}));

jest.mock('../../../src/services/agents/registry', () => ({
  getPersona: jest.fn().mockReturnValue(undefined),
}));

jest.mock('../../../src/services/storage/SecureStorage', () => ({
  getProviderApiKey: jest.fn().mockResolvedValue('sk-test'),
}));

jest.mock('../../../src/store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      workspaceTargets: mockWorkspaceTargets,
      disableLongTermMemory: mockDisableLongTermMemory,
    }),
  },
}));

export async function* makeStream(events: any[], terminalDisposition?: 'text' | 'tool') {
  for (const event of events) {
    if (event?.type !== 'done' || event.completion !== undefined) {
      yield event;
      continue;
    }
    if (terminalDisposition === undefined) {
      throw new Error('test_stream_completion_required');
    }
    yield {
      ...event,
      completion: {
        completionStatus: 'complete',
        finishReason: terminalDisposition === 'tool' ? 'tool_calls' : 'stop',
      },
    };
  }
}

export const provider: LlmProviderConfig = {
  id: 'test',
  name: 'Test',
  type: 'openai',
  apiKey: 'sk-test',
  baseUrl: 'https://api.test.com',
  model: 'gpt-test',
  models: ['gpt-test'],
  enabled: true,
};

export function makeCallbacks(): OrchestratorCallbacks & {
  calls: Record<string, any[]>;
} {
  const calls: Record<string, any[]> = {
    onToolCallStart: [],
    onToolCallComplete: [],
    onToolMessage: [],
    onError: [],
    onDone: [],
  };
  return {
    calls,
    onStateChange: jest.fn(),
    onToken: jest.fn(),
    onReasoning: jest.fn(),
    onToolCallStart: jest.fn((toolCall) => calls.onToolCallStart.push(toolCall)),
    onToolCallComplete: jest.fn((toolCall) => calls.onToolCallComplete.push(toolCall)),
    onAssistantMessage: jest.fn(),
    onToolMessage: jest.fn((outcome: ToolMessageOutcome) => calls.onToolMessage.push(outcome)),
    onError: jest.fn((error) => calls.onError.push(error)),
    onUsage: jest.fn(),
    onDone: jest.fn(() => calls.onDone.push(true)),
  };
}

export const makeMsg = (role: 'user' | 'assistant', content: string): Message => ({
  id: `msg-${Math.random()}`,
  role,
  content,
  timestamp: Date.now(),
});

export function setMockDisableLongTermMemory(disabled: boolean): void {
  mockDisableLongTermMemory = disabled;
}

export function resetOrchestratorToolFilterHarness(): void {
  jest.clearAllMocks();
  mockStreamMessage.mockReset();
  mockExecuteTool.mockReset();
  mockExecuteTool.mockResolvedValue({ status: 'completed', content: 'tool result' });
  mockWorkspaceTargets = [];
  mockDisableLongTermMemory = false;
}

export type { OrchestratorOptions };
