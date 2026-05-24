// ---------------------------------------------------------------------------
// Tests — Orchestrator
// ---------------------------------------------------------------------------

import {
  runOrchestrator,
  OrchestratorCallbacks,
  OrchestratorOptions,
  MAX_TOOL_ITERATIONS,
  MAX_IDENTICAL_TOOL_CALLS,
} from '../../src/engine/orchestrator';
import { AssistantMessageMetadata, Message, LlmProviderConfig } from '../../src/types';

// Mock the LlmService
jest.mock('../../src/services/llm/LlmService', () => {
  return {
    LlmService: jest.fn().mockImplementation(() => ({
      streamMessage: jest.fn(),
    })),
  };
});

jest.mock('../../src/engine/tools/index', () => ({
  executeTool: jest.fn().mockResolvedValue('tool result'),
  loadMemory: jest.fn().mockResolvedValue(null),
  normalizeToolName: jest.fn((name: string) => name === 'ReadFile' ? 'read_file' : name),
}));

// Mock new dependencies added by the orchestrator rewrite
jest.mock('../../src/services/events/bus', () => ({
  emitSessionEvent: jest.fn().mockResolvedValue(undefined),
  emitAgentEvent: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../src/services/usage/tracker', () => ({
  recordUsage: jest.fn(),
  normalizeUsage: jest.fn().mockReturnValue({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 }),
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
  resolvePersonaSystemPrompt: jest.fn((_p: any, prompt: string) => prompt),
  resolvePersonaModel: jest.fn((_p: any, providerId: string, model: string) => ({
    providerId,
    model,
  })),
}));
jest.mock('../../src/services/agents/registry', () => ({
  getPersona: jest.fn().mockReturnValue(undefined),
}));
jest.mock('../../src/services/storage/SecureStorage', () => ({
  getProviderApiKey: jest.fn().mockResolvedValue('sk-test'),
}));

import { LlmService } from '../../src/services/llm/LlmService';
import { executeTool } from '../../src/engine/tools/index';
import { getSkillSystemPrompts } from '../../src/services/skills/manager';
import { getConversationMemoryForSystemPrompt } from '../../src/services/memory/store';
import { buildLivingMemorySections } from '../../src/services/memory/livingMemoryBridge';
import { getProviderApiKey } from '../../src/services/storage/SecureStorage';
import * as memoryAccessGateway from '../../src/services/memory/memoryAccessGateway';

const legacyFileSystem = jest.requireMock('expo-file-system/legacy') as {
  readAsStringAsync: jest.Mock;
};

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

const makeCallbacks = (): OrchestratorCallbacks & { calls: Record<string, any[]>; getVisibleTokenText: () => string } => {
  const calls: Record<string, any[]> = {
    onStateChange: [],
    onToken: [],
    onReasoning: [],
    onAssistantStreamReset: [],
    onToolCallStart: [],
    onToolCallComplete: [],
    onAssistantMessage: [],
    onToolMessage: [],
    onError: [],
    onUsage: [],
    onDone: [],
  };
  let visibleTokenText = '';

  return {
    calls,
    getVisibleTokenText: () => visibleTokenText,
    onStateChange: jest.fn((state) => calls.onStateChange.push(state)),
    onToken: jest.fn((token) => {
      calls.onToken.push(token);
      visibleTokenText += token;
    }),
    onReasoning: jest.fn((token) => calls.onReasoning.push(token)),
    onAssistantStreamReset: jest.fn(() => {
      calls.onAssistantStreamReset.push(true);
      visibleTokenText = '';
    }),
    onToolCallStart: jest.fn((tc) => calls.onToolCallStart.push(tc)),
    onToolCallComplete: jest.fn((tc) => calls.onToolCallComplete.push(tc)),
    onAssistantMessage: jest.fn((content, tcs, providerReplay, assistantMetadata) => calls.onAssistantMessage.push({ content, toolCalls: tcs, providerReplay, assistantMetadata })),
    onToolMessage: jest.fn((id, result) => calls.onToolMessage.push({ id, result })),
    onError: jest.fn((err) => calls.onError.push(err)),
    onUsage: jest.fn((usage) => calls.onUsage.push(usage)),
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
  const parserModule = jest.requireMock('../../src/services/commands/parser') as {
    isSlashCommand: jest.Mock;
    parseCommand: jest.Mock;
  };
  const builtinsModule = jest.requireMock('../../src/services/commands/builtins') as {
    getCommand: jest.Mock;
  };
  parserModule.isSlashCommand.mockReset();
  parserModule.isSlashCommand.mockReturnValue(false);
  parserModule.parseCommand.mockReset();
  parserModule.parseCommand.mockReturnValue(null);
  builtinsModule.getCommand.mockReset();
  builtinsModule.getCommand.mockReturnValue(null);
  legacyFileSystem.readAsStringAsync.mockReset();
  mockStreamMessage.mockReset();
  (LlmService as any).mockImplementation(() => ({
    streamMessage: mockStreamMessage,
  }));
  (getConversationMemoryForSystemPrompt as jest.Mock).mockReset();
  (getConversationMemoryForSystemPrompt as jest.Mock).mockResolvedValue(null);
  (buildLivingMemorySections as jest.Mock).mockReset();
  (buildLivingMemorySections as jest.Mock).mockResolvedValue({
    sections: [],
    cacheableSignature: '00000000',
    focusBlockText: '',
    openThreadLabels: [],
    recalledFactCount: 0,
  });
  (getSkillSystemPrompts as jest.Mock).mockReset();
  (getSkillSystemPrompts as jest.Mock).mockResolvedValue('');
  (executeTool as jest.Mock).mockReset();
  (executeTool as jest.Mock).mockResolvedValue('tool result');
  (getProviderApiKey as jest.Mock).mockReset();
  (getProviderApiKey as jest.Mock).mockResolvedValue('sk-test');
});

