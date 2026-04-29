// ---------------------------------------------------------------------------
// Tests — Orchestrator toolFilter (sandbox enforcement)
// ---------------------------------------------------------------------------

import {
  runOrchestrator,
  OrchestratorCallbacks,
  OrchestratorOptions,
} from '../../src/engine/orchestrator';
import type { Message, LlmProviderConfig } from '../../src/types';

// ── Mocks ────────────────────────────────────────────────────────────────

const mockStreamMessage = jest.fn();
let mockWorkspaceTargets: any[] = [];

jest.mock('../../src/services/llm/LlmService', () => ({
  LlmService: jest.fn().mockImplementation(() => ({
    streamMessage: mockStreamMessage,
  })),
}));

const mockExecuteTool = jest.fn().mockResolvedValue('tool result');
jest.mock('../../src/engine/tools/index', () => ({
  executeTool: (...args: any[]) => mockExecuteTool(...args),
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
  resolvePersonaModel: jest.fn((_p: any, pId: string, m: string) => ({
    providerId: pId,
    model: m,
  })),
}));

jest.mock('../../src/services/storage/SecureStorage', () => ({
  getProviderApiKey: jest.fn().mockResolvedValue('sk-test'),
}));

jest.mock('../../src/store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      workspaceTargets: mockWorkspaceTargets,
    }),
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────────

function* makeStream(events: any[]) {
  for (const event of events) {
    yield event;
  }
}

const provider: LlmProviderConfig = {
  id: 'test',
  name: 'Test',
  type: 'openai',
  apiKey: 'sk-test',
  baseUrl: 'https://api.test.com',
  model: 'gpt-test',
  models: ['gpt-test'],
  enabled: true,
};

function makeCallbacks(): OrchestratorCallbacks & { calls: Record<string, any[]> } {
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
    onToolCallStart: jest.fn((tc) => calls.onToolCallStart.push(tc)),
    onToolCallComplete: jest.fn((tc) => calls.onToolCallComplete.push(tc)),
    onAssistantMessage: jest.fn(),
    onToolMessage: jest.fn((id, result) => calls.onToolMessage.push({ id, result })),
    onError: jest.fn((err) => calls.onError.push(err)),
    onUsage: jest.fn(),
    onDone: jest.fn(() => calls.onDone.push(true)),
  };
}

const makeMsg = (role: 'user' | 'assistant', content: string): Message => ({
  id: `msg-${Math.random()}`,
  role,
  content,
  timestamp: Date.now(),
});

beforeEach(() => {
  jest.clearAllMocks();
  mockStreamMessage.mockReset();
  mockExecuteTool.mockReset();
  mockExecuteTool.mockResolvedValue('tool result');
  mockWorkspaceTargets = [];
});

// ── Tests ────────────────────────────────────────────────────────────────

