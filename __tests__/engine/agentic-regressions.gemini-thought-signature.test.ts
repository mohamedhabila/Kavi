let mockAsyncStorageData: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockAsyncStorageData[key] ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockAsyncStorageData[key] = value;
  }),
  removeItem: jest.fn(async (key: string) => {
    delete mockAsyncStorageData[key];
  }),
}));
jest.mock('../../src/engine/orchestrator', () => ({
  runOrchestrator: jest.fn().mockResolvedValue(undefined),
}));
let mockIdCounter = 0;
jest.mock('../../src/utils/id', () => ({
  generateId: jest.fn(() => `mock-id-${++mockIdCounter}`),
}));
import { spawnSubAgent, getSessionContext } from '../../src/services/agents/subAgent';
import { runOrchestrator } from '../../src/engine/orchestrator';
import { LlmService } from '../../src/services/llm/LlmService';
import { GEMINI_IMPORTED_FUNCTION_CALL_THOUGHT_SIGNATURE } from '../../src/services/llm/providers/gemini/toolTurnRepair';
import type { LlmProviderConfig } from '../../src/types/provider';
const mockProvider: LlmProviderConfig = {
  id: 'test',
  name: 'Test',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'test-key',
  model: 'gpt-4',
  enabled: true,
};
const makeGeminiConfig = (overrides: Partial<LlmProviderConfig> = {}): LlmProviderConfig => ({
  id: 'gemini',
  name: 'Gemini',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  apiKey: 'AIza-test',
  model: 'gemini-3.1-pro-preview',
  enabled: true,
  ...overrides,
});
beforeEach(() => {
  jest.clearAllMocks();
  mockAsyncStorageData = {};
  mockIdCounter = 0;
});

