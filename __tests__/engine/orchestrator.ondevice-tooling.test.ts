import {
  runOrchestrator,
  type OrchestratorCallbacks,
  type OrchestratorOptions,
} from '../../src/engine/orchestrator';
import type { LlmProviderConfig } from '../../src/types/provider';
import type { Message } from '../../src/types/message';

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

const mockStreamMessage = jest.fn();

jest.mock('../../src/services/llm/LlmService', () => ({
  LlmService: jest.fn().mockImplementation(() => ({
    streamMessage: mockStreamMessage,
  })),
}));

jest.mock('../../src/engine/tools/index', () => ({
  executeTool: jest.fn().mockResolvedValue({ status: 'completed', content: 'tool result' }),
  normalizeToolName: jest.fn((name: string) => name),
}));

jest.mock('../../src/services/events/bus', () => ({
  emitSessionEvent: jest.fn().mockResolvedValue(undefined),
  emitAgentEvent: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/usage/tracker', () => ({
  recordUsage: jest.fn(),
  normalizeUsage: jest.fn().mockReturnValue({
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
  }),
}));

jest.mock('../../src/services/mcp/manager', () => ({
  mcpManager: {
    getAllToolDefinitions: jest.fn().mockReturnValue([]),
    getAllStatuses: jest.fn().mockReturnValue([]),
    getClients: jest.fn().mockReturnValue(new Map()),
  },
}));

jest.mock('../../src/services/skills/manager', () => ({
  getAllLoadedSkills: jest.fn().mockReturnValue([]),
  getSkillToolDefinitions: jest.fn().mockReturnValue([]),
  getSkillSystemPrompts: jest.fn().mockResolvedValue(''),
  filterToolsByInvocationPolicy: jest.fn().mockImplementation((tools: any[]) => tools),
}));
jest.mock('../../src/services/memory/livingMemoryBridge', () => ({
  buildLivingMemorySections: jest.fn().mockResolvedValue({
    memoryReadEpoch: 0,
    memoryAuthoritySnapshot: mockMemoryAuthoritySnapshot,
    sections: [],
    cacheableSignature: '00000000',
    focusBlockText: '',
    openThreadLabels: [],
    recalledFactCount: 0,
    recalledEpisodeCount: 0,
  }),
}));
jest.mock('../../src/services/memory/memoryAuthority', () => {
  const actual = jest.requireActual('../../src/services/memory/memoryAuthority');
  return {
    ...actual,
    captureMemoryAuthoritySnapshot: jest.fn(() => mockMemoryAuthoritySnapshot),
    isMemoryProjectionSnapshotCurrent: jest.fn().mockReturnValue(true),
    isMemoryProjectionSnapshotDurablyCurrent: jest.fn().mockReturnValue(true),
    isRestrictiveMemoryAuthoritySnapshotCurrent: jest.fn().mockReturnValue(true),
    isRestrictiveMemoryAuthoritySnapshotDurablyCurrent: jest.fn().mockReturnValue(true),
  };
});
jest.mock('../../src/services/memory/policy', () => ({
  canReadLongTermMemory: jest.fn().mockReturnValue(true),
  canUseNetworkMemoryProvider: jest.fn().mockReturnValue(true),
  canWriteLongTermMemory: jest.fn().mockReturnValue(true),
  captureMemoryReadEpoch: jest.fn().mockReturnValue(0),
  getMemoryPolicyEpoch: jest.fn().mockReturnValue(0),
  isLongTermMemoryEnabled: jest.fn().mockReturnValue(true),
  isMemoryPolicyEpochCurrent: jest.fn().mockReturnValue(true),
  isMemoryReadEpochCurrent: jest.fn().mockReturnValue(true),
}));

jest.mock('../../src/services/commands/parser', () => ({
  isSlashCommand: jest.fn().mockReturnValue(false),
  parseCommand: jest.fn().mockReturnValue(null),
}));

jest.mock('../../src/services/commands/builtins', () => ({
  getCommand: jest.fn().mockReturnValue(null),
}));

jest.mock('../../src/services/agents/personas', () => ({
  getPersona: jest.fn().mockReturnValue(undefined),
  resolvePersonaSystemPrompt: jest.fn((_persona: any, prompt: string) => prompt),
  resolvePersonaModel: jest.fn((_persona: any, providerId: string, model: string) => ({
    providerId,
    model,
  })),
}));

async function* makeStream(events: any[]) {
  for (const event of events) {
    yield event;
  }
}

function makeCallbacks(): OrchestratorCallbacks {
  return {
    onStateChange: jest.fn(),
    onToken: jest.fn(),
    onReasoning: jest.fn(),
    onToolCallStart: jest.fn(),
    onToolCallComplete: jest.fn(),
    onAssistantMessage: jest.fn(),
    onToolMessage: jest.fn(),
    onError: jest.fn(),
    onUsage: jest.fn(),
    onDone: jest.fn(),
  };
}

const onDeviceProvider: LlmProviderConfig = {
  id: 'gemma-local',
  name: 'On-device models',
  kind: 'on-device',
  apiKey: '',
  baseUrl: '',
  model: 'gemma-4-E2B-it',
  enabled: true,
  local: {
    runtime: 'litert-lm',
  },
};

const makeOptions = (messages: Message[]): OrchestratorOptions => ({
  provider: onDeviceProvider,
  model: onDeviceProvider.model,
  conversationId: 'conv-local-1',
  systemPrompt: 'You are a test assistant.',
  messages,
});

describe('Orchestrator on-device local tooling support', () => {
  beforeEach(() => {
    mockStreamMessage.mockReset();
  });

  it('advertises and attaches tools for tool-capable on-device local models', async () => {
    mockStreamMessage.mockReturnValue(
      makeStream([
        { type: 'token', content: 'Local answer only.' },
        {
          type: 'done',
          completion: { completionStatus: 'complete', finishReason: 'stop' },
        },
      ]),
    );

    const callbacks = makeCallbacks();
    await runOrchestrator(
      makeOptions([
        {
          id: 'msg-1',
          role: 'user',
          content: 'Read the workspace and summarize it.',
          timestamp: Date.now(),
        } as Message,
      ]),
      callbacks,
    );

    const requestMessages = mockStreamMessage.mock.calls[0][0] as Array<{
      role: string;
      content?: string;
    }>;
    const requestOptions = mockStreamMessage.mock.calls[0][1] as { tools?: unknown } | undefined;
    expect(requestOptions?.tools).toBeDefined();
    expect(Array.isArray(requestOptions?.tools)).toBe(true);
    expect(requestMessages[0]?.content).not.toContain('## Tool Call Style');
    expect(requestMessages[0]?.content).not.toContain('No tools are registered with the model');
    expect(requestMessages[0]?.content).not.toContain('Do not emit tool calls');
    expect(callbacks.onAssistantMessage).toHaveBeenCalledWith('Local answer only.', [], undefined, {
      completionStatus: 'complete',
      finishReason: 'stop',
      kind: 'final',
    });
    expect(callbacks.onError).not.toHaveBeenCalled();
  });
});
