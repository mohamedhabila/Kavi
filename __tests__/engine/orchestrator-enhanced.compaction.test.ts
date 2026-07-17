import {
  runOrchestrator,
  OrchestratorCallbacks,
  OrchestratorOptions,
} from '../../src/engine/orchestrator';
import { createWorkflowTaskAnchor } from '../../src/engine/graph/workflowTaskAnchor';
import * as budgetManager from '../../src/services/context/budgetManager';
import { DefaultContextEngine } from '../../src/services/context/compaction';
import type { Message } from '../../src/types/message';
import type { LlmProviderConfig } from '../../src/types/provider';

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
  normalizeToolName: jest.fn((name: string) => name.trim()),
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
  resolvePersonaSystemPrompt: jest.fn((_p: any, prompt: string) => prompt),
  resolvePersonaModel: jest.fn((_p: any, providerId: string, model: string) => ({
    providerId,
    model,
  })),
}));

async function* makeStream(events: any[], terminalDisposition?: 'text' | 'tool') {
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

function makeCallbacks(overrides: Partial<OrchestratorCallbacks> = {}): OrchestratorCallbacks {
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
    onCommandResult: jest.fn(),
    onCompaction: jest.fn(),
    ...overrides,
  };
}

const provider: LlmProviderConfig = {
  id: 'test-provider',
  name: 'Test',
  type: 'openai',
  apiKey: 'test-key',
  baseUrl: 'https://api.test.com',
  models: ['test-model'],
};

const makeOptions = (
  messages: Message[],
  overrides: Partial<OrchestratorOptions> = {},
): OrchestratorOptions => ({
  provider,
  model: 'test-model',
  conversationId: 'conv-1',
  systemPrompt: 'You are a test assistant.',
  messages,
  ...overrides,
});

const makeMsg = (role: 'user' | 'assistant' | 'system', content: string): Message => ({
  id: `msg-${Math.random()}`,
  role,
  content,
  timestamp: Date.now(),
  attachments: [],
});

beforeEach(() => {
  jest.clearAllMocks();
  mockStreamMessage.mockReset();
});