describe('Orchestrator', () => {
  describe('Constants', () => {
    it('should have MAX_TOOL_ITERATIONS > 0', () => {
      expect(MAX_TOOL_ITERATIONS).toBeGreaterThan(0);
    });

    it('should have MAX_IDENTICAL_TOOL_CALLS > 0', () => {
      expect(MAX_IDENTICAL_TOOL_CALLS).toBeGreaterThan(0);
    });
  });

  describe('Model selection', () => {
    it('keeps the requested model on later tool-follow-up turns by default', async () => {
      let callCount = 0;
      mockStreamMessage.mockImplementation(() => {
        callCount += 1;
        if (callCount === 1) {
          return createStreamGenerator([
            {
              type: 'tool_call',
              toolCall: { id: 'tc1', name: 'read_file', arguments: '{"path":"test.txt"}' },
            },
            { type: 'done' },
          ]);
        }

        return createStreamGenerator([
          { type: 'token', content: 'done' },
          { type: 'done' },
        ]);
      });

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider({
          model: 'gpt-5.4-mini',
          availableModels: ['gpt-5.4-mini'],
        }),
        model: 'gpt-5.4',
        conversationId: 'conv-model-lock',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'msg1', role: 'user', content: 'Read test.txt', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      expect(mockStreamMessage).toHaveBeenCalledTimes(2);
      expect(mockStreamMessage.mock.calls[0][1]).toEqual(expect.objectContaining({ model: 'gpt-5.4' }));
      expect(mockStreamMessage.mock.calls[1][1]).toEqual(expect.objectContaining({ model: 'gpt-5.4' }));
    });
  });

  describe('Simple text response', () => {
    it('should handle a simple text response without tool calls', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Hello' },
          { type: 'token', content: ' world' },
          { type: 'done', content: 'Hello world' },
        ]),
      );

      const callbacks = makeCallbacks();
      callbacks.onUserMessageEnriched = jest.fn();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv1',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'msg1', role: 'user', content: 'Hi', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      expect(callbacks.onStateChange).toHaveBeenCalledWith('thinking');
      expect(callbacks.onStateChange).toHaveBeenCalledWith('responding');
      expect(callbacks.onStateChange).toHaveBeenCalledWith('idle');
      expect(callbacks.calls.onToken).toEqual(['Hello', ' world']);
      expect(callbacks.calls.onAssistantMessage).toEqual([
        {
          content: 'Hello world',
          toolCalls: [],
          providerReplay: undefined,
          assistantMetadata: {
            kind: 'final',
            completionStatus: 'complete',
          },
        },
      ]);
      expect(callbacks.onDone).toHaveBeenCalled();
    });

    it('marks non-resumable incomplete terminal text responses as incomplete final answers', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Partial answer' },
          { type: 'done', content: 'Partial answer', completion: { completionStatus: 'incomplete', finishReason: 'content_filter' } },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv1',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'msg1', role: 'user', content: 'Hi', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      expect(callbacks.calls.onAssistantMessage).toHaveLength(1);
      expect(callbacks.calls.onAssistantMessage[0].content).toBe('Partial answer');
      expectAssistantMetadata(callbacks.calls.onAssistantMessage[0].assistantMetadata, {
        kind: 'final',
        completionStatus: 'incomplete',
        finishReason: 'content_filter',
      });
    });

    it('continues recoverable incomplete final text turns before finalizing', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Partial answer' },
          { type: 'done', content: 'Partial answer', completion: { completionStatus: 'incomplete', finishReason: 'length' } },
        ]),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: ' continued cleanly.' },
          { type: 'done', content: ' continued cleanly.', completion: { completionStatus: 'complete', finishReason: 'stop' } },
        ]),
      );

      const callbacks = makeCallbacks();
      callbacks.onUserMessageEnriched = jest.fn();
      const options: OrchestratorOptions = {
        provider: makeProvider({
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
        }),
        model: 'gpt-5.4',
        conversationId: 'conv-incomplete-final',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'msg1', role: 'user', content: 'Finish the final answer', timestamp: Date.now() }],
        maxTokens: 4096,
      };

      await runOrchestrator(options, callbacks);

      expect(mockStreamMessage).toHaveBeenCalledTimes(2);
      expect(mockStreamMessage.mock.calls[1][1].tools).toBeUndefined();
      expect(mockStreamMessage.mock.calls[1][1].maxTokens).toBeGreaterThan(mockStreamMessage.mock.calls[0][1].maxTokens);
      expect(callbacks.calls.onAssistantMessage).toEqual([
        {
          content: 'Partial answer continued cleanly.',
          toolCalls: [],
          providerReplay: undefined,
          assistantMetadata: {
            kind: 'final',
            completionStatus: 'complete',
            finishReason: 'stop',
          },
        },
      ]);
      expect(callbacks.calls.onError).toHaveLength(0);
    });

    it('uses persisted enriched user content when formatting API messages', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Done' },
          { type: 'done', content: 'Done' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv1',
        systemPrompt: 'You are helpful',
        messages: [{
          id: 'msg1',
          role: 'user',
          content: 'Check https://example.com',
          enrichedContent: 'Check https://example.com\n\n<link_context>Full extracted article</link_context>',
          timestamp: Date.now(),
        }],
      };

      await runOrchestrator(options, callbacks);

      const apiMessages = mockStreamMessage.mock.calls[0][0];
      expect(apiMessages[1]).toMatchObject({ role: 'user' });
      expect(apiMessages[1].content).toContain('<link_context>Full extracted article</link_context>');
      expect(apiMessages[1].content).toContain('<runtime_context>');
    });

    it('excludes stale unrelated topic history before sending request messages', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Done' },
          { type: 'done', content: 'Done' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-topic-boundary',
        systemPrompt: 'You are helpful',
        messages: [
          {
            id: 'old-user',
            role: 'user',
            content: 'Plan my beach vacation itinerary for July.',
            timestamp: 1_000,
          },
          {
            id: 'old-assistant',
            role: 'assistant',
            content: 'Here is your beach itinerary.',
            timestamp: 2_000,
          },
          {
            id: 'new-user',
            role: 'user',
            content: 'Fix the production migration mismatch in release workflow.',
            timestamp: 30_000_000,
          },
        ],
      };

      await runOrchestrator(options, callbacks);

      const apiMessages = mockStreamMessage.mock.calls[0][0] as Array<{
        role: string;
        content: string | Array<{ type: string; text?: string }>;
      }>;

      const flattened = apiMessages
        .map((message) =>
          typeof message.content === 'string'
            ? message.content
            : message.content
                .map((part) => (part && typeof part.text === 'string' ? part.text : ''))
                .join('\n'),
        )
        .join('\n');

      expect(flattened).toContain('Fix the production migration mismatch in release workflow.');
      expect(flattened).not.toContain('Plan my beach vacation itinerary for July.');
      expect(getSkillSystemPrompts).toHaveBeenCalledWith(
        'conv-topic-boundary',
        expect.not.stringContaining('Plan my beach vacation itinerary for July.'),
      );
    });

    it('includes non-image attachment metadata in API messages', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Done' },
          { type: 'done', content: 'Done' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-attachments',
        systemPrompt: 'You are helpful',
        messages: [{
          id: 'msg1',
          role: 'user',
          content: '',
          attachments: [{
            id: 'att-1',
            type: 'file',
            uri: 'file:///report.pdf',
            name: 'report.pdf',
            mimeType: 'application/pdf',
            size: 2048,
          }],
          timestamp: Date.now(),
        }],
      };

      await runOrchestrator(options, callbacks);

      const apiMessages = mockStreamMessage.mock.calls[0][0];
      expect(apiMessages[1].role).toBe('user');
      expect(apiMessages[1].content).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'text',
            text: expect.stringContaining('<runtime_context>'),
          }),
          expect.objectContaining({
            type: 'text',
            text: expect.stringContaining('report.pdf'),
          }),
        ]),
      );
    });

    it('loads local image attachments from disk for the API payload', async () => {
      legacyFileSystem.readAsStringAsync.mockResolvedValueOnce('diskimagebase64');
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Done' },
          { type: 'done', content: 'Done' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-image-attachment',
        systemPrompt: 'You are helpful',
        messages: [{
          id: 'msg1',
          role: 'user',
          content: 'Describe this image',
          attachments: [{
            id: 'att-1',
            type: 'image',
            uri: 'file:///photo.jpg',
            name: 'photo.jpg',
            mimeType: 'image/jpeg',
            size: 1024,
          }],
          timestamp: Date.now(),
        }],
      };

      await runOrchestrator(options, callbacks);

      const apiMessages = mockStreamMessage.mock.calls[0][0];
      expect(apiMessages[1].content).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'text',
            text: expect.stringContaining('<runtime_context>'),
          }),
          expect.objectContaining({
            type: 'image_url',
            image_url: { url: 'data:image/jpeg;base64,diskimagebase64' },
          }),
        ]),
      );
    });

    it('enables prompt caching while preserving the full planning budget for large actionable prompts', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Done' },
          { type: 'done', content: 'Done' },
        ]),
      );

      const callbacks = makeCallbacks();
      callbacks.onUserMessageEnriched = jest.fn();
      const options: OrchestratorOptions = {
        provider: makeProvider({
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
        }),
        model: 'gpt-5.4',
        conversationId: 'conv-cache',
        systemPrompt: 'A'.repeat(5000),
        messages: [{ id: 'msg1', role: 'user', content: 'Investigate this repository thoroughly', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      const [, streamOptions] = mockStreamMessage.mock.calls[0];
      expect(streamOptions.enablePromptCaching).toBe(true);
      expect(streamOptions.promptCacheKey).toContain('cm:');
      expect(streamOptions.maxTokens).toBe(8192);
    });

    it('keeps Gemini on native provider caching instead of synthesizing a generic cache key', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Done' },
          { type: 'done', content: 'Done' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider({
          id: 'gemini',
          name: 'Gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
          apiKey: 'AIza-test',
          model: 'gemini-3-flash-preview',
        }),
        model: 'gemini-3-flash-preview',
        conversationId: 'conv-gemini-cache',
        systemPrompt: 'A'.repeat(5000),
        messages: [{ id: 'msg1', role: 'user', content: 'Investigate this repository thoroughly', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      const [, streamOptions] = mockStreamMessage.mock.calls[0];
      expect(streamOptions.enablePromptCaching).toBe(true);
      expect(streamOptions.promptCacheKey).toBeUndefined();
    });

    it('moves runtime context onto the active user turn and passes generic system sections for caching', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Done' },
          { type: 'done', content: 'Done' },
        ]),
      );

      const callbacks = makeCallbacks();
      callbacks.onUserMessageEnriched = jest.fn();
      const options: OrchestratorOptions = {
        provider: makeProvider({
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-openai',
          model: 'gpt-5.4',
        }),
        model: 'gpt-5.4',
        conversationId: 'conv-provider-agnostic-cache',
        systemPrompt: 'A'.repeat(9000),
        messages: [{ id: 'msg1', role: 'user', content: 'Investigate this repository thoroughly', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      const [apiMessages, streamOptions] = mockStreamMessage.mock.calls[0];
      expect(apiMessages[0]?.content).toContain('active user turn may include a <runtime_context> block');
      expect(apiMessages[0]?.content).not.toContain('Current time (UTC):');
      expect(apiMessages[1]?.content).toContain('<runtime_context>');
      expect(apiMessages[1]?.content).toContain('request_timestamp_utc:');
      expect(streamOptions.enablePromptCaching).toBe(true);
      const systemPromptSections = streamOptions.systemPromptSections as Array<{
        cacheable?: boolean;
      }>;
      expect(systemPromptSections.some((section) => section.cacheable === true)).toBe(true);
      expect(systemPromptSections.some((section) => section.cacheable !== true)).toBe(true);
      let sawDynamicSection = false;
      for (const section of systemPromptSections) {
        if (section.cacheable === true) {
          expect(sawDynamicSection).toBe(false);
          continue;
        }

        sawDynamicSection = true;
      }
      expect(callbacks.onUserMessageEnriched).not.toHaveBeenCalled();
    });
  });

  describe('Tool call handling', () => {
    it('should execute tool calls and continue the loop', async () => {
      // First iteration: tool call
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: '' },
          { type: 'tool_call', toolCall: { id: 'tc1', name: 'read_file', arguments: '{"path":"test.txt"}' } },
          { type: 'done', content: '' },
        ]),
      );

      // Second iteration: final text response
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'The file says: tool result' },
          { type: 'done', content: 'The file says: tool result' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv1',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'msg1', role: 'user', content: 'Read file', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      expect(executeTool).toHaveBeenCalledWith(
        'read_file',
        '{"path":"test.txt"}',
        'conv1',
        expect.objectContaining({
          provider: expect.objectContaining({ id: 'test' }),
          model: 'gpt-5.4',
        }),
      );
      expect(callbacks.onToolCallStart).toHaveBeenCalled();
      expect(callbacks.onToolCallComplete).toHaveBeenCalled();
      expect(callbacks.calls.onAssistantMessage).toHaveLength(2);
      expect(callbacks.onDone).toHaveBeenCalled();
    });

    it('deduplicates one logical tool call when streaming metadata upgrades its id mid-turn', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          {
            type: 'tool_call',
            toolCall: {
              id: 'fc_1',
              name: 'read_file',
              arguments: '{"path":"test.txt"}',
              raw: {
                id: 'fc_1',
                type: 'function',
                function: {
                  name: 'read_file',
                  arguments: '{"path":"test.txt"}',
                },
                _openai: {
                  itemId: 'fc_1',
                  outputIndex: 0,
                },
              },
            },
          },
          {
            type: 'tool_call',
            toolCall: {
              id: 'call_1',
              name: 'read_file',
              arguments: '{"path":"test.txt"}',
              raw: {
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'read_file',
                  arguments: '{"path":"test.txt"}',
                },
                _openai: {
                  itemId: 'fc_1',
                  callId: 'call_1',
                  outputIndex: 0,
                },
              },
            },
          },
          { type: 'done', content: '' },
        ]),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'The file says: tool result' },
          { type: 'done', content: 'The file says: tool result' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-logical-tool-upgrade',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'msg1', role: 'user', content: 'Read file', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      expect(executeTool).toHaveBeenCalledTimes(1);
      expect(executeTool).toHaveBeenCalledWith(
        'read_file',
        '{"path":"test.txt"}',
        'conv-logical-tool-upgrade',
        expect.objectContaining({ model: 'gpt-5.4' }),
      );
      expect(callbacks.calls.onAssistantMessage[0].toolCalls).toEqual([
        expect.objectContaining({
          id: 'call_1',
          name: 'read_file',
          arguments: '{"path":"test.txt"}',
        }),
      ]);
      expect(callbacks.calls.onToolCallStart).toHaveLength(1);
      expect(callbacks.calls.onToolCallStart[0]).toEqual(expect.objectContaining({ id: 'call_1' }));
      expect(callbacks.calls.onToolMessage).toEqual([
        expect.objectContaining({ id: 'call_1', result: 'tool result' }),
      ]);
    });

    it('streams direct text before a tool-capable turn completes', async () => {
      let releaseCompletion: (() => void) | undefined;

      mockStreamMessage.mockImplementationOnce(() => (async function* () {
        yield { type: 'token', content: 'Hello' };
        await new Promise<void>((resolve) => {
          releaseCompletion = resolve;
        });
        yield { type: 'done', content: 'Hello' };
      })());

      const callbacks = makeCallbacks();
      let resolveFirstToken: (() => void) | undefined;
      const firstTokenSeen = new Promise<void>((resolve) => {
        resolveFirstToken = resolve;
      });
      const originalOnToken = callbacks.onToken;
      callbacks.onToken = jest.fn((token: string) => {
        (originalOnToken as jest.Mock)(token);
        resolveFirstToken?.();
      });

      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-streaming',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'msg1', role: 'user', content: 'Answer directly', timestamp: Date.now() }],
      };

      const runPromise = runOrchestrator(options, callbacks);

      await firstTokenSeen;

      expect(callbacks.calls.onToken).toEqual(['Hello']);
      expect(callbacks.calls.onAssistantMessage).toHaveLength(0);
      expect(callbacks.onDone).not.toHaveBeenCalled();

      releaseCompletion?.();
      await runPromise;

      expect(callbacks.calls.onAssistantMessage[0]).toEqual({
        content: 'Hello',
        toolCalls: [],
        providerReplay: undefined,
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'complete',
        },
      });
    });

    it('rejects incomplete tool-planning turns before executing partial tool calls', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'partial-attempt' },
          {
            type: 'tool_call',
            toolCall: {
              id: 'tc-incomplete',
              name: 'read_file',
              arguments: '{"path":"partial',
            },
          },
          {
            type: 'done',
            content: '',
            completion: {
              completionStatus: 'incomplete',
              finishReason: 'stream_ended_without_done_marker',
            },
          },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv1',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'msg1', role: 'user', content: 'Read file', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      expect(executeTool).not.toHaveBeenCalled();
      expect(callbacks.onError).toHaveBeenCalledWith(expect.any(Error));
      expect(callbacks.calls.onError[0].message).toContain('Partial tool calls were discarded');
      expect(callbacks.calls.onError[0].message).toContain('stream_ended_without_done_marker');
      expect(callbacks.calls.onToken).toContain('partial-attempt');
      expect(callbacks.calls.onAssistantStreamReset).toHaveLength(1);
      expect(callbacks.getVisibleTokenText()).toBe('');
      expect(callbacks.calls.onAssistantMessage).toHaveLength(0);
      expect(callbacks.onStateChange).toHaveBeenCalledWith('error');
      expect(callbacks.onDone).toHaveBeenCalled();
    });

    it('retries token-exhausted tool-planning turns before executing tools', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'discarded-attempt' },
          {
            type: 'tool_call',
            toolCall: {
              id: 'tc-retry',
              name: 'read_file',
              arguments: '{"path":"partial',
            },
          },
          {
            type: 'done',
            content: '',
            completion: {
              completionStatus: 'incomplete',
              finishReason: 'max_tokens',
            },
          },
        ]),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'retried-attempt' },
          {
            type: 'tool_call',
            toolCall: {
              id: 'tc-retry',
              name: 'read_file',
              arguments: '{"path":"test.txt"}',
            },
          },
          {
            type: 'done',
            content: '',
            completion: {
              completionStatus: 'complete',
              finishReason: 'tool_use',
            },
          },
        ]),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'final-answer' },
          { type: 'done', content: 'final-answer' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-retry',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'msg1', role: 'user', content: 'Read file', timestamp: Date.now() }],
        maxTokens: 4096,
      };

      await runOrchestrator(options, callbacks);

      expect(mockStreamMessage).toHaveBeenCalledTimes(3);
      expect(mockStreamMessage.mock.calls[0][1].maxTokens).toBe(8192);
      expect(mockStreamMessage.mock.calls[1][1].maxTokens).toBeGreaterThan(8192);
      expect(executeTool).toHaveBeenCalledTimes(1);
      expect(executeTool).toHaveBeenCalledWith(
        'read_file',
        '{"path":"test.txt"}',
        'conv-retry',
        expect.objectContaining({ model: 'gpt-5.4' }),
      );
      expect(callbacks.calls.onToken).toContain('discarded-attempt');
      expect(callbacks.calls.onToken).toContain('retried-attempt');
      expect(callbacks.calls.onToken).toContain('final-answer');
      expect(callbacks.calls.onAssistantStreamReset).toHaveLength(1);
      expect(callbacks.getVisibleTokenText()).toBe('retried-attemptfinal-answer');
      expect(callbacks.onError).not.toHaveBeenCalled();
    });

    it('replays Gemini tool calls with preserved thought signatures', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          {
            type: 'tool_call',
            toolCall: {
              id: 'tc1',
              name: 'read_file',
              arguments: '{"path":"test.txt"}',
              raw: {
                id: 'tc1',
                type: 'function',
                extra_content: {
                  google: {
                    thought_signature: 'sig-A',
                  },
                },
                function: {
                  name: 'read_file',
                  arguments: '{"path":"test.txt"}',
                },
              },
            },
          },
          { type: 'done', content: '' },
        ]),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Done' },
          { type: 'done', content: 'Done' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider({
          id: 'gemini',
          name: 'Gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
          model: 'gemini-3-flash-preview',
        }),
        model: 'gemini-3-flash-preview',
        conversationId: 'conv1',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'msg1', role: 'user', content: 'Read file', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      const secondApiMessages = mockStreamMessage.mock.calls[1][0];
      const assistantReplay = secondApiMessages.find((message: any) => message.role === 'assistant');
      const toolReplay = secondApiMessages.find((message: any) => message.role === 'tool');

      expect(assistantReplay.tool_calls[0].extra_content.google.thought_signature).toBe('sig-A');
      expect(toolReplay).toMatchObject({
        role: 'tool',
        tool_call_id: 'tc1',
        name: 'read_file',
        content: 'tool result',
      });
      expect(callbacks.calls.onToolCallStart[0]).toMatchObject({
        id: 'tc1',
        name: 'read_file',
        raw: {
          extra_content: {
            google: {
              thought_signature: 'sig-A',
            },
          },
        },
      });
    });

    it('does not fabricate Gemini thought signatures when replay metadata is missing', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          {
            type: 'tool_call',
            toolCall: {
              id: 'tc1',
              name: 'read_file',
              arguments: '{"path":"test.txt"}',
            },
          },
          { type: 'done', content: '' },
        ]),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Done' },
          { type: 'done', content: 'Done' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider({
          id: 'gemini',
          name: 'Gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
          model: 'gemini-3-flash-preview',
        }),
        model: 'gemini-3-flash-preview',
        conversationId: 'conv1',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'msg1', role: 'user', content: 'Read file', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      const secondApiMessages = mockStreamMessage.mock.calls[1][0];
      const assistantReplay = secondApiMessages.find((message: any) => message.role === 'assistant');

      expect(assistantReplay.tool_calls[0].extra_content?.google?.thought_signature).toBeUndefined();
    });

    it('leaves replayed Gemini tool calls unchanged when exact metadata is missing', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Done' },
          { type: 'done', content: 'Done' },
        ]),
      );

      const callbacks = makeCallbacks();
      const now = Date.now();
      const options: OrchestratorOptions = {
        provider: makeProvider({
          id: 'gemini',
          name: 'Gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
          model: 'gemini-3-flash-preview',
        }),
        model: 'gemini-3-flash-preview',
        conversationId: 'conv1',
        systemPrompt: 'You are helpful',
        messages: [
          { id: 'u1', role: 'user', content: 'Read both files', timestamp: now },
          {
            id: 'a1',
            role: 'assistant',
            content: '',
            timestamp: now + 1,
            toolCalls: [
              { id: 'tc1', name: 'read_file', arguments: '{"path":"a.txt"}', status: 'completed' },
              { id: 'tc2', name: 'read_file', arguments: '{"path":"b.txt"}', status: 'completed' },
            ],
          },
          { id: 't1', role: 'tool', content: 'Error: a missing', toolCallId: 'tc1', timestamp: now + 2, isError: true },
          { id: 't2', role: 'tool', content: 'Error: b missing', toolCallId: 'tc2', timestamp: now + 3, isError: true },
          { id: 'u2', role: 'user', content: 'Read both files again and retry', timestamp: now + 4 },
        ],
      };

      await runOrchestrator(options, callbacks);

      const firstApiMessages = mockStreamMessage.mock.calls[0][0];
      const assistantReplay = firstApiMessages.find((message: any) => message.role === 'assistant');

      expect(assistantReplay.tool_calls).toHaveLength(2);
      expect(assistantReplay.tool_calls[0].extra_content?.google?.thought_signature).toBeUndefined();
      expect(assistantReplay.tool_calls[1].extra_content?.google?.thought_signature).toBeUndefined();
    });

    it('should handle tool execution failure', async () => {
      (executeTool as jest.Mock).mockRejectedValueOnce(new Error('Permission denied'));

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'tool_call', toolCall: { id: 'tc1', name: 'read_file', arguments: '{}' } },
          { type: 'done', content: '' },
        ]),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Sorry, failed' },
          { type: 'done', content: 'Sorry, failed' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv1',
        systemPrompt: 'sys',
        messages: [{ id: 'msg1', role: 'user', content: 'Read', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      const completedCall = callbacks.calls.onToolCallComplete[0];
      expect(completedCall.status).toBe('failed');
      expect(completedCall.error).toBe('Permission denied');
      expect(callbacks.onDone).toHaveBeenCalled();
    });

    it('runs eligible read-only tool batches in parallel', async () => {
      const resolvers: Array<(value: string) => void> = [];
      (executeTool as jest.Mock).mockImplementation(
        () => new Promise<string>((resolve) => {
          resolvers.push(resolve);
        }),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'tool_call', toolCall: { id: 'tc1', name: 'read_file', arguments: '{"path":"a.txt"}' } },
          { type: 'tool_call', toolCall: { id: 'tc2', name: 'glob_search', arguments: '{"pattern":"src/**/*.ts"}' } },
          { type: 'done', content: '' },
        ]),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Finished' },
          { type: 'done', content: 'Finished' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-parallel',
        systemPrompt: 'sys',
        messages: [{ id: 'msg1', role: 'user', content: 'Inspect the repo', timestamp: Date.now() }],
      };

      const runPromise = runOrchestrator(options, callbacks);

      for (let attempt = 0; attempt < 4 && (executeTool as jest.Mock).mock.calls.length < 2; attempt += 1) {
        // The orchestrator now yields once for assistant tool planning and once
        // again for each running tool so the mobile UI can paint pending/running
        // state before the tool work starts.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      expect(executeTool).toHaveBeenCalledTimes(2);

      resolvers[0]('file contents');
      resolvers[1]('search results');

      await runPromise;

      expect(callbacks.calls.onToolCallStart).toHaveLength(2);
      expect(callbacks.calls.onToolCallComplete).toHaveLength(2);
      expect(callbacks.onDone).toHaveBeenCalled();
    });

    it('keeps dynamic MCP tool batches sequential by default', async () => {
      const resolvers: Array<(value: string) => void> = [];
      (executeTool as jest.Mock).mockImplementation(
        () => new Promise<string>((resolve) => {
          resolvers.push(resolve);
        }),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'tool_call', toolCall: { id: 'tc1', name: 'mcp__docs__fetch', arguments: '{"path":"/a"}' } },
          { type: 'tool_call', toolCall: { id: 'tc2', name: 'mcp__docs__fetch', arguments: '{"path":"/b"}' } },
          { type: 'done', content: '' },
        ]),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Finished' },
          { type: 'done', content: 'Finished' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-dynamic-tools',
        systemPrompt: 'sys',
        messages: [{ id: 'msg1', role: 'user', content: 'Inspect the docs', timestamp: Date.now() }],
      };

      const runPromise = runOrchestrator(options, callbacks);

      for (let attempt = 0; attempt < 4 && (executeTool as jest.Mock).mock.calls.length < 1; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      expect(executeTool).toHaveBeenCalledTimes(1);

      resolvers[0]('first result');

      for (let attempt = 0; attempt < 4 && (executeTool as jest.Mock).mock.calls.length < 2; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      expect(executeTool).toHaveBeenCalledTimes(2);

      resolvers[1]('second result');

      await runPromise;

      expect(callbacks.calls.onToolCallStart).toHaveLength(2);
      expect(callbacks.calls.onToolCallComplete).toHaveLength(2);
      expect(callbacks.onDone).toHaveBeenCalled();
    });

    it('drops tool calls that appear after sessions_yield in the same assistant turn', async () => {
      (executeTool as jest.Mock).mockImplementationOnce(async (toolName: string) => {
        expect(toolName).toBe('sessions_yield');
        return JSON.stringify({
          status: 'completed',
          message: 'All workers are done.',
          finalizeSupervisor: true,
          pendingSessions: [],
        });
      });

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'tool_call', toolCall: { id: 'tc-yield', name: 'sessions_yield', arguments: '{"message":"checkpoint"}' } },
          { type: 'tool_call', toolCall: { id: 'tc-extra', name: 'read_file', arguments: '{"path":"after-yield.txt"}' } },
          { type: 'done', content: '' },
        ]),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Finalized after yield.' },
          { type: 'done', content: 'Finalized after yield.' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-yield',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'msg1', role: 'user', content: 'Monitor the workers', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      expect(executeTool).toHaveBeenCalledTimes(1);
      expect(executeTool).toHaveBeenCalledWith(
        'sessions_yield',
        '{"message":"checkpoint"}',
        'conv-yield',
        expect.objectContaining({
          provider: expect.objectContaining({ id: 'test' }),
          model: 'gpt-5.4',
        }),
      );
      expect(callbacks.calls.onAssistantMessage[0].toolCalls).toEqual([
        expect.objectContaining({ id: 'tc-yield', name: 'sessions_yield' }),
      ]);
      expect(callbacks.calls.onToolMessage).toEqual([
        expect.objectContaining({ id: 'tc-yield' }),
      ]);
      expect(callbacks.calls.onAssistantMessage[1]).toEqual(expect.objectContaining({
        content: 'Finalized after yield.',
      }));
    });

    it('should require tool use for actionable workspace requests on the first turn', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Inspecting' },
          { type: 'done', content: 'Inspecting' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv1',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'msg1', role: 'user', content: 'Read src/App.tsx and fix the issue', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      expect(mockStreamMessage).toHaveBeenCalled();
      expect(mockStreamMessage.mock.calls[0][1]).toEqual(expect.objectContaining({ toolChoice: 'required' }));
    });

    it('keeps Anthropic thinking enabled on coder-style turns by leaving tool use optional', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Inspecting' },
          { type: 'done', content: 'Inspecting' },
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
        conversationId: 'conv-anthropic-coder',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'msg1', role: 'user', content: 'Read src/App.tsx and fix the issue', timestamp: Date.now() }],
        thinkingLevel: 'high',
      };

      await runOrchestrator(options, callbacks);

      const [, streamOptions] = mockStreamMessage.mock.calls[0];
      expect(streamOptions.toolChoice).toBeUndefined();
      expect(streamOptions.tools?.length).toBeGreaterThan(0);
      expect(streamOptions.thinking).toEqual({ type: 'adaptive' });
      expect(streamOptions.output_config).toEqual({ effort: 'high' });
      expect(streamOptions.temperature).toBeUndefined();
    });

    it('keeps Anthropic thinking enabled on tool-capable turns when tool use is optional', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Merge sort uses divide and conquer.' },
          { type: 'done', content: 'Merge sort uses divide and conquer.' },
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
        conversationId: 'conv-anthropic-thinking',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'msg1', role: 'user', content: 'Explain merge sort.', timestamp: Date.now() }],
        thinkingLevel: 'high',
        temperature: 0.2,
      };

      await runOrchestrator(options, callbacks);

      const [, streamOptions] = mockStreamMessage.mock.calls[0];
      expect(streamOptions.toolChoice).toBeUndefined();
      expect(streamOptions.maxTokens).toBe(4096);
      expect(streamOptions.tools?.length).toBeGreaterThan(0);
      expect(streamOptions.thinking).toEqual({ type: 'adaptive' });
      expect(streamOptions.output_config).toEqual({ effort: 'high' });
      expect(streamOptions.temperature).toBeUndefined();
    });

    it('replays Anthropic assistant blocks and keeps thinking enabled in a replayable tool loop', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Done' },
          { type: 'done', content: 'Done' },
        ]),
      );

      const callbacks = makeCallbacks();
      const now = Date.now();
      const options: OrchestratorOptions = {
        provider: makeProvider({
          id: 'anthropic',
          name: 'Anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          model: 'claude-sonnet-4-6',
        }),
        model: 'claude-sonnet-4-6',
        conversationId: 'conv-anthropic-tool-loop',
        systemPrompt: 'You are helpful',
        messages: [
          { id: 'u1', role: 'user', content: 'Read notes.txt', timestamp: now },
          {
            id: 'a1',
            role: 'assistant',
            content: '',
            timestamp: now + 1,
            toolCalls: [{
              id: 'toolu_1',
              name: 'read_file',
              arguments: '{"path":"notes.txt"}',
              status: 'completed',
              raw: {
                id: 'toolu_1',
                type: 'function',
                function: { name: 'read_file', arguments: '{"path":"notes.txt"}' },
                extra_content: {
                  anthropic: {
                    assistant_blocks: [
                      { type: 'thinking', thinking: 'I should inspect the file first.', signature: 'sig-A' },
                      { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'notes.txt' } },
                    ],
                  },
                },
              },
            }],
          },
          { id: 't1', role: 'tool', content: 'file contents', toolCallId: 'toolu_1', timestamp: now + 2 },
        ],
        thinkingLevel: 'high',
        temperature: 0.2,
      };

      await runOrchestrator(options, callbacks);

      const [apiMessages, streamOptions] = mockStreamMessage.mock.calls[0];
      const assistantReplay = apiMessages.find((message: any) => message.role === 'assistant');

      expect(assistantReplay).toEqual({
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'I should inspect the file first.', signature: 'sig-A' },
          { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'notes.txt' } },
        ],
      });
      expect(streamOptions.thinking).toEqual({ type: 'adaptive' });
      expect(streamOptions.output_config).toEqual({ effort: 'high' });
      expect(streamOptions.temperature).toBeUndefined();
    });

    it('replays Anthropic redacted thinking blocks and keeps thinking enabled in a replayable tool loop', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Done' },
          { type: 'done', content: 'Done' },
        ]),
      );

      const callbacks = makeCallbacks();
      const now = Date.now();
      const options: OrchestratorOptions = {
        provider: makeProvider({
          id: 'anthropic',
          name: 'Anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          model: 'claude-sonnet-4-6',
        }),
        model: 'claude-sonnet-4-6',
        conversationId: 'conv-anthropic-redacted-tool-loop',
        systemPrompt: 'You are helpful',
        messages: [
          { id: 'u1', role: 'user', content: 'Read notes.txt', timestamp: now },
          {
            id: 'a1',
            role: 'assistant',
            content: '',
            timestamp: now + 1,
            toolCalls: [{
              id: 'toolu_1',
              name: 'read_file',
              arguments: '{"path":"notes.txt"}',
              status: 'completed',
              raw: {
                id: 'toolu_1',
                type: 'function',
                function: { name: 'read_file', arguments: '{"path":"notes.txt"}' },
                extra_content: {
                  anthropic: {
                    assistant_blocks: [
                      { type: 'redacted_thinking', data: 'opaque-redacted-thinking' },
                      { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'notes.txt' } },
                    ],
                  },
                },
              },
            }],
          },
          { id: 't1', role: 'tool', content: 'file contents', toolCallId: 'toolu_1', timestamp: now + 2 },
        ],
        thinkingLevel: 'high',
        temperature: 0.2,
      };

      await runOrchestrator(options, callbacks);

      const [apiMessages, streamOptions] = mockStreamMessage.mock.calls[0];
      const assistantReplay = apiMessages.find((message: any) => message.role === 'assistant');

      expect(assistantReplay).toEqual({
        role: 'assistant',
        content: [
          { type: 'redacted_thinking', data: 'opaque-redacted-thinking' },
          { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'notes.txt' } },
        ],
      });
      expect(streamOptions.toolChoice).toBeUndefined();
      expect(streamOptions.thinking).toEqual({ type: 'adaptive' });
      expect(streamOptions.output_config).toEqual({ effort: 'high' });
      expect(streamOptions.temperature).toBeUndefined();
    });

    it('continues monitoring after sessions_yield records a checkpoint', async () => {
      (executeTool as jest.Mock).mockResolvedValueOnce(JSON.stringify({ status: 'checkpointed', message: 'Waiting for workers' }));

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'tool_call', toolCall: { id: 'tc1', name: 'sessions_yield', arguments: '{}' } },
          { type: 'done', content: '' },
        ]),
      );
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Still monitoring workers.' },
          { type: 'done', content: 'Still monitoring workers.' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv1',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'msg1', role: 'user', content: 'Wait for the spawned agents', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      expect(callbacks.calls.onAssistantMessage[callbacks.calls.onAssistantMessage.length - 1]).toEqual({
        content: 'Still monitoring workers.',
        toolCalls: [],
        providerReplay: undefined,
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'complete',
        },
      });
      expect(callbacks.onDone).toHaveBeenCalled();
      expect(mockStreamMessage).toHaveBeenCalledTimes(2);
    });

    it('forces a final text-only turn after sessions_yield reports no running workers remain', async () => {
      (executeTool as jest.Mock).mockResolvedValueOnce(JSON.stringify({
        status: 'completed',
        message: 'Workers are finished',
        finalizeSupervisor: true,
        pendingSessions: [],
      }));

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'tool_call', toolCall: { id: 'tc1', name: 'sessions_yield', arguments: '{}' } },
          { type: 'done', content: '' },
        ]),
      );
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Final answer ready.' },
          { type: 'done', content: 'Final answer ready.' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv1',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'msg1', role: 'user', content: 'Wait for the spawned agents', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      expect(mockStreamMessage).toHaveBeenCalledTimes(2);
      expect(mockStreamMessage.mock.calls[1][1].tools).toBeUndefined();
      expect(callbacks.calls.onAssistantMessage[callbacks.calls.onAssistantMessage.length - 1]).toEqual({
        content: 'Final answer ready.',
        toolCalls: [],
        providerReplay: undefined,
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'complete',
        },
      });
      expect(callbacks.calls.onToolMessage[0]).toEqual(expect.objectContaining({
        result: expect.stringContaining('"finalizeSupervisor":true'),
      }));
    });

    it('should require another tool after a monitoring tool result', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'tool_call', toolCall: { id: 'tc1', name: 'tool_catalog', arguments: '{}' } },
          { type: 'done', content: '' },
        ]),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Still working' },
          { type: 'done', content: 'Still working' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv1',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'msg1', role: 'user', content: 'Find the right tools and continue', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      expect(mockStreamMessage.mock.calls[1][1]).toEqual(expect.objectContaining({ toolChoice: 'required' }));
    });

    it('should require another tool after sessions_spawn launches a worker', async () => {
      (executeTool as jest.Mock).mockResolvedValueOnce(JSON.stringify({
        status: 'running',
        sessionId: 'sub-1',
        guidance: 'Poll sessions_status until the session reaches a terminal state.',
      }));

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'tool_call', toolCall: { id: 'tc1', name: 'sessions_spawn', arguments: '{"prompt":"Research this"}' } },
          { type: 'done', content: '' },
        ]),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'tool_call', toolCall: { id: 'tc2', name: 'sessions_status', arguments: '{"sessionId":"sub-1"}' } },
          { type: 'done', content: '' },
        ]),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Worker completed successfully.' },
          { type: 'done', content: 'Worker completed successfully.' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv1',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'msg1', role: 'user', content: 'Create a worker, check its status until it finishes, and then report back.', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      expect(mockStreamMessage.mock.calls[1][1]).toEqual(expect.objectContaining({ toolChoice: 'required' }));
    });

    it('falls back to the active provider and model when a persona resolves to an unavailable provider', async () => {
      const registryModule = jest.requireMock('../../src/services/agents/registry') as {
        getPersona: jest.Mock;
      };
      const personasModule = jest.requireMock('../../src/services/agents/personas') as {
        resolvePersonaModel: jest.Mock;
      };

      registryModule.getPersona.mockReturnValueOnce({
        id: 'reviewer',
        name: 'Reviewer',
        systemPrompt: 'You are the Reviewer.',
      });
      personasModule.resolvePersonaModel.mockReturnValueOnce({
        providerId: 'missing-provider',
        model: 'claude-sonnet-4-6',
      });

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Validated.' },
          { type: 'done', content: 'Validated.' },
        ]));

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider({
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-5.4',
          availableModels: ['gpt-5.4', 'gpt-5.4-mini'],
        }),
        model: 'gpt-5.4-mini',
        conversationId: 'conv-persona-provider-fallback',
        systemPrompt: 'You are helpful',
        personaId: 'reviewer',
        messages: [{ id: 'msg1', role: 'user', content: 'Validate the current setup.', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      expect(mockStreamMessage).toHaveBeenCalledTimes(1);
      expect(mockStreamMessage.mock.calls[0][1]).toEqual(expect.objectContaining({ model: 'gpt-5.4-mini' }));
    });

    it('keeps session coordination tools out of trivial direct SuperAgent turns', async () => {
      const registryModule = jest.requireMock('../../src/services/agents/registry') as {
        getPersona: jest.Mock;
      };
      const skillsModule = jest.requireMock('../../src/services/skills/manager') as {
        getSkillToolDefinitions: jest.Mock;
      };

      registryModule.getPersona.mockReturnValueOnce({
        id: 'super-agent',
        name: 'SuperAgent',
        systemPrompt: 'You are the SuperAgent.',
      });
      skillsModule.getSkillToolDefinitions.mockReturnValueOnce([
        {
          name: 'weather_current',
          description: 'Get the current outdoor weather and temperature for a location.',
          input_schema: {
            type: 'object',
            properties: {
              location: { type: 'string' },
            },
            required: ['location'],
            additionalProperties: false,
          },
        },
      ]);

      (executeTool as jest.Mock).mockResolvedValueOnce('Cairo weather: 14 C and clear.');

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'tool_call', toolCall: { id: 'tc1', name: 'weather_current', arguments: '{"location":"Cairo"}' } },
          { type: 'done', content: '' },
        ]),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'It is about 14 C and clear in Cairo, so it is cool outside but not especially cold.' },
          { type: 'done', content: 'It is about 14 C and clear in Cairo, so it is cool outside but not especially cold.' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-super-agent-direct-weather',
        systemPrompt: 'You are helpful',
        personaId: 'super-agent',
        messages: [{ id: 'msg1', role: 'user', content: 'Is it cold outside in Cairo right now?', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      const firstTurnToolNames = mockStreamMessage.mock.calls[0][1].tools.map((tool: { name: string }) => tool.name);
      const systemPromptMessage = mockStreamMessage.mock.calls[0][0][0];
      expect(firstTurnToolNames.filter((name: string) => name.startsWith('sessions_'))).toEqual([]);
      expect(systemPromptMessage.content).not.toContain('Sessions / sub-agents:');
      expect(systemPromptMessage.content).toContain('The latest user request is a trivial direct lookup and should bypass the agentic workflow.');
      expect(callbacks.getVisibleTokenText()).toBe('It is about 14 C and clear in Cairo, so it is cool outside but not especially cold.');
      expect(callbacks.onDone).toHaveBeenCalled();
    });

    it('ignores internal resume control prompts when assessing the request and selecting tools', async () => {
      const registryModule = jest.requireMock('../../src/services/agents/registry') as {
        getPersona: jest.Mock;
      };
      const skillsModule = jest.requireMock('../../src/services/skills/manager') as {
        getSkillToolDefinitions: jest.Mock;
      };

      registryModule.getPersona.mockReturnValueOnce({
        id: 'super-agent',
        name: 'SuperAgent',
        systemPrompt: 'You are the SuperAgent.',
      });
      skillsModule.getSkillToolDefinitions.mockReturnValueOnce([
        {
          name: 'weather_current',
          description: 'Get the current outdoor weather and temperature for a location.',
          input_schema: {
            type: 'object',
            properties: {
              location: { type: 'string' },
            },
            required: ['location'],
            additionalProperties: false,
          },
        },
      ]);

      (executeTool as jest.Mock).mockResolvedValueOnce('Cairo weather: 14 C and clear.');

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'tool_call', toolCall: { id: 'tc1', name: 'weather_current', arguments: '{"location":"Cairo"}' } },
          { type: 'done', content: '' },
        ]),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'It is about 14 C and clear in Cairo, so it is cool outside but not especially cold.' },
          { type: 'done', content: 'It is about 14 C and clear in Cairo, so it is cool outside but not especially cold.' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-super-agent-resume-weather',
        systemPrompt: 'You are helpful',
        personaId: 'super-agent',
        internalUserMessageCount: 1,
        messages: [
          { id: 'msg1', role: 'user', content: 'Is it cold outside in Cairo right now?', timestamp: Date.now() - 10 },
          { id: 'msg2', role: 'assistant', content: 'Draft answer pending stronger verification.', timestamp: Date.now() - 5 },
          {
            id: 'msg3',
            role: 'user',
            content: 'Continue the already-visible answer. Close the pilot gaps using the verified findings. Do not restart the answer.',
            timestamp: Date.now(),
          },
        ],
      };

      await runOrchestrator(options, callbacks);

      const firstTurnToolNames = mockStreamMessage.mock.calls[0][1].tools.map((tool: { name: string }) => tool.name);
      const systemPromptMessage = mockStreamMessage.mock.calls[0][0][0];
      const requestedSkillsCalls = (getSkillSystemPrompts as jest.Mock).mock.calls as Array<[string, string]>;
      const [, requestedSkillsContext] = requestedSkillsCalls[requestedSkillsCalls.length - 1];
      expect(firstTurnToolNames.filter((name: string) => name.startsWith('sessions_'))).toEqual([]);
      expect(systemPromptMessage.content).toContain('The latest user request is a trivial direct lookup and should bypass the agentic workflow.');
      expect(requestedSkillsContext).toContain('Is it cold outside in Cairo right now?');
      expect(requestedSkillsContext).not.toContain('Continue the already-visible answer.');
    });

    it('ignores trailing internal slash control prompts during slash-command interception', async () => {
      const parserModule = jest.requireMock('../../src/services/commands/parser') as {
        isSlashCommand: jest.Mock;
        parseCommand: jest.Mock;
      };
      const builtinsModule = jest.requireMock('../../src/services/commands/builtins') as {
        getCommand: jest.Mock;
      };

      parserModule.isSlashCommand.mockImplementation((content: string) => content.startsWith('/'));
      parserModule.parseCommand.mockReturnValue({ name: 'status', args: '' });
      const slashHandler = jest.fn().mockResolvedValue({ response: 'slash result' });
      builtinsModule.getCommand.mockReturnValue({ handler: slashHandler });

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'normal assistant response' },
          { type: 'done', content: 'normal assistant response' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-ignore-internal-slash',
        systemPrompt: 'You are helpful',
        internalUserMessageCount: 1,
        messages: [
          { id: 'msg1', role: 'user', content: 'What is the current weather in Cairo?', timestamp: 1_000 },
          { id: 'msg2', role: 'assistant', content: 'Draft answer pending verification.', timestamp: 1_100 },
          { id: 'msg3', role: 'user', content: '/status', timestamp: 1_200 },
        ],
      };

      await runOrchestrator(options, callbacks);

      expect(slashHandler).not.toHaveBeenCalled();
      expect(mockStreamMessage).toHaveBeenCalledTimes(1);
      expect(callbacks.calls.onAssistantMessage[callbacks.calls.onAssistantMessage.length - 1]).toEqual(
        expect.objectContaining({
          content: 'normal assistant response',
          assistantMetadata: expect.objectContaining({
            kind: 'final',
            completionStatus: 'complete',
          }),
        }),
      );
    });

    it('uses a conservative scoped fallback when unified memory access is unavailable', async () => {
      const registryModule = jest.requireMock('../../src/services/agents/registry') as {
        getPersona: jest.Mock;
      };
      const skillsModule = jest.requireMock('../../src/services/skills/manager') as {
        getSkillToolDefinitions: jest.Mock;
      };

      registryModule.getPersona.mockReturnValueOnce({
        id: 'super-agent',
        name: 'SuperAgent',
        systemPrompt: 'You are the SuperAgent.',
      });
      skillsModule.getSkillToolDefinitions.mockReturnValueOnce([
        {
          name: 'weather_current',
          description: 'Get the current outdoor weather and temperature for a location.',
          input_schema: {
            type: 'object',
            properties: {
              location: { type: 'string' },
            },
            required: ['location'],
            additionalProperties: false,
          },
        },
      ]);

      const memoryAccessSpy = jest
        .spyOn(memoryAccessGateway, 'buildUnifiedMemoryAccessContext')
        .mockRejectedValueOnce(new Error('memory gateway unavailable'));

      (executeTool as jest.Mock).mockResolvedValueOnce('Cairo weather: 14 C and clear.');

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'tool_call', toolCall: { id: 'tc1', name: 'weather_current', arguments: '{"location":"Cairo"}' } },
          { type: 'done', content: '' },
        ]),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'It is about 14 C and clear in Cairo.' },
          { type: 'done', content: 'It is about 14 C and clear in Cairo.' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-super-agent-fallback-weather',
        systemPrompt: 'You are helpful',
        personaId: 'super-agent',
        internalUserMessageCount: 1,
        messages: [
          {
            id: 'msg1',
            role: 'user',
            content: 'Design a full architecture rewrite plan for the app.',
            timestamp: 1_000,
          },
          {
            id: 'msg2',
            role: 'assistant',
            content: 'Here is the architecture plan draft.',
            timestamp: 2_000,
          },
          {
            id: 'msg3',
            role: 'user',
            content: 'Is it cold outside in Cairo right now?',
            timestamp: 30_000_000,
          },
          {
            id: 'msg4',
            role: 'assistant',
            content: 'Draft answer pending stronger verification.',
            timestamp: 30_000_001,
          },
          {
            id: 'msg5',
            role: 'user',
            content: 'Continue the already-visible answer. Close pilot gaps without restarting.',
            timestamp: 30_000_002,
          },
        ],
      };

      try {
        await runOrchestrator(options, callbacks);
      } finally {
        memoryAccessSpy.mockRestore();
      }

      const systemPromptMessage = mockStreamMessage.mock.calls[0][0][0];
      const requestedSkillsCalls = (getSkillSystemPrompts as jest.Mock).mock.calls as Array<[string, string]>;
      const [, requestedSkillsContext] = requestedSkillsCalls[requestedSkillsCalls.length - 1];

      expect(systemPromptMessage.content).toContain(
        'The latest user request is a trivial direct lookup and should bypass the agentic workflow.',
      );
      expect(requestedSkillsContext).toContain('Is it cold outside in Cairo right now?');
      expect(requestedSkillsContext).not.toContain('Continue the already-visible answer.');
    });

    it('allows SuperAgent to finalize a non-trivial solo-tool run when no delegated worker was requested', async () => {
      const registryModule = jest.requireMock('../../src/services/agents/registry') as {
        getPersona: jest.Mock;
      };
      registryModule.getPersona.mockReturnValueOnce({
        id: 'super-agent',
        name: 'SuperAgent',
        systemPrompt: 'You are the SuperAgent.',
      });

      (executeTool as jest.Mock)
        .mockResolvedValueOnce('file contents');

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'tool_call', toolCall: { id: 'tc1', name: 'read_file', arguments: '{"path":"src/App.tsx"}' } },
          { type: 'done', content: '' },
        ]),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'I already have enough to answer directly.' },
          { type: 'done', content: 'I already have enough to answer directly.' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-super-agent-delegation',
        systemPrompt: 'You are helpful',
        personaId: 'super-agent',
        messages: [{ id: 'msg1', role: 'user', content: 'Inspect src/App.tsx, verify the issue, and report back.', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      expect(mockStreamMessage).toHaveBeenCalledTimes(2);
      expect(callbacks.calls.onAssistantMessage[callbacks.calls.onAssistantMessage.length - 1]).toEqual({
        content: 'I already have enough to answer directly.',
        toolCalls: [],
        providerReplay: undefined,
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'complete',
        },
      });
    });

    it('injects super-agent guidance that sessions_wait already includes session output', async () => {
      const registryModule = jest.requireMock('../../src/services/agents/registry') as {
        getPersona: jest.Mock;
      };
      registryModule.getPersona.mockReturnValueOnce({
        id: 'super-agent',
        name: 'SuperAgent',
        systemPrompt: 'You are the SuperAgent.',
      });

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Planning the workflow.' },
          { type: 'done', content: 'Planning the workflow.' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-super-agent-wait-guidance',
        systemPrompt: 'You are helpful',
        personaId: 'super-agent',
        messages: [{
          id: 'msg1',
          role: 'user',
          content: 'Coordinate workers to inspect the repository and synthesize the result.',
          timestamp: Date.now(),
        }],
      };

      await runOrchestrator(options, callbacks);

      const systemPromptMessage = mockStreamMessage.mock.calls[0][0][0];
      expect(systemPromptMessage.content).toContain(
        'After sessions_wait returns completed sessions, use the outputs already in that result and do not call sessions_output immediately afterward unless you need to recall a terminal deliverable later.',
      );
    });

    it('forces SuperAgent to relaunch delegation when sessions_spawn failed before any worker actually started', async () => {
      const registryModule = jest.requireMock('../../src/services/agents/registry') as {
        getPersona: jest.Mock;
      };
      registryModule.getPersona.mockReturnValueOnce({
        id: 'super-agent',
        name: 'SuperAgent',
        systemPrompt: 'You are the SuperAgent.',
      });

      (executeTool as jest.Mock)
        .mockResolvedValueOnce(JSON.stringify({
          status: 'error',
          error: 'Worker launch failed.',
        }))
        .mockResolvedValueOnce(JSON.stringify({
          status: 'completed',
          sessionId: 'sub-2',
          outputPreview: 'Worker verified the fix.',
        }));

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'tool_call', toolCall: { id: 'tc1', name: 'sessions_spawn', arguments: '{"prompt":"Verify the fix"}' } },
          { type: 'done', content: '' },
        ]),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'I can answer anyway.' },
          { type: 'done', content: 'I can answer anyway.' },
        ]),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'tool_call', toolCall: { id: 'tc2', name: 'sessions_spawn', arguments: '{"prompt":"Retry the worker verification"}' } },
          { type: 'done', content: '' },
        ]),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Answer after a real worker launch.' },
          { type: 'done', content: 'Answer after a real worker launch.' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-super-agent-retry-delegation',
        systemPrompt: 'You are helpful',
        personaId: 'super-agent',
        messages: [{ id: 'msg1', role: 'user', content: 'Verify the issue with a worker and then report back.', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      expect(mockStreamMessage).toHaveBeenCalledTimes(4);
      expect(mockStreamMessage.mock.calls[2][1]).toEqual(expect.objectContaining({ toolChoice: 'required' }));
      expect(
        callbacks.calls.onAssistantMessage.some((message) => message.content === 'I can answer anyway.'),
      ).toBe(false);
      expect(callbacks.calls.onAssistantMessage[callbacks.calls.onAssistantMessage.length - 1]).toEqual({
        content: 'Answer after a real worker launch.',
        toolCalls: [],
        providerReplay: undefined,
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'complete',
        },
      });
    });

    it('does not accept a final answer while tracked background sessions are still running', async () => {
      (executeTool as jest.Mock)
        .mockResolvedValueOnce(JSON.stringify({
          status: 'running',
          sessionId: 'sub-1',
          guidance: 'Poll sessions_status until the session reaches a terminal state.',
        }))
        .mockResolvedValueOnce(JSON.stringify({
          sessionId: 'sub-1',
          status: 'completed',
          outputPreview: 'Worker finished the repository audit.',
        }));

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'tool_call', toolCall: { id: 'tc1', name: 'sessions_spawn', arguments: '{"prompt":"Research this"}' } },
          { type: 'done', content: '' },
        ]),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'I can answer now.' },
          { type: 'done', content: 'I can answer now.' },
        ]),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'tool_call', toolCall: { id: 'tc2', name: 'sessions_status', arguments: '{"sessionId":"sub-1"}' } },
          { type: 'done', content: '' },
        ]),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Worker completed successfully.' },
          { type: 'done', content: 'Worker completed successfully.' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-background-join',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'msg1', role: 'user', content: 'Launch a worker and wait for it to finish.', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      expect(mockStreamMessage).toHaveBeenCalledTimes(4);
      expect(mockStreamMessage.mock.calls[2][1]).toEqual(expect.objectContaining({ toolChoice: 'required' }));
      expect(
        mockStreamMessage.mock.calls[2][1].tools.map((tool: { name: string }) => tool.name).sort(),
      ).toEqual(['sessions_cancel', 'sessions_status', 'sessions_wait']);
      expect(
        callbacks.calls.onAssistantMessage.some(
          (message) => message.assistantMetadata?.finishReason === 'background_workers_running',
        ),
      ).toBe(false);
      expect(callbacks.calls.onAssistantMessage[callbacks.calls.onAssistantMessage.length - 1]).toEqual({
        content: 'Worker completed successfully.',
        toolCalls: [],
        providerReplay: undefined,
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'complete',
        },
      });
      expect(executeTool).toHaveBeenCalledTimes(2);
      expect(callbacks.onDone).toHaveBeenCalled();
    });

    it('does not inject loop warnings for expected sessions_status plus sessions_wait monitoring', async () => {
      const runningStatus = JSON.stringify({
        sessionId: 'sub-1',
        status: 'running',
        currentActivity: 'Auditing repository',
        recommendedWaitMs: 5000,
        hasNewActivity: false,
      });
      const waitResult = JSON.stringify({
        status: 'running',
        sessionIds: ['sub-1'],
        sessionCount: 1,
        completedCount: 0,
        pendingCount: 1,
        sessions: [{
          sessionId: 'sub-1',
          status: 'running',
          currentActivity: 'Auditing repository',
          recommendedWaitMs: 5000,
          hasNewActivity: false,
        }],
        pendingSessions: [{
          sessionId: 'sub-1',
          status: 'running',
          currentActivity: 'Auditing repository',
          recommendedWaitMs: 5000,
          hasNewActivity: false,
        }],
      });

      (executeTool as jest.Mock)
        .mockResolvedValueOnce(JSON.stringify({
          status: 'running',
          sessionId: 'sub-1',
          guidance: 'Poll sessions_status until the session reaches a terminal state.',
        }))
        .mockResolvedValueOnce(runningStatus)
        .mockResolvedValueOnce(waitResult)
        .mockResolvedValueOnce(runningStatus)
        .mockResolvedValueOnce(JSON.stringify({
          sessionId: 'sub-1',
          status: 'completed',
          outputPreview: 'Worker finished the repository audit.',
        }));

      mockStreamMessage
        .mockImplementationOnce(() =>
          createStreamGenerator([
            { type: 'tool_call', toolCall: { id: 'tc1', name: 'sessions_spawn', arguments: '{"prompt":"Research this"}' } },
            { type: 'done', content: '' },
          ]),
        )
        .mockImplementationOnce(() =>
          createStreamGenerator([
            { type: 'tool_call', toolCall: { id: 'tc2', name: 'sessions_status', arguments: '{"sessionId":"sub-1"}' } },
            { type: 'done', content: '' },
          ]),
        )
        .mockImplementationOnce(() =>
          createStreamGenerator([
            { type: 'tool_call', toolCall: { id: 'tc3', name: 'sessions_wait', arguments: '{"sessionId":"sub-1","waitTimeoutMs":5000}' } },
            { type: 'done', content: '' },
          ]),
        )
        .mockImplementationOnce(() =>
          createStreamGenerator([
            { type: 'tool_call', toolCall: { id: 'tc4', name: 'sessions_status', arguments: '{"sessionId":"sub-1"}' } },
            { type: 'done', content: '' },
          ]),
        )
        .mockImplementationOnce(() =>
          createStreamGenerator([
            { type: 'tool_call', toolCall: { id: 'tc5', name: 'sessions_status', arguments: '{"sessionId":"sub-1"}' } },
            { type: 'done', content: '' },
          ]),
        )
        .mockImplementationOnce(() =>
          createStreamGenerator([
            { type: 'token', content: 'Worker completed successfully.' },
            { type: 'done', content: 'Worker completed successfully.' },
          ]),
        );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-monitor-loop-guard',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'msg1', role: 'user', content: 'Launch a worker and monitor it until it finishes.', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      expect(mockStreamMessage).toHaveBeenCalledTimes(6);
      for (const [apiMessages] of mockStreamMessage.mock.calls) {
        expect(
          (apiMessages as Array<{ role: string; content?: string }>).some(
            (message) => message.role === 'system'
              && typeof message.content === 'string'
              && message.content.startsWith('[SYSTEM WARNING'),
          ),
        ).toBe(false);
      }
      expect(callbacks.calls.onAssistantMessage[callbacks.calls.onAssistantMessage.length - 1]).toEqual({
        content: 'Worker completed successfully.',
        toolCalls: [],
        providerReplay: undefined,
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'complete',
        },
      });
      expect(callbacks.onDone).toHaveBeenCalled();
    });

    it('restricts pending expo workflows to workflow monitoring tools until the run is terminal', async () => {
      (executeTool as jest.Mock)
        .mockResolvedValueOnce(JSON.stringify({
          projectId: 'proj-1',
          projectName: 'Kavi',
          mode: 'github-workflow',
          workflowRun: {
            id: 101,
            status: 'queued',
            conclusion: null,
          },
        }))
        .mockResolvedValueOnce(JSON.stringify({
          projectId: 'proj-1',
          projectName: 'Kavi',
          mode: 'github-workflow',
          workflowRun: {
            id: 101,
            status: 'completed',
            conclusion: 'success',
          },
        }));

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'tool_call', toolCall: { id: 'tc1', name: 'expo_eas_build', arguments: '{"projectId":"proj-1"}' } },
          { type: 'done', content: '' },
        ]),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'The build is queued, I can summarize now.' },
          { type: 'done', content: 'The build is queued, I can summarize now.' },
        ]),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'tool_call', toolCall: { id: 'tc2', name: 'expo_eas_workflow_wait', arguments: '{"projectId":"proj-1","workflowRunId":"101"}' } },
          { type: 'done', content: '' },
        ]),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'The build finished successfully.' },
          { type: 'done', content: 'The build finished successfully.' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-expo-workflow',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'msg1', role: 'user', content: 'Start a build and wait until it finishes.', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      expect(mockStreamMessage).toHaveBeenCalledTimes(4);
      expect(mockStreamMessage.mock.calls[2][1]).toEqual(expect.objectContaining({ toolChoice: 'required' }));
      expect(
        mockStreamMessage.mock.calls[2][1].tools.map((tool: { name: string }) => tool.name).sort(),
      ).toEqual(['expo_eas_workflow_status', 'expo_eas_workflow_wait']);
      expect(
        callbacks.calls.onAssistantMessage.some(
          (message) => message.assistantMetadata?.finishReason === 'background_workers_running',
        ),
      ).toBe(false);
      expect(callbacks.calls.onAssistantMessage[callbacks.calls.onAssistantMessage.length - 1]).toEqual({
        content: 'The build finished successfully.',
        toolCalls: [],
        providerReplay: undefined,
        assistantMetadata: {
          kind: 'final',
          completionStatus: 'complete',
        },
      });
    });

    it('loads discovered category tools on the turn after tool_catalog', async () => {
      (executeTool as jest.Mock).mockResolvedValueOnce(JSON.stringify({
        category: 'browser',
        tools: [
          { name: 'browser_navigate', description: 'Navigate browser pages.' },
          { name: 'browser_snapshot', description: 'Inspect browser state.' },
        ],
      }));

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'tool_call', toolCall: { id: 'tc1', name: 'tool_catalog', arguments: '{"category":"browser"}' } },
          { type: 'done', content: '' },
        ]),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Using browser tools now' },
          { type: 'done', content: 'Using browser tools now' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv1',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'msg1', role: 'user', content: 'Inspect the available capabilities and continue with the discovered option.', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      const firstTurnTools = new Set((mockStreamMessage.mock.calls[0][1].tools || []).map((tool: any) => tool.name));
      const secondTurnTools = new Set((mockStreamMessage.mock.calls[1][1].tools || []).map((tool: any) => tool.name));

      expect(firstTurnTools.has('browser_navigate')).toBe(false);
      expect(secondTurnTools.has('browser_navigate')).toBe(true);
      expect(secondTurnTools.has('browser_snapshot')).toBe(true);
      expect(secondTurnTools.has('browser_click')).toBe(false);
    });

    it('builds a Gemini-focused tool set and descriptive system prompt for investigation requests', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Investigating' },
          { type: 'done', content: 'Investigating' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider({
          id: 'gemini',
          name: 'Gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
          model: 'gemini-2.5-pro',
        }),
        model: 'gemini-2.5-pro',
        conversationId: 'conv1',
        systemPrompt: 'You are helpful',
        messages: [{
          id: 'msg1',
          role: 'user',
          content: 'Investigate the repo issue, compare with official docs online, and propose a fix.',
          timestamp: Date.now(),
        }],
      };

      await runOrchestrator(options, callbacks);

      const streamOptions = mockStreamMessage.mock.calls[0][1];
      const selectedToolNames = new Set((streamOptions.tools || []).map((tool: any) => tool.name));
      expect(selectedToolNames.has('glob_search')).toBe(true);
      expect(selectedToolNames.has('text_search')).toBe(true);
      expect(selectedToolNames.has('web_search')).toBe(true);
      expect(selectedToolNames.has('web_fetch')).toBe(true);
      expect(selectedToolNames.has('python')).toBe(true);
      expect(selectedToolNames.has('tool_catalog')).toBe(true);
      expect(selectedToolNames.has('read_memory')).toBe(false);

      const systemPromptMessage = mockStreamMessage.mock.calls[0][0][0];
      expect(systemPromptMessage).toMatchObject({ role: 'system' });
      expect(systemPromptMessage.content).toContain('- read_file:');
      expect(systemPromptMessage.content).toContain('Loaded callable tool names by category (complete):');
      expect(systemPromptMessage.content).toContain('Code / computation: python');
      expect(systemPromptMessage.content).toContain('Web research: web_search, web_fetch');
      expect(systemPromptMessage.content).toContain('Likely tool_catalog categories for this request');
      expect(systemPromptMessage.content).toContain('files (repo search/read/edit)');
      expect(systemPromptMessage.content).toContain('web (online docs/research)');
      expect(systemPromptMessage.content).toContain('This model works best with a narrow active tool set.');
    });

    it('carries recent Gemini workflow tools into vague follow-up turns', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Retrying' },
          { type: 'done', content: 'Retrying' },
        ]),
      );

      const callbacks = makeCallbacks();
      const now = Date.now();
      const options: OrchestratorOptions = {
        provider: makeProvider({
          id: 'gemini',
          name: 'Gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
          model: 'gemini-2.5-pro',
        }),
        model: 'gemini-2.5-pro',
        conversationId: 'conv-gemini-follow-up',
        systemPrompt: 'You are helpful',
        messages: [
          {
            id: 'u1',
            role: 'user',
            content: 'Compare our implementation against the official documentation for this exact issue.',
            timestamp: now,
          },
          {
            id: 'a1',
            role: 'assistant',
            content: '',
            timestamp: now + 1,
            toolCalls: [
              {
                id: 'tc1',
                name: 'web_fetch',
                arguments: '{"url":"https://ai.google.dev/gemini-api/docs/function-calling"}',
                status: 'completed',
              },
            ],
          },
          {
            id: 'u2',
            role: 'user',
            content: 'Try comparing the official docs again',
            timestamp: now + 2,
          },
        ],
      };

      await runOrchestrator(options, callbacks);

      const streamOptions = mockStreamMessage.mock.calls[0][1];
      const selectedToolNames = new Set((streamOptions.tools || []).map((tool: any) => tool.name));

      expect(
        selectedToolNames.has('web_fetch') || selectedToolNames.has('web_search'),
      ).toBe(true);
    });

    it('surfaces code-category guidance and loads python for explicit Python execution requests', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Parsing with Python' },
          { type: 'done', content: 'Parsing with Python' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider({
          id: 'gemini',
          name: 'Gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
          model: 'gemini-2.5-pro',
        }),
        model: 'gemini-2.5-pro',
        conversationId: 'conv1',
        systemPrompt: 'You are helpful',
        messages: [{
          id: 'msg1',
          role: 'user',
          content: 'Run a Python script to parse this JSON and summarize the result.',
          timestamp: Date.now(),
        }],
      };

      await runOrchestrator(options, callbacks);

      const streamOptions = mockStreamMessage.mock.calls[0][1];
      const selectedToolNames = new Set((streamOptions.tools || []).map((tool: any) => tool.name));
      expect(selectedToolNames.has('python')).toBe(true);
      expect(selectedToolNames.has('javascript')).toBe(true);

      const systemPromptMessage = mockStreamMessage.mock.calls[0][0][0];
      expect(systemPromptMessage.content).toContain('code (computation and transformation)');
    });

    it('adds timing metadata to running tool calls', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'tool_call', toolCall: { id: 'tc1', name: 'read_file', arguments: '{"path":"test.txt"}' } },
          { type: 'done', content: '' },
        ]),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Done' },
          { type: 'done', content: 'Done' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv1',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'msg1', role: 'user', content: 'Read the file', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      expect(callbacks.calls.onToolCallStart[0]).toEqual(expect.objectContaining({
        startedAt: expect.any(Number),
        updatedAt: expect.any(Number),
      }));
      expect(callbacks.calls.onToolCallComplete[0]).toEqual(expect.objectContaining({
        completedAt: expect.any(Number),
        updatedAt: expect.any(Number),
      }));
    });
  });

  describe('Loop detection', () => {
    it('should stop on repeated identical tool calls', async () => {
      const toolCallEvent = {
        type: 'tool_call',
        toolCall: { id: 'tc', name: 'read_file', arguments: '{"path":"same.txt"}' },
      };

      // Need enough iterations to trigger critical-level loop detection (CRITICAL_THRESHOLD=15).
      // Each iteration produces one tool call entry in the history.
      // After CRITICAL_THRESHOLD entries, detectLoops returns critical → hard stop.
      for (let i = 0; i < 20; i++) {
        mockStreamMessage.mockImplementationOnce(() =>
          createStreamGenerator([
            { type: 'token', content: '' },
            toolCallEvent,
            { type: 'done', content: '' },
          ]),
        );
      }

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv1',
        systemPrompt: 'sys',
        messages: [{ id: 'msg1', role: 'user', content: 'Test', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      // Should have stopped after detecting the loop (critical level)
      expect(callbacks.onDone).toHaveBeenCalled();
      expect(callbacks.onStateChange).toHaveBeenCalledWith('idle');
    });

    it('should stop repeated expo project discovery after a few identical results', async () => {
      const toolCallEvent = {
        type: 'tool_call',
        toolCall: { id: 'tc', name: 'expo_eas_list_projects', arguments: '{}' },
      };

      for (let i = 0; i < 6; i++) {
        mockStreamMessage.mockImplementationOnce(() =>
          createStreamGenerator([
            { type: 'token', content: '' },
            toolCallEvent,
            { type: 'done', content: '' },
          ]),
        );
      }

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv1',
        systemPrompt: 'sys',
        messages: [{ id: 'msg1', role: 'user', content: 'Inspect Expo projects and continue', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      expect(executeTool).toHaveBeenCalledTimes(3);
      expect(callbacks.onDone).toHaveBeenCalled();
      expect(callbacks.onStateChange).toHaveBeenCalledWith('idle');
    });

    it('should stop repeated tool_catalog discovery after a few identical category results', async () => {
      (executeTool as jest.Mock).mockResolvedValue(JSON.stringify({
        mode: 'category',
        category: 'browser',
        tools: [{ name: 'browser_navigate', description: 'Navigate browser pages.' }],
        activation: {
          callableNextTurn: true,
          recommendedToolNames: ['browser_navigate'],
          category: 'browser',
        },
      }));

      const toolCallEvent = {
        type: 'tool_call',
        toolCall: { id: 'tc', name: 'tool_catalog', arguments: '{"category":"browser"}' },
      };

      for (let i = 0; i < 6; i++) {
        mockStreamMessage.mockImplementationOnce(() =>
          createStreamGenerator([
            { type: 'token', content: '' },
            toolCallEvent,
            { type: 'done', content: '' },
          ]),
        );
      }

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-tool-catalog-loop',
        systemPrompt: 'sys',
        messages: [{ id: 'msg1', role: 'user', content: 'Find the right browser capability and continue', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      expect(executeTool).toHaveBeenCalledTimes(3);
      expect(callbacks.onDone).toHaveBeenCalled();
      expect(callbacks.onStateChange).toHaveBeenCalledWith('idle');
    });
  });

  describe('Reasoning tokens', () => {
    it('should pass through reasoning tokens', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'reasoning', content: 'Let me think...' },
          { type: 'token', content: 'Answer' },
          { type: 'done', content: 'Answer' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv1',
        systemPrompt: 'sys',
        messages: [{ id: 'msg1', role: 'user', content: 'Think', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      expect(callbacks.onReasoning).toHaveBeenCalledWith('Let me think...');
    });
  });

  describe('Memory loading', () => {
    it('does not inject legacy file memory and delegates to the canonical memory bridge', async () => {
      (getConversationMemoryForSystemPrompt as jest.Mock).mockResolvedValueOnce('User is named John');

      mockStreamMessage.mockImplementationOnce((...args: any[]) => {
        return createStreamGenerator([
          { type: 'token', content: 'Hi John!' },
          { type: 'done', content: 'Hi John!' },
        ]);
      });

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv1',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'msg1', role: 'user', content: 'Hello', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      expect(getConversationMemoryForSystemPrompt).not.toHaveBeenCalled();
      expect(buildLivingMemorySections).toHaveBeenCalledWith(expect.objectContaining({
        conversationId: 'conv1',
        messages: expect.any(Array),
      }));
      const apiMessages = mockStreamMessage.mock.calls[0]?.[0] as Array<{ role: string; content: string }>;
      expect(apiMessages[0]?.content).toContain('## Memory Scopes');
      expect(apiMessages[0]?.content).not.toContain('<conversation_memory>');
      expect(apiMessages[0]?.content).not.toContain('User is named John');
      expect(callbacks.onDone).toHaveBeenCalled();
    });

    it('uses the shared workspace conversation id for canonical memory recall', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Shared memory works' },
          { type: 'done', content: 'Shared memory works' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'worker-session-1',
        workspaceConversationId: 'parent-conv-7',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'msg1', role: 'user', content: 'Hello', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      expect(getConversationMemoryForSystemPrompt).not.toHaveBeenCalled();
      expect(buildLivingMemorySections).toHaveBeenCalledWith(expect.objectContaining({
        conversationId: 'parent-conv-7',
      }));
    });

    it('uses an economy model on tool-follow-up iterations when explicitly allowed', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'tool_call', toolCall: { id: 'tc1', name: 'read_file', arguments: '{"path":"test.txt"}' } },
          { type: 'done', content: '' },
        ]),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Finished' },
          { type: 'done', content: 'Finished' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider({ availableModels: ['gpt-5.4', 'gpt-5.4-mini'] }),
        model: 'gpt-5.4',
        allowModelDowngrade: true,
        conversationId: 'conv-economy',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'msg1', role: 'user', content: 'Read file', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      expect(mockStreamMessage.mock.calls[1][1].model).toBe('gpt-5.4-mini');
      expect(mockStreamMessage.mock.calls[1][1].maxTokens).toBeLessThanOrEqual(8192);
    });
  });

  describe('Skill system prompt injection', () => {
    it('should include skill prompts in the system prompt sent to LLM', async () => {
      (getSkillSystemPrompts as jest.Mock).mockResolvedValueOnce(
        '<available_skills>\n  <skill>\n    <name>Weather</name>\n    <description>Check weather for user.</description>\n    <location>skills/managed/weather/SKILL.md</location>\n  </skill>\n</available_skills>',
      );

      mockStreamMessage.mockImplementationOnce((...args: any[]) => {
        // Capture the system prompt passed to the LLM
        return createStreamGenerator([
          { type: 'token', content: 'OK' },
          { type: 'done', content: 'OK' },
        ]);
      });

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv1',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'msg1', role: 'user', content: 'Weather?', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      // Verify LLM was called with system prompt containing skill content
      expect(mockStreamMessage).toHaveBeenCalled();
      const callArgs = mockStreamMessage.mock.calls[0];
      const systemPromptSent = callArgs[0].systemPrompt || callArgs[0];
      // Could be passed positionally or as an options object
      const allArgs = JSON.stringify(callArgs);
      expect(allArgs).toContain('<available_skills>');
      expect(allArgs).toContain('Weather');
      expect(callbacks.onDone).toHaveBeenCalled();
    });
  });

  describe('Canvas workflow guidance', () => {
    it('includes session-first canvas tool policy in the system prompt sent to the LLM', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'OK' },
          { type: 'done', content: 'OK' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv1',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'msg1', role: 'user', content: 'Build a canvas prototype', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      const apiMessages = mockStreamMessage.mock.calls[0][0];
      expect(apiMessages[0].role).toBe('system');
      expect(apiMessages[0].content).toContain('## Tool Call Style');
      expect(apiMessages[0].content).toContain('canvas_list');
      expect(apiMessages[0].content).toContain('canvas_read');
      expect(apiMessages[0].content).toContain('contentEdits');
      expect(apiMessages[0].content).toContain('componentOperations');
      expect(apiMessages[0].content).toContain('canvas');
    });

    it('guides existing file edits toward file_edit instead of whole-file rewrites', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'OK' },
          { type: 'done', content: 'OK' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-file-edit-guidance',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'msg1', role: 'user', content: 'Update an existing source file', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      const apiMessages = mockStreamMessage.mock.calls[0][0];
      expect(apiMessages[0].content).toContain('prefer file_edit with ordered focused edits');
      expect(apiMessages[0].content).toContain('write_file');
    });

    it('discourages canvases and files for ordinary Q&A in the system prompt', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'OK' },
          { type: 'done', content: 'OK' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-direct-answer',
        systemPrompt: 'You are helpful',
        messages: [{ id: 'msg1', role: 'user', content: 'Explain closures in JavaScript', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      const apiMessages = mockStreamMessage.mock.calls[0][0];
      expect(apiMessages[0].content).toContain('For normal Q&A, explanations, brainstorming, or summaries, answer directly.');
      expect(apiMessages[0].content).toContain('Do not create a canvas for ordinary conversational answers');
    });
  });

  describe('Expo workflow guidance', () => {
    it('injects repo-first Expo workflow guidance when Expo tools are relevant', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'OK' },
          { type: 'done', content: 'OK' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv-expo',
        systemPrompt: 'You are helpful',
        messages: [{
          id: 'msg1',
          role: 'user',
          content: 'Deploy this Expo app from the GitHub repo and monitor the EAS workflow',
          timestamp: Date.now(),
        }],
      };

      await runOrchestrator(options, callbacks);

      const apiMessages = mockStreamMessage.mock.calls[0][0];
      expect(apiMessages[0].content).toContain('## Expo / EAS');
      expect(apiMessages[0].content).toContain('default to repository-driven EAS Workflows');
      expect(apiMessages[0].content).toContain('.eas/workflows/deploy.yml');
      expect(apiMessages[0].content).toContain('push a commit');
      expect(apiMessages[0].content).toContain('Reserve expo_eas_build, expo_eas_update, expo_eas_submit, and expo_eas_deploy_web for explicit manual reruns');
    });
  });

  describe('Cancellation', () => {
    it('should handle abort signal', async () => {
      const abortController = new AbortController();

      mockStreamMessage.mockImplementationOnce(async function* () {
        yield { type: 'token', content: 'Start' };
        abortController.abort();
        yield { type: 'token', content: ' end' };
        yield { type: 'done', content: 'Start end' };
      });

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv1',
        systemPrompt: 'sys',
        messages: [{ id: 'msg1', role: 'user', content: 'test', timestamp: Date.now() }],
        signal: abortController,
      };

      await runOrchestrator(options, callbacks);

      expect(callbacks.onStateChange).toHaveBeenCalledWith('idle');
      expect(callbacks.onDone).toHaveBeenCalled();
    });
  });

  describe('Error handling', () => {
    it('should handle stream errors', async () => {
      mockStreamMessage.mockImplementationOnce(async function* () {
        throw new Error('API rate limited');
      });

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv1',
        systemPrompt: 'sys',
        messages: [{ id: 'msg1', role: 'user', content: 'test', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      expect(callbacks.onStateChange).toHaveBeenCalledWith('error');
      expect(callbacks.onError).toHaveBeenCalled();
      expect(callbacks.calls.onError[0].message).toBe('API rate limited');
    });

    it('does not fail over on authentication errors', async () => {
      mockStreamMessage.mockImplementationOnce(async function* () {
        throw new Error('LLM API error 401: Unauthorized');
      });

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv1',
        systemPrompt: 'sys',
        messages: [{ id: 'msg1', role: 'user', content: 'test', timestamp: Date.now() }],
        allProviders: [makeProvider(), makeProvider({ id: 'backup', apiKey: '' })],
      };

      await runOrchestrator(options, callbacks);

      expect(mockStreamMessage).toHaveBeenCalledTimes(1);
      expect(callbacks.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'LLM API error 401: Unauthorized' }));
    });

    it('handles non-Error thrown values (string) in stream', async () => {
      mockStreamMessage.mockImplementationOnce(async function* () {
        throw 'raw string failure';
      });

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv1',
        systemPrompt: 'sys',
        messages: [{ id: 'msg1', role: 'user', content: 'test', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      expect(callbacks.onStateChange).toHaveBeenCalledWith('error');
      expect(callbacks.onError).toHaveBeenCalled();
      // onError receives an Error object wrapping the string
      expect(callbacks.calls.onError[0]).toBeInstanceOf(Error);
      expect(callbacks.calls.onError[0].message).toBe('raw string failure');
    });

    it('handles non-Error thrown values (number) in stream', async () => {
      mockStreamMessage.mockImplementationOnce(async function* () {
        throw 42;
      });

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv1',
        systemPrompt: 'sys',
        messages: [{ id: 'msg1', role: 'user', content: 'test', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      expect(callbacks.onStateChange).toHaveBeenCalledWith('error');
      expect(callbacks.onError).toHaveBeenCalled();
      expect(callbacks.calls.onError[0]).toBeInstanceOf(Error);
      expect(callbacks.calls.onError[0].message).toBe('42');
    });

    it('handles non-Error thrown values in tool execution', async () => {
      (executeTool as jest.Mock).mockRejectedValueOnce('tool string error');

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'tool_call', toolCall: { id: 'tc1', name: 'read_file', arguments: '{}' } },
          { type: 'done', content: '' },
        ]),
      );

      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Recovered' },
          { type: 'done', content: 'Recovered' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv1',
        systemPrompt: 'sys',
        messages: [{ id: 'msg1', role: 'user', content: 'Read', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      const completedCall = callbacks.calls.onToolCallComplete[0];
      expect(completedCall.status).toBe('failed');
      expect(completedCall.error).toBe('tool string error');
      expect(callbacks.onDone).toHaveBeenCalled();
    });

  });

  describe('Usage tracking', () => {
    it('should report token usage', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Response' },
          { type: 'usage', usage: { inputTokens: 100, outputTokens: 50 } },
          { type: 'done', content: 'Response' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv1',
        systemPrompt: 'sys',
        messages: [{ id: 'msg1', role: 'user', content: 'test', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      expect(callbacks.onUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          inputTokens: 100,
          outputTokens: 50,
          model: 'gpt-5.4',
        }),
      );
    });

    it('should synthesize usage when the provider omits usage metadata', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'token', content: 'Fallback response' },
          { type: 'done', content: 'Fallback response' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv1',
        systemPrompt: 'sys',
        messages: [{ id: 'msg1', role: 'user', content: 'estimate this turn', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      expect(callbacks.onUsage).toHaveBeenCalledTimes(1);
      expect(callbacks.onUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-5.4',
        }),
      );

      const [usage] = callbacks.calls.onUsage;
      expect(usage.inputTokens).toBeGreaterThan(0);
      expect(usage.outputTokens).toBeGreaterThan(0);
    });

    it('should collapse multiple usage snapshots into one final report', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'usage', usage: { inputTokens: 100, outputTokens: 0 } },
          { type: 'token', content: 'Response' },
          { type: 'usage', usage: { inputTokens: 100, outputTokens: 50 } },
          { type: 'done', content: 'Response' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gpt-5.4',
        conversationId: 'conv1',
        systemPrompt: 'sys',
        messages: [{ id: 'msg1', role: 'user', content: 'test', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      expect(callbacks.onUsage).toHaveBeenCalledTimes(1);
      expect(callbacks.onUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          inputTokens: 100,
          outputTokens: 50,
          model: 'gpt-5.4',
        }),
      );
    });

    it('should preserve cached Gemini input usage across cumulative snapshots', async () => {
      mockStreamMessage.mockImplementationOnce(() =>
        createStreamGenerator([
          { type: 'usage', usage: { inputTokens: 180, outputTokens: 0, cacheReadTokens: 90 } },
          { type: 'token', content: 'Response' },
          { type: 'usage', usage: { inputTokens: 180, outputTokens: 36, cacheReadTokens: 120, totalTokens: 216 } },
          { type: 'done', content: 'Response' },
        ]),
      );

      const callbacks = makeCallbacks();
      const options: OrchestratorOptions = {
        provider: makeProvider(),
        model: 'gemini-2.5-pro',
        conversationId: 'conv1',
        systemPrompt: 'sys',
        messages: [{ id: 'msg1', role: 'user', content: 'test', timestamp: Date.now() }],
      };

      await runOrchestrator(options, callbacks);

      expect(callbacks.onUsage).toHaveBeenCalledTimes(1);
      expect(callbacks.onUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          inputTokens: 180,
          outputTokens: 36,
          cacheReadTokens: 120,
          totalTokens: 216,
          model: 'gemini-2.5-pro',
        }),
      );
    });
  });
});