describe('Bug 1: Gemini thought_signature handling', () => {
  let mockFetch: jest.SpyInstance;

  beforeEach(() => {
    mockFetch = jest.spyOn(global, 'fetch').mockImplementation(
      async () =>
        ({
          ok: true,
          json: () => Promise.resolve({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }),
        }) as any,
    );
  });

  afterEach(() => {
    mockFetch.mockRestore();
  });

  it('replays Gemini thought signatures from raw tool metadata when providerReplay is absent', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          candidates: [{ content: { parts: [{ text: 'ok' }] } }],
        }),
    });

    const service = new LlmService(makeGeminiConfig());

    await service.sendMessage([
      { role: 'user', content: 'Read file a.txt' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'tc1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"a.txt"}' },
            extra_content: { google: { thought_signature: 'real-sig-A' } },
          },
        ],
      } as any,
      { role: 'tool', content: 'file content', tool_call_id: 'tc1', name: 'read_file' } as any,
    ]);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const modelParts = body.contents.find((c: any) => c.role === 'model')?.parts;
    expect(modelParts).toBeDefined();
    expect(modelParts[0].thoughtSignature).toBe('real-sig-A');
  });

  it('uses the official imported-call signature for complete Gemini 3 replay when raw metadata lacks one', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          candidates: [{ content: { parts: [{ text: 'ok' }] } }],
        }),
    });

    const service = new LlmService(makeGeminiConfig());

    await service.sendMessage([
      { role: 'user', content: 'Read file a.txt' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'tc1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"a.txt"}' },
            // NO extra_content — signature genuinely missing
          },
        ],
      } as any,
      { role: 'tool', content: 'file content', tool_call_id: 'tc1', name: 'read_file' } as any,
    ]);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const allParts = body.contents.flatMap((content: any) => content.parts);
    const functionCallPart = allParts.find((part: any) => part.functionCall);
    const functionResponsePart = allParts.find((part: any) => part.functionResponse);
    expect(functionCallPart).toEqual(
      expect.objectContaining({
        functionCall: expect.objectContaining({
          id: 'tc1',
          name: 'read_file',
          args: { path: 'a.txt' },
        }),
        thoughtSignature: GEMINI_IMPORTED_FUNCTION_CALL_THOUGHT_SIGNATURE,
      }),
    );
    expect(functionResponsePart).toEqual(
      expect.objectContaining({
        functionResponse: expect.objectContaining({
          id: 'tc1',
          name: 'read_file',
          response: { result: 'file content' },
        }),
      }),
    );
  });

  it('replays raw Gemini thoughtSignature metadata when providerReplay is absent', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          candidates: [{ content: { parts: [{ text: 'ok' }] } }],
        }),
    });

    const service = new LlmService(makeGeminiConfig());

    await service.sendMessage([
      { role: 'user', content: 'Read file a.txt' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'tc1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"a.txt"}' },
            extra_content: { google: { thought_signature: 'captured-sig-B' } },
          },
        ],
      } as any,
      { role: 'tool', content: 'file content', tool_call_id: 'tc1', name: 'read_file' } as any,
    ]);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const modelParts = body.contents.find((c: any) => c.role === 'model')?.parts;
    expect(modelParts).toBeDefined();
    expect(modelParts[0].thoughtSignature).toBe('captured-sig-B');
  });

  it('uses providerReplay.geminiParts with real signatures when available', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          candidates: [{ content: { parts: [{ text: 'ok' }] } }],
        }),
    });

    const service = new LlmService(makeGeminiConfig());

    await service.sendMessage([
      { role: 'user', content: 'Read file a.txt' },
      {
        role: 'assistant',
        content: '',
        providerReplay: {
          geminiParts: [
            {
              functionCall: { id: 'tc1', name: 'read_file', args: { path: 'a.txt' } },
              thoughtSignature: 'crypto-real-sig',
            },
          ],
        },
        tool_calls: [
          {
            id: 'tc1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"a.txt"}' },
          },
        ],
      } as any,
      { role: 'tool', content: 'file content', tool_call_id: 'tc1', name: 'read_file' } as any,
    ]);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const modelParts = body.contents.find((c: any) => c.role === 'model')?.parts;
    expect(modelParts).toBeDefined();
    // providerReplay takes priority → real signature
    expect(modelParts[0].thoughtSignature).toBe('crypto-real-sig');
  });

  it('rehydrates missing providerReplay signatures from streamed tool call raw metadata', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          candidates: [{ content: { parts: [{ text: 'ok' }] } }],
        }),
    });

    const service = new LlmService(makeGeminiConfig());

    await service.sendMessage([
      { role: 'user', content: 'Read file a.txt' },
      {
        role: 'assistant',
        content: '',
        providerReplay: {
          geminiParts: [
            {
              functionCall: { name: 'read_file', args: { path: 'a.txt' } },
            },
          ],
        },
        tool_calls: [
          {
            id: 'tc1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"a.txt"}' },
            raw: {
              id: 'tc1',
              type: 'function',
              function: { name: 'read_file', arguments: '{"path":"a.txt"}' },
              thoughtSignature: 'streamed-sig-1',
            },
          },
        ],
      } as any,
      { role: 'tool', content: 'file content', tool_call_id: 'tc1', name: 'read_file' } as any,
    ]);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const modelParts = body.contents.find((c: any) => c.role === 'model')?.parts;
    expect(modelParts).toBeDefined();
    expect(modelParts[0].thoughtSignature).toBe('streamed-sig-1');
  });

  it('retries Gemini structured output with legacy responseSchema when responseFormat is unsupported', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              error: {
                message:
                  'Invalid JSON payload received. Unknown name "responseFormat" at \'generation_config\': Cannot find field.',
              },
            }),
          ),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({ ok: true }),
                    },
                  ],
                },
              },
            ],
          }),
      });

    const service = new LlmService(makeGeminiConfig());
    await service.sendMessage([{ role: 'user', content: 'Return JSON.' }], {
      structuredOutput: {
        name: 'pilot_report',
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
          },
          required: ['ok'],
          additionalProperties: false,
        },
      },
    } as any);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    const retryBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(firstBody.generationConfig.responseFormat).toBeDefined();
    expect(retryBody.generationConfig.responseFormat).toBeUndefined();
    expect(retryBody.generationConfig.responseMimeType).toBe('application/json');
    expect(retryBody.generationConfig.responseSchema).toEqual(
      expect.objectContaining({
        type: 'object',
        properties: expect.objectContaining({ ok: expect.objectContaining({ type: 'boolean' }) }),
      }),
    );
  });
});

