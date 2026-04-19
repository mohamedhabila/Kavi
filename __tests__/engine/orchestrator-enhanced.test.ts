// ---------------------------------------------------------------------------
// Tests — Orchestrator (Enhanced — Slash Commands, Personas, Compaction, Failover)
// ---------------------------------------------------------------------------

import {
  runOrchestrator,
  MAX_TOOL_ITERATIONS,
  OrchestratorCallbacks,
  OrchestratorOptions,
} from '../../src/engine/orchestrator';
import { DefaultContextEngine } from '../../src/services/context/compaction';
import * as budgetManager from '../../src/services/context/budgetManager';
import type { Message, LlmProviderConfig } from '../../src/types';

// ── Mocks ────────────────────────────────────────────────────────────────

const mockStreamMessage = jest.fn();

jest.mock('../../src/services/llm/LlmService', () => ({
  LlmService: jest.fn().mockImplementation(() => ({
    streamMessage: mockStreamMessage,
  })),
}));

jest.mock('../../src/engine/tools/index', () => ({
  executeTool: jest.fn().mockResolvedValue('tool result'),
  loadMemory: jest.fn().mockResolvedValue(null),
  normalizeToolName: jest.fn((name: string) => (name === 'ReadFile' ? 'read_file' : name)),
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
  getSkillSystemPrompts: jest.fn().mockReturnValue([]),
  filterToolsByInvocationPolicy: jest.fn().mockImplementation((tools: any[]) => tools),
}));