describe('Orchestrator — toolFilter', () => {
  it('only advertises tools that pass the current toolFilter policy', async () => {
    mockStreamMessage.mockReturnValueOnce(
      makeStream([
        { type: 'token', content: 'Done' },
        { type: 'done', content: 'Done' },
      ]),
    );

    const callbacks = makeCallbacks();
    const options: OrchestratorOptions = {
      provider,
      model: 'gpt-test',
      conversationId: 'conv-filter-tools',
      systemPrompt: 'Test',
      messages: [makeMsg('user', 'Search the documentation and fetch the page')],
      toolFilter: (name) => name === 'web_search' || name === 'web_fetch',
    };

    await runOrchestrator(options, callbacks);

    const [, streamOptions] = mockStreamMessage.mock.calls[0];
    expect(streamOptions.tools.map((tool: any) => tool.name)).toEqual(['web_search', 'web_fetch']);
  });

  it('passes the filtered callable tool inventory into executeTool context', async () => {
    mockStreamMessage
      .mockReturnValueOnce(
        makeStream([
          { type: 'token', content: '' },
          {
            type: 'tool_call',
            toolCall: { id: 'tc-catalog', name: 'tool_catalog', arguments: '{"category":"mcp"}' },
          },
          { type: 'done', content: '' },
        ]),
      )
      .mockReturnValueOnce(
        makeStream([
          { type: 'token', content: 'Done' },
          { type: 'done', content: 'Done' },
        ]),
      );

    const callbacks = makeCallbacks();
    const options: OrchestratorOptions = {
      provider,
      model: 'gpt-test',
      conversationId: 'conv-filter-catalog-context',
      systemPrompt: 'Test',
      messages: [makeMsg('user', 'Inspect MCP capabilities')],
      toolFilter: (name) => name === 'tool_catalog' || name === 'read_file',
    };

    await runOrchestrator(options, callbacks);

    expect(mockExecuteTool).toHaveBeenCalledWith(
      'tool_catalog',
      '{"category":"mcp"}',
      'conv-filter-catalog-context',
      expect.objectContaining({
        availableToolNames: ['read_file', 'tool_catalog'],
      }),
    );
  });

  it('blocks a tool call when toolFilter returns false', async () => {
    // First stream returns a tool call, second returns final text
    mockStreamMessage
      .mockReturnValueOnce(
        makeStream([
          { type: 'token', content: '' },
          { type: 'tool_call', toolCall: { id: 'tc1', name: 'dangerous_tool', arguments: '{}' } },
          { type: 'done', content: '' },
        ]),
      )
      .mockReturnValueOnce(
        makeStream([
          { type: 'token', content: 'Done' },
          { type: 'done', content: 'Done' },
        ]),
      );

    const callbacks = makeCallbacks();
    const options: OrchestratorOptions = {
      provider,
      model: 'gpt-test',
      conversationId: 'conv-filter',
      systemPrompt: 'Test',
      messages: [makeMsg('user', 'Do something')],
      toolFilter: (name) => name !== 'dangerous_tool',
    };

    await runOrchestrator(options, callbacks);

    // The dangerous tool should NOT have been executed
    expect(mockExecuteTool).not.toHaveBeenCalled();

    // The tool call should have been reported as failed
    const completedCalls = callbacks.calls.onToolCallComplete;
    const filtered = completedCalls.find(
      (tc: any) => tc.name === 'dangerous_tool' && tc.status === 'failed',
    );
    expect(filtered).toBeDefined();
    expect(filtered.error).toContain('not allowed');
  });

  it('allows a tool call when toolFilter returns true', async () => {
    mockStreamMessage
      .mockReturnValueOnce(
        makeStream([
          { type: 'token', content: '' },
          { type: 'tool_call', toolCall: { id: 'tc2', name: 'safe_tool', arguments: '{}' } },
          { type: 'done', content: '' },
        ]),
      )
      .mockReturnValueOnce(
        makeStream([
          { type: 'token', content: 'Result' },
          { type: 'done', content: 'Result' },
        ]),
      );

    const callbacks = makeCallbacks();
    const options: OrchestratorOptions = {
      provider,
      model: 'gpt-test',
      conversationId: 'conv-filter-pass',
      systemPrompt: 'Test',
      messages: [makeMsg('user', 'Do something safe')],
      toolFilter: (name) => name === 'safe_tool',
    };

    await runOrchestrator(options, callbacks);

    expect(mockExecuteTool).toHaveBeenCalledWith(
      'safe_tool',
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ model: 'gpt-test' }),
    );
  });

  it('normalizes aliased tool names before applying toolFilter and execution', async () => {
    mockStreamMessage
      .mockReturnValueOnce(
        makeStream([
          { type: 'token', content: '' },
          {
            type: 'tool_call',
            toolCall: { id: 'tc-alias', name: 'ReadFile', arguments: '{"path":"notes.txt"}' },
          },
          { type: 'done', content: '' },
        ]),
      )
      .mockReturnValueOnce(
        makeStream([
          { type: 'token', content: 'Done' },
          { type: 'done', content: 'Done' },
        ]),
      );

    const callbacks = makeCallbacks();
    const options: OrchestratorOptions = {
      provider,
      model: 'gpt-test',
      conversationId: 'conv-filter-alias',
      systemPrompt: 'Test',
      messages: [makeMsg('user', 'Read notes.txt')],
      toolFilter: (name) => name === 'read_file',
    };

    await runOrchestrator(options, callbacks);

    expect(mockExecuteTool).toHaveBeenCalledWith(
      'read_file',
      '{"path":"notes.txt"}',
      'conv-filter-alias',
      expect.objectContaining({ model: 'gpt-test' }),
    );
    expect(callbacks.calls.onToolCallStart[0]).toMatchObject({ name: 'read_file' });
    expect(callbacks.calls.onToolCallComplete[0]).toMatchObject({
      name: 'read_file',
      status: 'completed',
    });
  });

  it('falls back from remote workspace file tools to local file tools when no remote workspace target is available', async () => {
    mockStreamMessage
      .mockReturnValueOnce(
        makeStream([
          { type: 'token', content: '' },
          {
            type: 'tool_call',
            toolCall: {
              id: 'tc-workspace-fallback',
              name: 'workspace_write_file',
              arguments: '{"path":"notes.txt","content":"hello"}',
            },
          },
          { type: 'done', content: '' },
        ]),
      )
      .mockReturnValueOnce(
        makeStream([
          { type: 'token', content: 'Done' },
          { type: 'done', content: 'Done' },
        ]),
      );

    const callbacks = makeCallbacks();
    const options: OrchestratorOptions = {
      provider,
      model: 'gpt-test',
      conversationId: 'conv-workspace-fallback',
      systemPrompt: 'Test',
      messages: [makeMsg('user', 'Update notes.txt in this repo')],
    };

    await runOrchestrator(options, callbacks);

    expect(mockExecuteTool).toHaveBeenCalledWith(
      'write_file',
      '{"path":"notes.txt","content":"hello"}',
      'conv-workspace-fallback',
      expect.objectContaining({ model: 'gpt-test' }),
    );
    expect(callbacks.calls.onToolCallStart[0]).toMatchObject({ name: 'write_file' });
    expect(callbacks.calls.onToolCallComplete[0]).toMatchObject({
      name: 'write_file',
      status: 'completed',
    });
  });

  it('does not filter when toolFilter is undefined', async () => {
    mockStreamMessage
      .mockReturnValueOnce(
        makeStream([
          { type: 'token', content: '' },
          { type: 'tool_call', toolCall: { id: 'tc3', name: 'any_tool', arguments: '{}' } },
          { type: 'done', content: '' },
        ]),
      )
      .mockReturnValueOnce(
        makeStream([
          { type: 'token', content: 'OK' },
          { type: 'done', content: 'OK' },
        ]),
      );

    const callbacks = makeCallbacks();
    const options: OrchestratorOptions = {
      provider,
      model: 'gpt-test',
      conversationId: 'conv-no-filter',
      systemPrompt: 'Test',
      messages: [makeMsg('user', 'Anything')],
      // toolFilter omitted
    };

    await runOrchestrator(options, callbacks);

    expect(mockExecuteTool).toHaveBeenCalledWith(
      'any_tool',
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ model: 'gpt-test' }),
    );
  });

  it('blocks tool but continues orchestration with next text response', async () => {
    mockStreamMessage
      .mockReturnValueOnce(
        makeStream([
          { type: 'token', content: '' },
          { type: 'tool_call', toolCall: { id: 'tc4', name: 'blocked_tool', arguments: '{}' } },
          { type: 'done', content: '' },
        ]),
      )
      .mockReturnValueOnce(
        makeStream([
          { type: 'token', content: 'Fallback answer' },
          { type: 'done', content: 'Fallback answer' },
        ]),
      );

    const callbacks = makeCallbacks();
    const options: OrchestratorOptions = {
      provider,
      model: 'gpt-test',
      conversationId: 'conv-blocked-continue',
      systemPrompt: 'Test',
      messages: [makeMsg('user', 'Try blocked tool')],
      toolFilter: () => false,
    };

    await runOrchestrator(options, callbacks);

    // Should complete with onDone
    expect(callbacks.onDone).toHaveBeenCalled();
    // Tool should not have been executed
    expect(mockExecuteTool).not.toHaveBeenCalled();
  });
});

describe('Orchestrator — cancel before tool execution', () => {
  it('does not execute tool when signal is aborted', async () => {
    const abortController = new AbortController();

    mockStreamMessage.mockReturnValueOnce(
      makeStream([
        { type: 'token', content: '' },
        { type: 'tool_call', toolCall: { id: 'tc-cancel', name: 'some_tool', arguments: '{}' } },
        { type: 'done', content: '' },
      ]),
    );

    // Abort before tool execution starts (simulate via onToolCallStart)
    const callbacks = makeCallbacks();
    const originalOnToolCallStart = callbacks.onToolCallStart;
    callbacks.onToolCallStart = jest.fn((tc) => {
      // Abort as soon as we see tool call start (before execution)
      if (tc.status === 'running') {
        abortController.abort();
      }
      originalOnToolCallStart(tc);
    });

    const options: OrchestratorOptions = {
      provider,
      model: 'gpt-test',
      conversationId: 'conv-cancel',
      systemPrompt: 'Test',
      messages: [makeMsg('user', 'Run tool')],
      signal: abortController,
    };

    await runOrchestrator(options, callbacks);

    // Tool should not have been executed
    expect(mockExecuteTool).not.toHaveBeenCalled();
  });
});
