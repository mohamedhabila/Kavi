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
import type { Message } from '../../src/types/message';
import type { LlmProviderConfig } from '../../src/types/provider';

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

const allowTools =
  (toolNames: ReadonlyArray<string>) =>
  (toolName: string): boolean =>
    toolNames.includes(toolName);

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
          content: 'What concrete outcome do you want me to accomplish?',
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
    expect(firstTurnMessages[0]?.content).toContain('[SYSTEM CLARIFICATION REQUIRED]');
    expect(firstTurnMessages[0]?.content).toContain(
      'Ask one concise clarification question for the missing required information.',
    );
    expect(requestOptions?.tools).toBeUndefined();
    expect(callbacks.onAssistantMessage).toHaveBeenCalledWith(
      'What concrete outcome do you want me to accomplish?',
      [],
      undefined,
      { completionStatus: 'complete', kind: 'final' },
    );
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
    await runOrchestrator(
      makeOptions([makeMsg('user', 'Read test.txt')], {
        toolFilter: allowTools(['read_file']),
      }),
      callbacks,
    );

    expect(callbacks.onToolCallStart).toHaveBeenCalledTimes(1);
    expect(callbacks.onToolCallComplete).toHaveBeenCalledTimes(1);
    expect(callbacks.onAssistantMessage).toHaveBeenCalledTimes(2);
    expect(callbacks.onDone).toHaveBeenCalled();
  });

  it('waits for tool message delivery before starting the next model turn', async () => {
    const { isSlashCommand } = require('../../src/services/commands/parser');
    isSlashCommand.mockReturnValue(false);

    let callCount = 0;
    let toolMessageResolved = false;
    let releaseToolMessage: (() => void) | undefined;
    let notifyToolMessageStarted: (() => void) | undefined;
    const toolMessageStarted = new Promise<void>((resolve) => {
      notifyToolMessageStarted = resolve;
    });
    mockStreamMessage.mockImplementation((messages: any[]) => {
      callCount++;
      if (callCount === 1) {
        return makeStream([
          {
            type: 'tool_call',
            toolCall: { id: 'tc-sequenced', name: 'read_file', arguments: '{"path":"test.txt"}' },
          },
          { type: 'done' },
        ]);
      }

      expect(toolMessageResolved).toBe(true);
      expect(messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: 'tool',
            content: 'tool result',
            tool_call_id: 'tc-sequenced',
          }),
        ]),
      );
      return makeStream([{ type: 'token', content: 'Observed result.' }, { type: 'done' }]);
    });

    const callbacks = makeCallbacks({
      onToolMessage: jest.fn(
        () =>
          new Promise<void>((resolve) => {
            notifyToolMessageStarted?.();
            releaseToolMessage = () => {
              toolMessageResolved = true;
              resolve();
            };
          }),
      ),
    });

    const runPromise = runOrchestrator(
      makeOptions([makeMsg('user', 'Read test.txt')], {
        toolFilter: allowTools(['read_file']),
      }),
      callbacks,
    );
    await toolMessageStarted;

    expect(callbacks.onToolMessage).toHaveBeenCalledWith('tc-sequenced', 'tool result');
    expect(mockStreamMessage).toHaveBeenCalledTimes(1);

    releaseToolMessage?.();
    await runPromise;

    expect(mockStreamMessage).toHaveBeenCalledTimes(2);
    expect(callbacks.onDone).toHaveBeenCalled();
  });

  it('re-prompts pending async work instead of auto-monitoring it', async () => {
    const { isSlashCommand } = require('../../src/services/commands/parser');
    const { executeTool } = require('../../src/engine/tools/index');
    isSlashCommand.mockReturnValue(false);
    executeTool.mockResolvedValueOnce(JSON.stringify({ status: 'completed', jobId: 'bg-1' }));

    mockStreamMessage
      .mockReturnValueOnce(
        makeStream([{ type: 'token', content: 'Background job completed.' }, { type: 'done' }]),
      )
      .mockReturnValueOnce(
        makeStream([
          { type: 'token', content: 'Monitoring the pending background job.' },
          { type: 'done' },
        ]),
      );

    const callbacks = makeCallbacks();
    await runOrchestrator(
      makeOptions([makeMsg('user', 'Continue the pending background job.')], {
        initialPendingAsyncOperations: [
          {
            key: 'ssh-background-job:bg-1',
            kind: 'ssh-background-job',
            resourceId: 'bg-1',
            displayName: 'SSH background job bg-1',
            status: 'running',
            lastUpdatedByTool: 'ssh_exec',
            updatedAt: 100,
            monitorToolNames: ['ssh_background_job_status', 'ssh_background_job_wait'],
            statusArgs: { jobId: 'bg-1' },
            waitToolName: 'ssh_background_job_wait',
            waitArgs: { jobId: 'bg-1' },
          },
        ],
      }),
      callbacks,
    );

    expect(executeTool).not.toHaveBeenCalled();
    expect(mockStreamMessage.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(mockStreamMessage.mock.calls)).toContain('[SYSTEM ASYNC HOLD]');
    expect(JSON.stringify(mockStreamMessage.mock.calls)).toContain(
      '[SYSTEM WORKFLOW JOIN REQUIRED]',
    );
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