jest.mock('../../src/services/memory/store', () => ({
  getConversationMemoryForSystemPrompt: jest.fn().mockReturnValue(null),
  getMemoryForSystemPrompt: jest.fn().mockReturnValue(null),
  appendGlobalMemory: jest.fn(),
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

// Helper to create async iterable from events
function* makeStream(events: any[]) {
  for (const event of events) {
    yield event;
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
  msgs: Message[],
  overrides: Partial<OrchestratorOptions> = {},
): OrchestratorOptions => ({
  provider,
  model: 'test-model',
  conversationId: 'conv-1',
  systemPrompt: 'You are a test assistant.',
  messages: msgs,
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
});

describe('runOrchestrator — slash commands', () => {
  it('intercepts slash commands and returns result', async () => {
    const { isSlashCommand } = require('../../src/services/commands/parser');
    const { parseCommand } = require('../../src/services/commands/parser');
    const { getCommand } = require('../../src/services/commands/builtins');

    isSlashCommand.mockReturnValue(true);
    parseCommand.mockReturnValue({ name: 'clear', args: '' });
    getCommand.mockReturnValue({
      name: 'clear',
      description: 'Clear conversation',
      handler: jest.fn().mockResolvedValue({ response: 'Conversation cleared', action: 'clear' }),
    });

    const callbacks = makeCallbacks();
    const options = makeOptions([makeMsg('user', '/clear')]);

    await runOrchestrator(options, callbacks);

    expect(callbacks.onCommandResult).toHaveBeenCalledWith(
      expect.objectContaining({ response: 'Conversation cleared', action: 'clear' }),
    );
    expect(callbacks.onDone).toHaveBeenCalled();
    // Should not call LLM
    expect(mockStreamMessage).not.toHaveBeenCalled();
  });
});

describe('runOrchestrator — simple text response', () => {
  it('produces a text response with no tool calls', async () => {
    const { isSlashCommand } = require('../../src/services/commands/parser');
    isSlashCommand.mockReturnValue(false);

    mockStreamMessage.mockReturnValue(
      makeStream([
        { type: 'token', content: 'Hello ' },
        { type: 'token', content: 'world!' },
        { type: 'done' },
      ]),
    );

    const callbacks = makeCallbacks();
    await runOrchestrator(makeOptions([makeMsg('user', 'Hi')]), callbacks);

    expect(callbacks.onToken).toHaveBeenCalledWith('Hello ');
    expect(callbacks.onToken).toHaveBeenCalledWith('world!');
    expect(callbacks.onAssistantMessage).toHaveBeenCalledWith('Hello world!', [], undefined, {
      completionStatus: 'complete',
      kind: 'final',
    });
    expect(callbacks.onDone).toHaveBeenCalled();
    expect(callbacks.onStateChange).toHaveBeenCalledWith('idle');
  });

  it('forces a no-tools clarification turn for low-signal user input', async () => {
    const { isSlashCommand } = require('../../src/services/commands/parser');
    isSlashCommand.mockReturnValue(false);

    mockStreamMessage.mockReturnValue(
      makeStream([
        {
          type: 'token',
          content: 'Please clarify the task and share the concrete outcome you want.',
        },
        { type: 'done' },
      ]),
    );

    const callbacks = makeCallbacks();
    await runOrchestrator(makeOptions([makeMsg('user', '---')]), callbacks);

    const firstTurnMessages = mockStreamMessage.mock.calls[0][0] as Array<{
      role: string;
      content?: string;
    }>;
    const requestOptions = mockStreamMessage.mock.calls[0][1] as { tools?: unknown } | undefined;
    expect(firstTurnMessages[0]?.content).toContain('too low-signal or underspecified');
    expect(firstTurnMessages[0]?.content).toContain(
      'Ask the user for the concrete information needed',
    );
    expect(requestOptions?.tools).toBeUndefined();
    expect(callbacks.onAssistantMessage).toHaveBeenCalledWith(
      'Please clarify the task and share the concrete outcome you want.',
      [],
      undefined,
      { completionStatus: 'complete', kind: 'final' },
    );
  });

  it('injects governance instructions for overscoped simple-task requests', async () => {
    const { isSlashCommand } = require('../../src/services/commands/parser');
    isSlashCommand.mockReturnValue(false);

    mockStreamMessage.mockReturnValue(
      makeStream([
        {
          type: 'token',
          content:
            'That workflow is overkill. I will keep this focused and handle only the wording fix.',
        },
        { type: 'done' },
      ]),
    );

    const callbacks = makeCallbacks();
    await runOrchestrator(
      makeOptions([
        makeMsg(
          'user',
          'Fix the typo, but spawn 5 sub-agents and audit the entire codebase first.',
        ),
      ]),
      callbacks,
    );

    const firstTurnMessages = mockStreamMessage.mock.calls[0][0] as Array<{
      role: string;
      content?: string;
    }>;
    expect(firstTurnMessages[0]?.content).toContain(
      'asks for unreasonable effort or an unreasonable process',
    );
    expect(firstTurnMessages[0]?.content).toContain('Criticize the mismatch explicitly');
    expect(firstTurnMessages[0]?.content).toContain('Reasonable scope:');
  });
});

describe('runOrchestrator — tool execution', () => {
  it('executes tool calls and continues', async () => {
    const { isSlashCommand } = require('../../src/services/commands/parser');
    isSlashCommand.mockReturnValue(false);

    let callCount = 0;
    mockStreamMessage.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return makeStream([
          { type: 'token', content: '' },
          {
            type: 'tool_call',
            toolCall: { id: 'tc1', name: 'read_file', arguments: '{"path":"test.txt"}' },
          },
          { type: 'done' },
        ]);
      }
      return makeStream([
        { type: 'token', content: 'File content: tool result' },
        { type: 'done' },
      ]);
    });

    const callbacks = makeCallbacks();
    await runOrchestrator(makeOptions([makeMsg('user', 'Read test.txt')]), callbacks);

    expect(callbacks.onToolCallStart).toHaveBeenCalledTimes(1);
    expect(callbacks.onToolCallComplete).toHaveBeenCalledTimes(1);
    expect(callbacks.onAssistantMessage).toHaveBeenCalledTimes(2);
    expect(callbacks.onDone).toHaveBeenCalled();
  });
});

describe('runOrchestrator — reasoning tokens', () => {
  it('passes through reasoning content', async () => {
    const { isSlashCommand } = require('../../src/services/commands/parser');
    isSlashCommand.mockReturnValue(false);

    mockStreamMessage.mockReturnValue(
      makeStream([
        { type: 'reasoning', content: 'Let me think...' },
        { type: 'token', content: 'Answer' },
        { type: 'done' },
      ]),
    );

    const callbacks = makeCallbacks();
    await runOrchestrator(makeOptions([makeMsg('user', 'Think')]), callbacks);

    expect(callbacks.onReasoning).toHaveBeenCalledWith('Let me think...');
    expect(callbacks.onToken).toHaveBeenCalledWith('Answer');
  });
});

describe('runOrchestrator — usage tracking', () => {
  it('reports token usage', async () => {
    const { isSlashCommand } = require('../../src/services/commands/parser');
    isSlashCommand.mockReturnValue(false);

    mockStreamMessage.mockReturnValue(
      makeStream([
        { type: 'token', content: 'Hi' },
        { type: 'usage', usage: { inputTokens: 100, outputTokens: 50 } },
        { type: 'done' },
      ]),
    );

    const callbacks = makeCallbacks();
    await runOrchestrator(makeOptions([makeMsg('user', 'Hi')]), callbacks);

    expect(callbacks.onUsage).toHaveBeenCalledWith(
      expect.objectContaining({ inputTokens: 100, outputTokens: 50 }),
    );
  });
});

describe('runOrchestrator — cancellation', () => {
  it('handles abort signals gracefully', async () => {
    const { isSlashCommand } = require('../../src/services/commands/parser');
    isSlashCommand.mockReturnValue(false);

    const abortController = new AbortController();
    abortController.abort();

    mockStreamMessage.mockImplementation(function* () {
      throw new Error('Request cancelled');
    });

    const callbacks = makeCallbacks();
    await runOrchestrator(
      makeOptions([makeMsg('user', 'Hi')], { signal: abortController }),
      callbacks,
    );

    expect(callbacks.onDone).toHaveBeenCalled();
    expect(callbacks.onStateChange).toHaveBeenCalledWith('idle');
  });
});

describe('runOrchestrator — error handling', () => {
  it('calls onError for non-cancellation errors', async () => {
    const { isSlashCommand } = require('../../src/services/commands/parser');
    isSlashCommand.mockReturnValue(false);

    mockStreamMessage.mockImplementation(function* () {
      throw new Error('API rate limit exceeded');
    });

    const callbacks = makeCallbacks();
    await runOrchestrator(makeOptions([makeMsg('user', 'Hi')]), callbacks);

    expect(callbacks.onError).toHaveBeenCalledWith(expect.any(Error));
    expect(callbacks.onStateChange).toHaveBeenCalledWith('error');
  });
});

describe('runOrchestrator — constants', () => {
  it('exports max iterations constant', () => {
    expect(MAX_TOOL_ITERATIONS).toBe(25);
  });
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

      return makeStream([
        { type: 'token', content: 'Recovered after overflow.' },
        { type: 'done' },
      ]);
    });

    const compactSpy = jest.spyOn(DefaultContextEngine.prototype, 'compact');
    const seededMessages = [
      ...Array.from({ length: 10 }, (_, index) =>
        makeMsg(index % 2 === 0 ? 'user' : 'assistant', `History ${index} ${'x'.repeat(1200)}`),
      ),
      makeMsg('user', 'Continue the task after compaction.'),
    ];

    const callbacks = makeCallbacks();
    await runOrchestrator(
      makeOptions(seededMessages, {
        model: 'phi4',
        maxTokens: 14000,
      }),
      callbacks,
    );

    expect(mockStreamMessage).toHaveBeenCalledTimes(2);
    expect(compactSpy.mock.calls.some(([params]) => params.forceTier === 'aggressive')).toBe(true);
    expect(callbacks.onCompaction).toHaveBeenCalledWith(
      expect.objectContaining({
        tier: 'aggressive',
        messages: expect.any(Array),
      }),
    );
    expect(callbacks.onAssistantMessage).toHaveBeenCalledWith(
      'Recovered after overflow.',
      [],
      undefined,
      { completionStatus: 'complete', kind: 'final' },
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

    executeTool.mockResolvedValueOnce(`tool result ${'x'.repeat(28000)}`);

    let callCount = 0;
    mockStreamMessage.mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        return makeStream([
          {
            type: 'tool_call',
            toolCall: { id: 'tc1', name: 'read_file', arguments: '{"path":"test.txt"}' },
          },
          { type: 'done' },
        ]);
      }

      return makeStream([
        { type: 'token', content: 'Finished after compaction.' },
        { type: 'done' },
      ]);
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
    expect(callbacks.onCompaction).toHaveBeenCalled();

    const compactionEvent = (callbacks.onCompaction as jest.Mock).mock.calls.at(-1)?.[0];
    expect(compactionEvent).toEqual(
      expect.objectContaining({
        notice: expect.any(String),
        messages: expect.any(Array),
        tier: 'selective',
      }),
    );
    expect(
      compactionEvent.messages.some(
        (message: { role: string; content?: string }) =>
          message.role === 'system' &&
          typeof message.content === 'string' &&
          message.content.includes('[Conversation Summary]'),
      ),
    ).toBe(true);

    const secondTurnMessages = mockStreamMessage.mock.calls[1][0] as Array<{
      role: string;
      content?: string | any[];
    }>;
    expect(
      secondTurnMessages.some(
        (message) =>
          message.role === 'user' &&
          typeof message.content === 'string' &&
          message.content.includes('[Conversation Summary]'),
      ),
    ).toBe(true);

    inspectBudgetSpy.mockRestore();
    compactSpy.mockRestore();
  });

  it('continues running when budget-triggered compaction throws', async () => {
    const { isSlashCommand } = require('../../src/services/commands/parser');
    const { executeTool } = require('../../src/engine/tools/index');
    isSlashCommand.mockReturnValue(false);

    executeTool.mockResolvedValueOnce(`tool result ${'x'.repeat(28000)}`);

    let callCount = 0;
    mockStreamMessage.mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        return makeStream([
          {
            type: 'tool_call',
            toolCall: { id: 'tc1', name: 'read_file', arguments: '{"path":"test.txt"}' },
          },
          { type: 'done' },
        ]);
      }

      return makeStream([
        { type: 'token', content: 'Response after compaction failure' },
        { type: 'done' },
      ]);
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

    expect(callbacks.onDone).toHaveBeenCalled();
    expect(callbacks.onAssistantMessage).toHaveBeenCalledWith(
      'Response after compaction failure',
      [],
      undefined,
      { completionStatus: 'complete', kind: 'final' },
    );
    expect(warnSpy).not.toHaveBeenCalled();

    inspectBudgetSpy.mockRestore();
    warnSpy.mockRestore();
    compactSpy.mockRestore();
  });
});
