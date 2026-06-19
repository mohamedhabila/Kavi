import { buildOpenAIResponseToolRaw, buildOpenAIResponsesBody, mergeOpenAIStreamToolCall, normalizeOpenAIResponsesResult, normalizeOpenAIResponsesUsage } from '../../src/services/llm/providers/openaiResponses/helpers';
import { buildOpenAIResponseFunctionCallItem } from '../../src/services/llm/providers/openaiResponses/conversation';
const mockFetch = jest.fn();
global.fetch = mockFetch as any;

describe('LlmService helper coverage', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });
  it('builds Responses bodies with reasoning, tool choice, prompt caching, and temperature rules', () => {
    const tool = {
      name: 'read_file',
      description: 'Read a file',
      input_schema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    };

    const openAiBody = buildOpenAIResponsesBody({
      model: 'gpt-5.4',
      messages: [{ role: 'user', content: 'Hello' }],
      options: {
        stream: true,
        maxTokens: 256,
        temperature: 0.7,
        reasoning_effort: 'high',
        tools: [tool],
        toolChoice: 'required',
        enablePromptCaching: true,
        promptCacheKey: 'cm:test:key',
        promptCacheRetention: '24h',
      },
      reorderToolsForPromptCaching: (tools) => tools,
    });

    expect(openAiBody).toEqual(
      expect.objectContaining({
        model: 'gpt-5.4',
        stream: true,
        max_output_tokens: 256,
        include: ['reasoning.encrypted_content'],
        reasoning: { effort: 'high', summary: 'auto' },
        tool_choice: 'required',
        prompt_cache_key: 'cm:test:key',
        prompt_cache_retention: '24h',
      }),
    );
    expect(openAiBody.temperature).toBeUndefined();
    expect(openAiBody.tools).toEqual([
      expect.objectContaining({
        type: 'function',
        name: 'read_file',
        strict: true,
      }),
    ]);

    const compatibleBody = buildOpenAIResponsesBody({
      model: 'custom-model',
      messages: [{ role: 'user', content: 'Hello' }],
      options: {
        enablePromptCaching: true,
        promptCacheKey: 'cm:should-not-forward',
        temperature: 0.3,
      },
      serializeOpenAIPromptCacheHints: false,
    });
    expect(compatibleBody.temperature).toBe(0.3);
    expect(compatibleBody.prompt_cache_key).toBeUndefined();
    expect(compatibleBody.prompt_cache_retention).toBeUndefined();
  });
  it('opts out of strict Responses schemas when a tool explicitly disables strict mode', () => {
    const inputSchema = {
      type: 'object',
      properties: {
        code: { type: 'string' },
        packages: {
          type: 'array',
          items: { type: 'string' },
        },
      },
      required: ['code'],
    };

    const body = buildOpenAIResponsesBody({
      model: 'gpt-5.4',
      messages: [{ role: 'user', content: 'Run code' }],
      options: {
        tools: [
          {
            name: 'python',
            description: 'Execute Python code.',
            input_schema: inputSchema,
            strict: false,
          },
        ],
      },
    });

    expect(body.tools).toEqual([
      expect.objectContaining({
        name: 'python',
        strict: false,
        parameters: inputSchema,
      }),
    ]);
  });
  it('builds and merges OpenAI tool metadata and normalizes usage payloads', () => {
    const reasoningItems = [{ id: 'r1', type: 'reasoning', summary: [] }];

    expect(
      buildOpenAIResponseFunctionCallItem({ function: { name: '', arguments: {} } }),
    ).toBeNull();

    const raw = buildOpenAIResponseToolRaw(
      {
        id: 'fc_1',
        call_id: 'call_1',
        name: 'read_file',
        arguments: { path: 'a.txt' },
      },
      {
        outputIndex: 2,
        reasoningItems,
      },
    );

    expect(raw).toEqual({
      id: 'call_1',
      type: 'function',
      function: {
        name: 'read_file',
        arguments: '{"path":"a.txt"}',
      },
      _openai: {
        itemId: 'fc_1',
        callId: 'call_1',
        outputIndex: 2,
        reasoningItems,
      },
    });

    const mergedStart = mergeOpenAIStreamToolCall(undefined, {
      id: 'call_1',
      type: 'function',
      function: { name: 'read_file', arguments: '{"path":' },
    });
    const mergedEnd = mergeOpenAIStreamToolCall(mergedStart, {
      function: { arguments: '{"path":"a.txt"}' },
      _openai: { outputIndex: 2 },
    });

    expect(mergedEnd).toEqual({
      id: 'call_1',
      name: 'read_file',
      arguments: '{"path":"a.txt"}',
      raw: {
        id: 'call_1',
        type: 'function',
        function: { name: 'read_file', arguments: '{"path":"a.txt"}' },
        _openai: { outputIndex: 2 },
      },
    });

    expect(
      normalizeOpenAIResponsesUsage({
        input_tokens: 10,
        output_tokens: 4,
        input_tokens_details: { cached_tokens: 3, cache_write_tokens: 2 },
        output_tokens_details: { reasoning_tokens: 1 },
      }),
    ).toEqual({
      prompt_tokens: 10,
      completion_tokens: 4,
      total_tokens: 14,
      prompt_tokens_details: {
        cached_tokens: 3,
        cache_write_tokens: 2,
      },
      output_tokens_details: { reasoning_tokens: 1 },
      cache_read_input_tokens: 3,
      cache_creation_input_tokens: 2,
    });
  });
  it('normalizes OpenAI Responses API payloads back into chat-completions style results', () => {
    const result = normalizeOpenAIResponsesResult({
      status: 'completed',
      output: [
        { id: 'r1', type: 'reasoning', summary: [{ text: 'Need tool' }] },
        {
          id: 'fc_1',
          type: 'function_call',
          call_id: 'call_1',
          name: 'read_file',
          arguments: '{"path":"a.txt"}',
        },
        {
          id: 'm1',
          type: 'message',
          role: 'assistant',
          content: [
            { type: 'refusal', refusal: 'No ' },
            { type: 'output_text', text: 'problem', annotations: [] },
          ],
        },
      ],
      usage: {
        prompt_tokens: 12,
        completion_tokens: 5,
        prompt_tokens_details: { cached_tokens: 4 },
      },
    });

    expect(result).toEqual({
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'No problem',
            reasoning: 'Need tool',
            providerReplay: {
              openaiResponseOutput: [
                { id: 'r1', type: 'reasoning', summary: [{ text: 'Need tool' }] },
                {
                  id: 'fc_1',
                  type: 'function_call',
                  call_id: 'call_1',
                  name: 'read_file',
                  arguments: '{"path":"a.txt"}',
                },
                {
                  id: 'm1',
                  type: 'message',
                  role: 'assistant',
                  content: [
                    { type: 'refusal', refusal: 'No ' },
                    { type: 'output_text', text: 'problem', annotations: [] },
                  ],
                },
              ],
            },
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                index: 0,
                function: {
                  name: 'read_file',
                  arguments: '{"path":"a.txt"}',
                },
                raw: {
                  id: 'call_1',
                  type: 'function',
                  function: {
                    name: 'read_file',
                    arguments: '{"path":"a.txt"}',
                  },
                  _openai: {
                    itemId: 'fc_1',
                    callId: 'call_1',
                    outputIndex: 1,
                    reasoningItems: [
                      { id: 'r1', type: 'reasoning', summary: [{ text: 'Need tool' }] },
                    ],
                  },
                },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: {
        prompt_tokens: 12,
        completion_tokens: 5,
        total_tokens: 17,
        prompt_tokens_details: { cached_tokens: 4 },
        output_tokens_details: {},
        cache_read_input_tokens: 4,
      },
    });
  });
});
