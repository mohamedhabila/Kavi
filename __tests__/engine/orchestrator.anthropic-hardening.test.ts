/// <reference types="jest" />

import {
  runOrchestrator,
  type OrchestratorCallbacks,
  type OrchestratorOptions,
} from '../../src/engine/orchestrator';
import type { AssistantMessageMetadata } from '../../src/types/message';
import type { LlmProviderConfig } from '../../src/types/provider';

jest.mock('../../src/services/llm/LlmService', () => ({
  LlmService: jest.fn().mockImplementation(() => ({
    streamMessage: jest.fn(),
  })),
}));

jest.mock('../../src/engine/tools/index', () => ({
  executeTool: jest.fn().mockResolvedValue('tool result'),
  loadMemory: jest.fn().mockResolvedValue(null),
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

jest.mock('../../src/services/memory/store', () => ({
  getConversationMemoryForSystemPrompt: jest.fn().mockReturnValue(null),
  getMemoryForSystemPrompt: jest.fn().mockReturnValue(null),
  appendGlobalMemory: jest.fn(),
}));

jest.mock('../../src/services/memory/livingMemoryBridge', () => ({
  buildLivingMemorySections: jest.fn().mockResolvedValue({
    sections: [],
    cacheableSignature: '00000000',
    focusBlockText: '',
    openThreadLabels: [],
    recalledFactCount: 0,
  }),
}));

jest.mock('../../src/services/memory/policy', () => ({
  canReadLongTermMemory: jest.fn().mockReturnValue(true),
}));

jest.mock('../../src/services/commands/parser', () => ({
  isSlashCommand: jest.fn().mockReturnValue(false),
  parseCommand: jest.fn().mockReturnValue(null),
}));

jest.mock('../../src/services/commands/builtins', () => ({
  getCommand: jest.fn().mockReturnValue(null),
}));

jest.mock('../../src/services/agents/personas', () => ({
  SUPER_AGENT_PERSONA_ID: 'super-agent',
  resolvePersonaSystemPrompt: jest.fn((_persona: any, prompt: string) => prompt),
  resolvePersonaModel: jest.fn((_persona: any, providerId: string, model: string) => ({
    providerId,
    model,
  })),
}));

jest.mock('../../src/services/agents/registry', () => ({
  getAvailablePersonasForConfig: jest.fn().mockReturnValue([]),
  getPersona: jest.fn().mockReturnValue(undefined),
}));

jest.mock('../../src/services/storage/SecureStorage', () => ({
  getProviderApiKey: jest.fn().mockResolvedValue('sk-test'),
}));

import { LlmService } from '../../src/services/llm/LlmService';
import { executeTool } from '../../src/engine/tools/index';

const mockStreamMessage = jest.fn();
(LlmService as any).mockImplementation(() => ({
  streamMessage: mockStreamMessage,
}));

const makeProvider = (overrides: Partial<LlmProviderConfig> = {}): LlmProviderConfig => ({
  id: 'test',
  name: 'Test',
  baseUrl: 'https://api.test.com/v1',
  apiKey: 'sk-test',
  model: 'gpt-5.4',
  enabled: true,
  ...overrides,
});

const makeCallbacks = (): OrchestratorCallbacks & { calls: Record<string, any[]> } => {
  const calls: Record<string, any[]> = {
    onStateChange: [],
    onToken: [],
    onReasoning: [],
    onToolCallStart: [],
    onToolCallComplete: [],
    onAssistantMessage: [],
    onToolMessage: [],
    onError: [],
    onUsage: [],
    onDone: [],
  };

  return {
    calls,
    onStateChange: jest.fn((state: any) => calls.onStateChange.push(state)),
    onToken: jest.fn((token: any) => calls.onToken.push(token)),
    onReasoning: jest.fn((token: any) => calls.onReasoning.push(token)),
    onToolCallStart: jest.fn((toolCall: any) => calls.onToolCallStart.push(toolCall)),
    onToolCallComplete: jest.fn((toolCall: any) => calls.onToolCallComplete.push(toolCall)),
    onAssistantMessage: jest.fn(
      (content: any, toolCalls: any, providerReplay: any, assistantMetadata: any) =>
        calls.onAssistantMessage.push({
          content,
          toolCalls,
          providerReplay,
          assistantMetadata,
        }),
    ),
    onToolMessage: jest.fn((id: any, result: any) => calls.onToolMessage.push({ id, result })),
    onError: jest.fn((error: any) => calls.onError.push(error)),
    onUsage: jest.fn((usage: any) => calls.onUsage.push(usage)),
    onDone: jest.fn(() => calls.onDone.push(true)),
  };
};

async function* createStreamGenerator(events: any[]) {
  for (const event of events) {
    yield event;
  }
}

function expectAssistantMetadata(
  value: AssistantMessageMetadata | undefined,
  partial: Partial<AssistantMessageMetadata>,
) {
  expect(value).toEqual(expect.objectContaining(partial));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStreamMessage.mockReset();
  (LlmService as any).mockImplementation(() => ({
    streamMessage: mockStreamMessage,
  }));
  (executeTool as jest.Mock).mockResolvedValue('tool result');
});

describe('Orchestrator Anthropic hardening', () => {
  it('continues incomplete Anthropic text turns instead of finalizing early', async () => {
    mockStreamMessage.mockImplementationOnce(() =>
      createStreamGenerator([
        { type: 'token', content: 'Partial answer' },
        {
          type: 'done',
          content: 'Partial answer',
          completion: { completionStatus: 'incomplete', finishReason: 'pause_turn' },
        },
      ]),
    );

    mockStreamMessage.mockImplementationOnce(() =>
      createStreamGenerator([
        { type: 'token', content: ' continued.' },
        {
          type: 'done',
          content: ' continued.',
          completion: { completionStatus: 'complete', finishReason: 'end_turn' },
        },
      ]),
    );

    const callbacks = makeCallbacks();
    const options: OrchestratorOptions = {
      provider: makeProvider({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        model: 'claude-sonnet-4-6',
      }),
      model: 'claude-sonnet-4-6',
      conversationId: 'conv-anthropic-resume',
      systemPrompt: 'You are helpful',
      messages: [
        {
          id: 'msg1',
          role: 'user',
          content: 'Continue the analysis until it is complete.',
          timestamp: Date.now(),
        },
      ],
    };

    await runOrchestrator(options, callbacks);

    expect(mockStreamMessage).toHaveBeenCalledTimes(2);
    expect(callbacks.calls.onAssistantMessage).toHaveLength(1);
    expect(callbacks.calls.onAssistantMessage[0].content).toBe('Partial answer continued.');
    expectAssistantMetadata(callbacks.calls.onAssistantMessage[0].assistantMetadata, {
      kind: 'final',
      completionStatus: 'complete',
      finishReason: 'end_turn',
    });
  });

  it('replays Anthropic providerReplay blocks on follow-up tool turns', async () => {
    mockStreamMessage.mockImplementationOnce(() =>
      createStreamGenerator([
        {
          type: 'tool_call',
          toolCall: { id: 'toolu_1', name: 'read_file', arguments: '{"path":"notes.txt"}' },
        },
        {
          type: 'done',
          content: '',
          providerReplay: {
            anthropicBlocks: [
              {
                type: 'thinking',
                thinking: 'I should inspect the file first.',
                signature: 'sig-A',
              },
              { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'notes.txt' } },
            ],
          },
          completion: { completionStatus: 'complete', finishReason: 'tool_use' },
        },
      ]),
    );

    mockStreamMessage.mockImplementationOnce(() =>
      createStreamGenerator([
        { type: 'token', content: 'Verified.' },
        {
          type: 'done',
          content: 'Verified.',
          completion: { completionStatus: 'complete', finishReason: 'end_turn' },
        },
      ]),
    );

    const callbacks = makeCallbacks();
    const options: OrchestratorOptions = {
      provider: makeProvider({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        model: 'claude-sonnet-4-6',
      }),
      model: 'claude-sonnet-4-6',
      conversationId: 'conv-anthropic-provider-replay',
      systemPrompt: 'You are helpful',
      messages: [
        { id: 'msg1', role: 'user', content: 'Read the file and continue.', timestamp: Date.now() },
      ],
    };

    await runOrchestrator(options, callbacks);

    expect(mockStreamMessage).toHaveBeenCalledTimes(2);
    const secondCallMessages = mockStreamMessage.mock.calls[1]?.[0] as Array<{
      role: string;
      content: any;
    }>;
    expect(secondCallMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'I should inspect the file first.', signature: 'sig-A' },
            { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'notes.txt' } },
          ],
        }),
      ]),
    );
  });

  it('does not replay Anthropic thinking blocks from prior plain text turns on a later user message', async () => {
    mockStreamMessage.mockImplementationOnce(() =>
      createStreamGenerator([
        { type: 'token', content: 'Handled.' },
        {
          type: 'done',
          content: 'Handled.',
          completion: { completionStatus: 'complete', finishReason: 'end_turn' },
        },
      ]),
    );

    const callbacks = makeCallbacks();
    const options: OrchestratorOptions = {
      provider: makeProvider({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        model: 'claude-sonnet-4-6',
      }),
      model: 'claude-sonnet-4-6',
      conversationId: 'conv-anthropic-follow-up',
      systemPrompt: 'You are helpful',
      messages: [
        { id: 'msg-user-1', role: 'user', content: 'First task.', timestamp: Date.now() - 2000 },
        {
          id: 'msg-assistant-1',
          role: 'assistant',
          content: 'Completed first task.',
          providerReplay: {
            anthropicBlocks: [
              {
                type: 'thinking',
                thinking: 'I should think before answering.',
                signature: 'sig-A',
              },
              { type: 'text', text: 'Completed first task.' },
            ],
          },
          timestamp: Date.now() - 1000,
        },
        { id: 'msg-user-2', role: 'user', content: 'Second task.', timestamp: Date.now() },
      ],
    };

    await runOrchestrator(options, callbacks);

    expect(mockStreamMessage).toHaveBeenCalledTimes(1);
    const requestMessages = mockStreamMessage.mock.calls[0]?.[0] as Array<{
      role: string;
      content: any;
    }>;
    expect(requestMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'assistant', content: 'Completed first task.' }),
        expect.objectContaining({ role: 'user', content: expect.stringContaining('Second task.') }),
      ]),
    );
    expect(requestMessages).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          content: expect.arrayContaining([expect.objectContaining({ type: 'thinking' })]),
        }),
      ]),
    );
  });

  it('re-prompts pending Anthropic sessions instead of auto-monitoring them', async () => {
    (executeTool as jest.Mock).mockResolvedValueOnce(
      JSON.stringify({
        status: 'completed',
        sessionIds: ['sub-1'],
        sessionCount: 1,
        completedCount: 1,
        pendingCount: 0,
        sessions: [{ sessionId: 'sub-1', status: 'completed', output: 'Worker finished.' }],
      }),
    );

    mockStreamMessage
      .mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Worker output integrated.' },
          { type: 'done', content: 'Worker output integrated.' },
        ]),
      )
      .mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Waiting for the delegated worker to finish.' },
          { type: 'done', content: 'Waiting for the delegated worker to finish.' },
        ]),
      );

    const callbacks = makeCallbacks();
    const options: OrchestratorOptions = {
      provider: makeProvider({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        model: 'claude-sonnet-4-6',
      }),
      model: 'claude-sonnet-4-6',
      conversationId: 'conv-anthropic-monitor',
      systemPrompt: 'You are helpful',
      messages: [
        {
          id: 'msg1',
          role: 'user',
          content: 'Wait for the existing worker output.',
          timestamp: Date.now(),
        },
      ],
      initialPendingAsyncOperations: [
        {
          key: 'session:sub-1',
          kind: 'session',
          resourceId: 'sub-1',
          displayName: 'Session sub-1',
          status: 'running',
          lastUpdatedByTool: 'recovered_async_state',
          updatedAt: Date.now(),
          monitorToolNames: ['sessions_status', 'sessions_wait', 'sessions_cancel'],
          statusArgs: { sessionId: 'sub-1' },
          waitToolName: 'sessions_wait',
          waitArgs: { sessionId: 'sub-1' },
        },
      ],
    };

    await runOrchestrator(options, callbacks);

    expect(executeTool).not.toHaveBeenCalled();
    expect(mockStreamMessage.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(mockStreamMessage.mock.calls)).toContain('[SYSTEM ASYNC HOLD]');
    expect(JSON.stringify(mockStreamMessage.mock.calls)).toContain(
      '[SYSTEM WORKFLOW JOIN REQUIRED]',
    );
  });
});