describe('runOrchestrator — compaction resilience', () => {
  it('retries once after a provider context-overflow error by forcing aggressive compaction', async () => {
    const { isSlashCommand } = require('../../src/services/commands/parser');
    isSlashCommand.mockReturnValue(false);

    let callCount = 0;
    mockStreamMessage.mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        throw new Error('LLM API error 400: maximum context length exceeded');
      }

      return makeStream(
        [{ type: 'token', content: 'Recovered after overflow.' }, { type: 'done' }],
        'text',
      );
    });

    const compactSpy = jest.spyOn(DefaultContextEngine.prototype, 'compact');
    const anchorMessage = makeMsg('user', 'Continue the task after compaction.');
    const seededMessages = [
      ...Array.from({ length: 10 }, (_, index) =>
        makeMsg(index % 2 === 0 ? 'user' : 'assistant', `History ${index} ${'x'.repeat(1200)}`),
      ),
      anchorMessage,
    ];

    const callbacks = makeCallbacks();
    await runOrchestrator(
      makeOptions(seededMessages, {
        model: 'phi4',
        maxTokens: 14000,
        workflowTaskAnchor: createWorkflowTaskAnchor(anchorMessage),
      }),
      callbacks,
    );

    expect(mockStreamMessage).toHaveBeenCalledTimes(2);
    expect(
      mockStreamMessage.mock.calls.every((call) =>
        String(call[0][0]?.content).includes(
          JSON.stringify(createWorkflowTaskAnchor(anchorMessage)),
        ),
      ),
    ).toBe(true);
    expect(compactSpy.mock.calls.some(([params]) => params.forceTier === 'aggressive')).toBe(true);
    if ((callbacks.onCompaction as jest.Mock).mock.calls.length > 0) {
      expect(callbacks.onCompaction).toHaveBeenCalledWith(
        expect.objectContaining({
          tier: 'aggressive',
          messages: expect.any(Array),
        }),
      );
    }
    expect(callbacks.onAssistantMessage).toHaveBeenCalledWith(
      'Recovered after overflow.',
      [],
      undefined,
      { completionStatus: 'complete', finishReason: 'stop', kind: 'final' },
    );

    const firstRequestOptions = mockStreamMessage.mock.calls[0][1] as { maxTokens?: number };
    const secondRequestOptions = mockStreamMessage.mock.calls[1][1] as { maxTokens?: number };
    expect(secondRequestOptions.maxTokens).toBeLessThan(firstRequestOptions.maxTokens ?? Infinity);

    compactSpy.mockRestore();
  });

  it('compacts before the next model turn when a tool-heavy run exceeds the preflight budget', async () => {
    const { isSlashCommand } = require('../../src/services/commands/parser');
    const { executeTool } = require('../../src/engine/tools/index');
    isSlashCommand.mockReturnValue(false);

    executeTool.mockResolvedValueOnce({
      status: 'completed',
      content: `tool result ${'x'.repeat(28000)}`,
    });

    let callCount = 0;
    mockStreamMessage.mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        return makeStream(
          [
            {
              type: 'tool_call',
              toolCall: { id: 'tc1', name: 'read_file', arguments: '{"path":"test.txt"}' },
            },
            { type: 'done' },
          ],
          'tool',
        );
      }

      return makeStream(
        [{ type: 'token', content: 'Finished after compaction.' }, { type: 'done' }],
        'text',
      );
    });

    const compactSpy = jest.spyOn(DefaultContextEngine.prototype, 'compact');
    const actualInspectContextBudget = budgetManager.inspectContextBudget;
    const inspectBudgetSpy = jest.spyOn(budgetManager, 'inspectContextBudget');
    let inspectCallCount = 0;
    inspectBudgetSpy.mockImplementation((...args) => {
      inspectCallCount += 1;
      const result = actualInspectContextBudget(...args);
      if (inspectCallCount === 2) {
        return {
          ...result,
          withinBudget: false,
          requiresMessageWindowing: true,
          messageOverflowTokens: Math.max(result.messageOverflowTokens, 512),
          remainingMessagesBudget: Math.max(0, result.messagesTokens - 512),
          totalTokens: Math.max(result.totalTokens, result.totalAvailable + 512),
        };
      }
      return result;
    });
    const seededMessages = [
      ...Array.from({ length: 7 }, (_, index) =>
        makeMsg(index % 2 === 0 ? 'user' : 'assistant', `History ${index} ${'x'.repeat(1200)}`),
      ),
      makeMsg('user', 'Read test.txt and continue.'),
    ];

    const callbacks = makeCallbacks();
    await runOrchestrator(
      makeOptions(seededMessages, {
        model: 'phi4',
        maxTokens: 14000,
        toolFilter: (toolName: string) => toolName === 'read_file',
      }),
      callbacks,
    );

    expect(compactSpy.mock.calls.some(([params]) => params.forceTier === 'selective')).toBe(true);
    if ((callbacks.onCompaction as jest.Mock).mock.calls.length > 0) {
      const compactionEvent = (callbacks.onCompaction as jest.Mock).mock.calls.at(-1)?.[0];
      expect(compactionEvent).toEqual(
        expect.objectContaining({
          notice: expect.any(String),
          messages: expect.any(Array),
          tier: expect.stringMatching(/tool_clearing|selective|aggressive/),
        }),
      );
    }

    const secondTurnMessages = mockStreamMessage.mock.calls[1]?.[0] as
      | Array<{ role: string; content?: string | any[] }>
      | undefined;
    if (secondTurnMessages) {
      expect(secondTurnMessages.some((message) => message.role === 'user')).toBe(true);
    }

    inspectBudgetSpy.mockRestore();
    compactSpy.mockRestore();
  });

  it('continues running when budget-triggered compaction throws', async () => {
    const { isSlashCommand } = require('../../src/services/commands/parser');
    const { executeTool } = require('../../src/engine/tools/index');
    isSlashCommand.mockReturnValue(false);

    executeTool.mockResolvedValueOnce({
      status: 'completed',
      content: `tool result ${'x'.repeat(28000)}`,
    });

    let callCount = 0;
    mockStreamMessage.mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        return makeStream(
          [
            {
              type: 'tool_call',
              toolCall: { id: 'tc1', name: 'read_file', arguments: '{"path":"test.txt"}' },
            },
            { type: 'done' },
          ],
          'tool',
        );
      }

      return makeStream(
        [{ type: 'token', content: 'Response after compaction failure' }, { type: 'done' }],
        'text',
      );
    });

    const compactSpy = jest.spyOn(DefaultContextEngine.prototype, 'compact');
    const actualInspectContextBudget = budgetManager.inspectContextBudget;
    const inspectBudgetSpy = jest.spyOn(budgetManager, 'inspectContextBudget');
    let inspectCallCount = 0;
    inspectBudgetSpy.mockImplementation((...args) => {
      inspectCallCount += 1;
      const result = actualInspectContextBudget(...args);
      if (inspectCallCount === 2) {
        return {
          ...result,
          withinBudget: false,
          requiresMessageWindowing: true,
          messageOverflowTokens: Math.max(result.messageOverflowTokens, 512),
          remainingMessagesBudget: Math.max(0, result.messagesTokens - 512),
          totalTokens: Math.max(result.totalTokens, result.totalAvailable + 512),
        };
      }
      return result;
    });
    compactSpy.mockRejectedValueOnce(new Error('Compaction LLM failed'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const seededMessages = [
      ...Array.from({ length: 7 }, (_, index) =>
        makeMsg(index % 2 === 0 ? 'user' : 'assistant', `History ${index} ${'x'.repeat(1200)}`),
      ),
      makeMsg('user', 'Read test.txt and continue.'),
    ];

    const callbacks = makeCallbacks();
    await runOrchestrator(
      makeOptions(seededMessages, {
        model: 'phi4',
        maxTokens: 14000,
        toolFilter: (toolName: string) => toolName === 'read_file',
      }),
      callbacks,
    );

    expect(mockStreamMessage).toHaveBeenCalledTimes(2);
    expect(callbacks.onDone).toHaveBeenCalled();
    const assistantMessages = (callbacks.onAssistantMessage as jest.Mock).mock.calls;
    if (assistantMessages.length > 0) {
      const finalMessage = assistantMessages.at(-1);
      expect(finalMessage?.[0]).toContain('Response after compaction failure');
    }
    expect(callbacks.onError).not.toHaveBeenCalled();
    const unexpectedWarnCalls = warnSpy.mock.calls.filter(([message]) => {
      return typeof message !== 'string' || !message.startsWith('[planner-debug:');
    });
    expect(unexpectedWarnCalls).toHaveLength(0);

    inspectBudgetSpy.mockRestore();
    warnSpy.mockRestore();
    compactSpy.mockRestore();
  });
});
