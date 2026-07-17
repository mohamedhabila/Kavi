import { runOrchestrator, MAX_TOOL_ITERATIONS } from '../../src/engine/orchestrator';
import type { ToolMessageOutcome } from '../../src/engine/toolExecution/toolMessageOutcome';
import {
  allowTools,
  makeCallbacks,
  makeMsg,
  makeOptions,
  makeStream,
} from './helpers/orchestratorCoreFlows';

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
    const handler = jest.fn().mockResolvedValue({
      response: 'Conversation cleared',
      action: 'clear',
    });
    getCommand.mockReturnValue({
      name: 'clear',
      description: 'Clear conversation',
      handler,
    });

    const callbacks = makeCallbacks();
    const signal = new AbortController();
    const options = makeOptions([makeMsg('user', '/clear')], {
      agentRunId: 'scheduled-attempt-1',
      signal,
    });

    await runOrchestrator(options, callbacks);

    expect(callbacks.onCommandResult).toHaveBeenCalledWith(
      expect.objectContaining({ response: 'Conversation cleared', action: 'clear' }),
    );
    expect(callbacks.onDone).toHaveBeenCalled();
    expect(handler).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      args: '',
      agentRunId: 'scheduled-attempt-1',
      executionSignal: signal,
    });
    // Should not call LLM
    expect(mockStreamMessage).not.toHaveBeenCalled();
  });
});

describe('runOrchestrator — simple text response', () => {
  it('produces a text response with no tool calls', async () => {
    const { isSlashCommand } = require('../../src/services/commands/parser');
    isSlashCommand.mockReturnValue(false);

    mockStreamMessage.mockReturnValue(
      makeStream(
        [
          { type: 'token', content: 'Hello ' },
          { type: 'token', content: 'world!' },
          { type: 'done' },
        ],
        'text',
      ),
    );

    const callbacks = makeCallbacks();
    await runOrchestrator(makeOptions([makeMsg('user', 'Hi')]), callbacks);

    expect(callbacks.onToken).toHaveBeenCalledTimes(1);
    expect(callbacks.onToken).toHaveBeenCalledWith('Hello world!');
    expect(callbacks.onAssistantMessage).toHaveBeenCalledWith('Hello world!', [], undefined, {
      completionStatus: 'complete',
      finishReason: 'stop',
      kind: 'final',
    });
    expect(callbacks.onDone).toHaveBeenCalled();
    expect(callbacks.onStateChange).toHaveBeenCalledWith('idle');
  });

  it('forces a no-tools clarification turn for structurally empty user input', async () => {
    const { isSlashCommand } = require('../../src/services/commands/parser');
    isSlashCommand.mockReturnValue(false);

    mockStreamMessage.mockReturnValue(
      makeStream(
        [
          {
            type: 'token',
            content: 'What concrete outcome do you want me to accomplish?',
          },
          { type: 'done' },
        ],
        'text',
      ),
    );

    const callbacks = makeCallbacks();
    await runOrchestrator(makeOptions([makeMsg('user', '   ')]), callbacks);

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
      { completionStatus: 'complete', finishReason: 'stop', kind: 'final' },
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
        return makeStream(
          [
            { type: 'token', content: '' },
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
        [{ type: 'token', content: 'File content: tool result' }, { type: 'done' }],
        'text',
      );
    });

    const callbacks = makeCallbacks();
    await runOrchestrator(
      makeOptions([makeMsg('user', 'Read test.txt')], {
        explicitToolSurfaceToolNames: ['read_file'],
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
        return makeStream(
          [
            {
              type: 'tool_call',
              toolCall: { id: 'tc-sequenced', name: 'read_file', arguments: '{"path":"test.txt"}' },
            },
            { type: 'done' },
          ],
          'tool',
        );
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
      return makeStream([{ type: 'token', content: 'Observed result.' }, { type: 'done' }], 'text');
    });

    const callbacks = makeCallbacks({
      onToolMessage: jest.fn(
        (_outcome: ToolMessageOutcome) =>
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
        explicitToolSurfaceToolNames: ['read_file'],
        toolFilter: allowTools(['read_file']),
      }),
      callbacks,
    );
    await toolMessageStarted;

    expect(callbacks.onToolMessage).toHaveBeenCalledWith({
      version: 1,
      toolCallId: 'tc-sequenced',
      status: 'completed',
      content: 'tool result',
    });
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
    executeTool.mockResolvedValueOnce({
      status: 'completed',
      content: JSON.stringify({ status: 'completed', jobId: 'bg-1' }),
    });

    mockStreamMessage
      .mockReturnValueOnce(
        makeStream(
          [{ type: 'token', content: 'Background job completed.' }, { type: 'done' }],
          'text',
        ),
      )
      .mockReturnValueOnce(
        makeStream(
          [{ type: 'token', content: 'Monitoring the pending background job.' }, { type: 'done' }],
          'text',
        ),
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
      makeStream(
        [
          { type: 'reasoning', content: 'Let me think...' },
          { type: 'token', content: 'Answer' },
          { type: 'done' },
        ],
        'text',
      ),
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
      makeStream(
        [
          { type: 'token', content: 'Hi' },
          { type: 'usage', usage: { inputTokens: 100, outputTokens: 50 } },
          { type: 'done' },
        ],
        'text',
      ),
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