describe('Bug 2: Claude subagent output', () => {
  let sendMessageSpy: jest.SpyInstance;

  beforeEach(() => {
    sendMessageSpy = jest.spyOn(LlmService.prototype, 'sendMessage').mockResolvedValue({});
  });

  afterEach(() => {
    sendMessageSpy.mockRestore();
  });

  it('synthesizes a terminal worker report when all turns are tool-only', async () => {
    const toolResult = JSON.stringify({
      summary: 'Found 3 files',
      files: ['a.ts', 'b.ts', 'c.ts'],
    });
    sendMessageSpy.mockResolvedValueOnce({
      output_parsed: {
        report: 'Final report: Found 3 files in the workspace.',
        completionState: 'incomplete',
      },
    } as any);

    (runOrchestrator as jest.Mock).mockImplementation((_cfg: any, callbacks: any) => {
      // Simulate Claude tool_use: no text tokens, only tool calls
      callbacks.onToolCallStart({ id: 'tc1', name: 'read_file', arguments: '{}' });
      callbacks.onToolCallComplete({
        id: 'tc1',
        name: 'read_file',
        result: toolResult,
        status: 'success',
      });
      callbacks.onAssistantMessage('', [{ id: 'tc1', name: 'read_file' }]);
      callbacks.onDone();
      return Promise.resolve();
    });

    const result = await spawnSubAgent(
      { parentConversationId: 'conv-1', prompt: 'Search files' },
      mockProvider,
    );

    expect(result.status).toBe('completed');
    expect(result.output).toBe('Final report: Found 3 files in the workspace.');
    expect(sendMessageSpy).toHaveBeenCalledTimes(1);
  });

  it('prefers finalNonEmptyContent over tool results', async () => {
    (runOrchestrator as jest.Mock).mockImplementation((_cfg: any, callbacks: any) => {
      callbacks.onToolCallStart({ id: 'tc1', name: 'read_file', arguments: '{}' });
      callbacks.onToolCallComplete({
        id: 'tc1',
        name: 'read_file',
        result: 'tool data',
        status: 'success',
      });
      callbacks.onAssistantMessage('queued read_file', [{ id: 'tc1', name: 'read_file' }]);
      // Final turn with text only (no tools) → this is the "final" content
      callbacks.onAssistantMessage('Here are the results: everything passed.', undefined);
      callbacks.onDone();
      return Promise.resolve();
    });

    const result = await spawnSubAgent(
      { parentConversationId: 'conv-1', prompt: 'Check things' },
      mockProvider,
    );

    expect(result.status).toBe('completed');
    expect(result.output).toContain('Here are the results');
    expect(sendMessageSpy).not.toHaveBeenCalled();
  });

  it('shows up to 10 tool previews in fallback output', async () => {
    (runOrchestrator as jest.Mock).mockImplementation((_cfg: any, callbacks: any) => {
      // Simulate many tool calls with short (< 30 char) results
      for (let i = 0; i < 12; i++) {
        callbacks.onToolCallStart({ id: `tc${i}`, name: `tool_${i}`, arguments: '{}' });
        callbacks.onToolCallComplete({
          id: `tc${i}`,
          name: `tool_${i}`,
          result: `result${i}`,
          status: 'success',
        });
      }
      callbacks.onAssistantMessage('', []);
      callbacks.onDone();
      return Promise.resolve();
    });

    const result = await spawnSubAgent(
      { parentConversationId: 'conv-1', prompt: 'Run tools' },
      mockProvider,
    );

    expect(result.status).toBe('completed');
    expect(result.output).toBeTruthy();
    expect(sendMessageSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back to the last substantive tool result when finalization produces no answer', async () => {
    const toolResult = JSON.stringify({
      summary: 'Found 3 files',
      files: ['a.ts', 'b.ts', 'c.ts'],
    });

    (runOrchestrator as jest.Mock).mockImplementation((_cfg: any, callbacks: any) => {
      callbacks.onToolCallStart({ id: 'tc1', name: 'read_file', arguments: '{}' });
      callbacks.onToolCallComplete({
        id: 'tc1',
        name: 'read_file',
        result: toolResult,
        status: 'success',
      });
      callbacks.onAssistantMessage('', [{ id: 'tc1', name: 'read_file' }]);
      callbacks.onDone();
      return Promise.resolve();
    });

    const result = await spawnSubAgent(
      { parentConversationId: 'conv-1', prompt: 'Search files' },
      mockProvider,
    );

    expect(result.status).toBe('completed');
    expect(result.output).toContain('Found 3 files');
  });
});

describe('Bug 3: Subagent context persistence', () => {
  it('stores session context after completion', async () => {
    (runOrchestrator as jest.Mock).mockImplementation((_cfg: any, callbacks: any) => {
      callbacks.onToken('search results here');
      callbacks.onDone();
      return Promise.resolve();
    });

    const result = await spawnSubAgent(
      {
        parentConversationId: 'conv-1',
        prompt: 'Search for files',
        systemPrompt: 'You are a file searcher.',
        tools: ['read_file', 'list_files'],
        sandboxPolicy: 'safe-only',
        name: 'file-searcher',
      },
      mockProvider,
      [mockProvider],
    );

    expect(result.status).toBe('completed');

    const context = getSessionContext(result.sessionId);
    expect(context).toBeDefined();
    expect(context!.config.systemPrompt).toBe('You are a file searcher.');
    expect(context!.config.tools).toEqual(['read_file', 'list_files']);
    expect(context!.config.sandboxPolicy).toBe('safe-only');
    expect(context!.config.name).toBe('file-searcher');
    expect(context!.provider).toEqual(mockProvider);
    expect(context!.allProviders).toEqual([mockProvider]);
    expect(context!.conversationSummary).toContain('search results here');
  });

  it('stores bounded resumable context after timeout', async () => {
    (runOrchestrator as jest.Mock).mockImplementation((_cfg: any, callbacks: any) => {
      callbacks.onAssistantMessage('Partial findings before timeout');
      const err = new Error('Aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    });

    const result = await spawnSubAgent(
      {
        parentConversationId: 'conv-1',
        prompt: 'Search for files',
        systemPrompt: 'You are a file searcher.',
        timeoutMs: 50,
      },
      mockProvider,
    );

    expect(result.status).toBe('timeout');

    const context = getSessionContext(result.sessionId);
    expect(context).toBeDefined();
    expect(context!.conversationSummary).toContain('Partial findings before timeout');
    expect(context!.messages.at(-1)?.content).toContain('Partial findings before timeout');
  });

  it('returns an isolated clone of stored session context', async () => {
    (runOrchestrator as jest.Mock).mockImplementation((_cfg: any, callbacks: any) => {
      callbacks.onAssistantMessage('Stored result');
      callbacks.onDone();
      return Promise.resolve();
    });

    const result = await spawnSubAgent(
      {
        parentConversationId: 'conv-1',
        prompt: 'Search for files',
        tools: ['read_file'],
      },
      mockProvider,
    );

    const context = getSessionContext(result.sessionId)!;
    context.config.tools?.push('web_search');
    context.messages[0].content = 'mutated';

    const freshContext = getSessionContext(result.sessionId)!;
    expect(freshContext.config.tools).toEqual(['read_file']);
    expect(freshContext.messages[0].content).not.toBe('mutated');
  });

  it('preserves Gemini providerReplay and raw tool metadata in stored session context', async () => {
    (runOrchestrator as jest.Mock).mockImplementation((_cfg: any, callbacks: any) => {
      callbacks.onAssistantMessage(
        '',
        [
          {
            id: 'tc1',
            name: 'read_file',
            arguments: '{"path":"a.txt"}',
            status: 'pending',
            raw: {
              id: 'tc1',
              type: 'function',
              function: { name: 'read_file', arguments: '{"path":"a.txt"}' },
              extra_content: { google: { thought_signature: 'sig-A' } },
            },
          },
        ],
        {
          geminiParts: [
            {
              functionCall: { id: 'tc1', name: 'read_file', args: { path: 'a.txt' } },
              thoughtSignature: 'sig-A',
            },
          ],
        },
      );
      callbacks.onToolMessage('tc1', 'file content');
      callbacks.onDone();
      return Promise.resolve();
    });

    const result = await spawnSubAgent(
      {
        parentConversationId: 'conv-1',
        prompt: 'Read the file',
      },
      makeGeminiConfig(),
      [makeGeminiConfig()],
    );

    const context = getSessionContext(result.sessionId)!;
    const assistantMessage = context.messages.find((message) => message.role === 'assistant');

    expect(assistantMessage?.providerReplay?.geminiParts?.[0]).toEqual({
      functionCall: { id: 'tc1', name: 'read_file', args: { path: 'a.txt' } },
      thoughtSignature: 'sig-A',
    });
    expect(assistantMessage?.toolCalls?.[0]?.raw).toEqual({
      id: 'tc1',
      type: 'function',
      function: { name: 'read_file', arguments: '{"path":"a.txt"}' },
      extra_content: { google: { thought_signature: 'sig-A' } },
    });
  });

  it('caps stored session transcript size for follow-up continuity', async () => {
    (runOrchestrator as jest.Mock).mockImplementation((_cfg: any, callbacks: any) => {
      for (let index = 0; index < 20; index += 1) {
        callbacks.onAssistantMessage(`Step ${index}: ${'detail '.repeat(120)}`);
      }
      callbacks.onDone();
      return Promise.resolve();
    });

    const result = await spawnSubAgent(
      {
        parentConversationId: 'conv-1',
        prompt: 'Long running task',
      },
      mockProvider,
    );

    const context = getSessionContext(result.sessionId)!;
    expect(context.messages.length).toBeLessThanOrEqual(12);
    expect(context.messages.every((message) => message.content.length <= 1400)).toBe(true);
  });

  it('returns undefined for unknown session contexts', () => {
    const context = getSessionContext('nonexistent-session');
    expect(context).toBeUndefined();
  });
});
