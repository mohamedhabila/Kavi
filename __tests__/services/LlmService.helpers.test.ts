import { LlmService } from '../../src/services/llm/LlmService';
import { LlmProviderConfig } from '../../src/types';

const makeConfig = (overrides: Partial<LlmProviderConfig> = {}): LlmProviderConfig => ({
  id: 'test',
  name: 'Test',
  baseUrl: 'https://api.test.com/v1',
  apiKey: 'sk-test-key',
  model: 'test-model',
  enabled: true,
  ...overrides,
});

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

describe('LlmService helper coverage', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('detects provider transports, base URLs, and headers correctly', () => {
    const anthropic = new LlmService(
      makeConfig({
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1/',
        apiKey: 'anthropic-key',
      }),
    ) as any;
    const gemini = new LlmService(
      makeConfig({
        name: 'Google Gemini',
        baseUrl: ' https://generativelanguage.googleapis.com/v1beta/openai/ ',
        apiKey: 'AIza-test',
      }),
    ) as any;
    const vertexGemini = new LlmService(
      makeConfig({
        name: 'Gemini',
        baseUrl: ' https://aiplatform.googleapis.com/v1/ ',
        apiKey: 'AIza-vertex',
      }),
    ) as any;
    const openai = new LlmService(
      makeConfig({
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1/',
        apiKey: 'sk-openai',
        model: 'gpt-5.4',
      }),
    ) as any;
    const compatible = new LlmService(
      makeConfig({
        name: 'Compatible',
        baseUrl: '',
      }),
    ) as any;

    expect(anthropic.isAnthropicProvider()).toBe(true);
    expect(anthropic.getProviderTransport()).toBe('anthropic');
    expect(anthropic.getHeaders()).toEqual(
      expect.objectContaining({
        'Content-Type': 'application/json',
        'x-api-key': 'anthropic-key',
        'anthropic-version': '2023-06-01',
      }),
    );

    expect(gemini.isGeminiProvider()).toBe(true);
    expect(gemini.getProviderTransport()).toBe('gemini');
    expect(gemini.getHeaders()).toEqual(
      expect.objectContaining({
        'Content-Type': 'application/json',
        'x-goog-api-key': 'AIza-test',
      }),
    );
    expect(gemini.getBaseUrl()).toContain('generativelanguage.googleapis.com');
    expect(gemini.getBaseUrl().endsWith('/')).toBe(false);

    expect(vertexGemini.isGeminiProvider()).toBe(true);
    expect(vertexGemini.getProviderTransport()).toBe('gemini');
    expect(vertexGemini.getHeaders()).toEqual(
      expect.objectContaining({
        'Content-Type': 'application/json',
        'x-goog-api-key': 'AIza-vertex',
      }),
    );
    expect(vertexGemini.getBaseUrl()).toBe('https://aiplatform.googleapis.com/v1');

    expect(openai.isOpenAIProvider()).toBe(true);
    expect(openai.getProviderTransport()).toBe('openai');
    expect(openai.getHeaders()).toEqual(
      expect.objectContaining({
        'Content-Type': 'application/json',
        Authorization: 'Bearer sk-openai',
        'x-api-key': 'sk-openai',
        'api-key': 'sk-openai',
      }),
    );
    expect(openai.getBaseUrl()).toBe('https://api.openai.com/v1');
    expect(openai.supportsTemperature('gpt-5.4')).toBe(false);
    expect(openai.supportsTemperature('gpt-4o')).toBe(true);
    expect(openai.isOpenAIReasoningModel('o3-mini')).toBe(true);
    expect(openai.isGeminiModel('gemini-2.5-pro')).toBe(true);
    expect(openai.normalizeOpenAIPromptCacheRetention('in-memory' as any)).toBe('in_memory');
    expect(openai.normalizeOpenAIPromptCacheRetention('24h')).toBe('24h');

    expect(compatible.getProviderTransport()).toBe('compatible');
    expect(compatible.getBaseUrl()).toContain('api.openai.com');
  });

  it('normalizes OpenAI Responses message content across text, media, files, and scalars', () => {
    const service = new LlmService(makeConfig()) as any;

    expect(service.toOpenAIResponsesMessageContent([{ type: 'input_text', text: 'single' }])).toBe(
      'single',
    );
    expect(service.toOpenAIResponsesMessageContent(42)).toBe('42');
    expect(service.toOpenAIResponsesMessageContent(null)).toBe('');

    expect(
      service.toOpenAIResponsesMessageContent([
        'hello',
        { type: 'text', text: 'world' },
        { type: 'input_text', text: 'direct' },
        { type: 'input_image', image_url: 'https://img/1.png', detail: 'high' },
        { type: 'image_url', image_url: { url: 'https://img/2.png', detail: 'low' } },
        { type: 'input_file', file_id: 'file-1', filename: 'one.txt' },
        { type: 'file', file_data: 'Zm9v', filename: 'two.txt' },
        123,
        { foo: 'bar' },
        { type: 'input_image' },
        { type: 'file' },
      ]),
    ).toEqual([
      { type: 'input_text', text: 'hello' },
      { type: 'input_text', text: 'world' },
      { type: 'input_text', text: 'direct' },
      { type: 'input_image', image_url: 'https://img/1.png', detail: 'high' },
      { type: 'input_image', image_url: 'https://img/2.png', detail: 'low' },
      { type: 'input_file', file_id: 'file-1', filename: 'one.txt' },
      { type: 'input_file', file_data: 'Zm9v', filename: 'two.txt' },
      { type: 'input_text', text: '123' },
      { type: 'input_text', text: JSON.stringify({ foo: 'bar' }) },
    ]);
  });

  it('converts normalized Responses content to plain text for instructions and tool outputs', () => {
    const service = new LlmService(makeConfig()) as any;

    const text = service.toOpenAIResponsesText([
      'hello',
      { type: 'text', text: 'world' },
      { type: 'image_url', image_url: { url: 'https://img/2.png', detail: 'low' } },
      { type: 'input_file', file_id: 'file-1', filename: 'one.txt' },
      { foo: 'bar' },
    ]);

    expect(text).toContain('hello');
    expect(text).toContain('world');
    expect(text).toContain('[image]');
    expect(text).toContain('"file_id":"file-1"');
    expect(text).toContain('{"foo":"bar"}');
  });

  it('dedupes OpenAI reasoning items and extracts readable reasoning text', () => {
    const service = new LlmService(makeConfig()) as any;
    const repeatedFallback = { text: 'fallback only' };
    const toolCalls = [
      {
        _openai: {
          reasoningItems: [
            {
              id: 'r1',
              summary: [{ text: 'summary one' }],
              content: [{ text: 'detail one' }],
            },
            repeatedFallback,
          ],
        },
      },
      {
        _openai: {
          reasoningItems: [
            {
              id: 'r1',
              summary: [{ text: 'summary one' }],
              content: [{ text: 'detail one' }],
            },
            { text: 'fallback only' },
          ],
        },
      },
    ];

    const items = service.getOpenAIReasoningItemsFromToolCalls(toolCalls);
    expect(items).toHaveLength(2);
    expect(service.getOpenAIReasoningTextParts(items[0])).toEqual([
      { key: 'summary:r1:0', text: 'summary one' },
      { key: 'reasoning:r1:0', text: 'detail one' },
    ]);
    expect(service.extractOpenAIReasoningText(items)).toBe(
      'summary one\n\ndetail one\n\nfallback only',
    );
  });

  it('builds Responses input from system, replayed assistant items, tool calls, and tool outputs', () => {
    const service = new LlmService(makeConfig()) as any;

    const result = service.buildOpenAIResponsesInput([
      { role: 'system', content: [{ type: 'text', text: 'System note' }] },
      { role: 'user', content: 'Hello' },
      {
        role: 'assistant',
        content: 'ignored',
        providerReplay: {
          openaiResponseOutput: [
            { id: 'r-prev', type: 'reasoning', summary: [] },
            {
              id: 'msg-prev',
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: 'Previous answer', annotations: [] }],
            },
          ],
        },
      },
      {
        role: 'assistant',
        content: 'Working',
        tool_calls: [
          {
            id: 'call-raw',
            function: { name: 'read_file', arguments: { path: 'a.txt' } },
            _openai: {
              callId: 'call-live',
              itemId: 'fc-live',
              reasoningItems: [
                { id: 'r-live', type: 'reasoning', summary: [{ text: 'Need file' }] },
              ],
            },
          },
        ],
      },
      { role: 'tool', content: 'ignored because no call id' },
      { role: 'tool', tool_call_id: 'call-live', content: 'file contents' },
      { role: 'assistant', content: '' },
    ] as any);

    expect(result).toEqual({
      instructions: 'System note',
      input: [
        { role: 'user', content: 'Hello' },
        { id: 'r-prev', type: 'reasoning', summary: [] },
        {
          id: 'msg-prev',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Previous answer', annotations: [] }],
        },
        { id: 'r-live', type: 'reasoning', summary: [{ text: 'Need file' }] },
        { role: 'assistant', content: 'Working' },
        {
          type: 'function_call',
          id: 'fc-live',
          call_id: 'call-live',
          name: 'read_file',
          arguments: '{"path":"a.txt"}',
          status: 'completed',
        },
        { type: 'function_call_output', call_id: 'call-live', output: 'file contents' },
      ],
    });
  });

  it('falls back to reconstructed function_call items when assistant replay is incomplete for a tool turn', () => {
    const service = new LlmService(makeConfig()) as any;

    const result = service.buildOpenAIResponsesInput([
      { role: 'user', content: 'Read notes.txt' },
      {
        role: 'assistant',
        content: 'Checking the file.',
        providerReplay: {
          openaiResponseOutput: [
            {
              id: 'msg-final-misattached',
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: 'The file is ready.', annotations: [] }],
            },
          ],
        },
        tool_calls: [
          {
            id: 'call-raw',
            function: { name: 'read_file', arguments: { path: 'notes.txt' } },
            _openai: {
              callId: 'call-live',
              itemId: 'fc-live',
              reasoningItems: [
                { id: 'r-live', type: 'reasoning', summary: [{ text: 'Need file' }] },
              ],
            },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call-live', content: 'file contents' },
      { role: 'user', content: 'What does it say?' },
    ] as any);

    expect(result.input).toEqual([
      { role: 'user', content: 'Read notes.txt' },
      { id: 'r-live', type: 'reasoning', summary: [{ text: 'Need file' }] },
      { role: 'assistant', content: 'Checking the file.' },
      {
        type: 'function_call',
        id: 'fc-live',
        call_id: 'call-live',
        name: 'read_file',
        arguments: '{"path":"notes.txt"}',
        status: 'completed',
      },
      { type: 'function_call_output', call_id: 'call-live', output: 'file contents' },
      { role: 'user', content: 'What does it say?' },
    ]);
  });

  it('falls back to reconstructed tool turns when replayed Responses output omits required reasoning items', () => {
    const service = new LlmService(makeConfig()) as any;

    const result = service.buildOpenAIResponsesInput([
      { role: 'user', content: 'Read notes.txt' },
      {
        role: 'assistant',
        content: 'Checking the file.',
        providerReplay: {
          openaiResponseOutput: [
            {
              id: 'fc-live',
              type: 'function_call',
              call_id: 'call-live',
              name: 'read_file',
              arguments: '{"path":"notes.txt"}',
              status: 'completed',
            },
            {
              id: 'msg-prev',
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: 'Fallback text', annotations: [] }],
            },
          ],
        },
        tool_calls: [
          {
            id: 'call-raw',
            function: { name: 'read_file', arguments: { path: 'notes.txt' } },
            _openai: {
              callId: 'call-live',
              itemId: 'fc-live',
              reasoningItems: [
                { id: 'r-live', type: 'reasoning', summary: [{ text: 'Need file' }] },
              ],
            },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call-live', content: 'file contents' },
      { role: 'user', content: 'What does it say?' },
    ] as any);

    expect(result.input).toEqual([
      { role: 'user', content: 'Read notes.txt' },
      { id: 'r-live', type: 'reasoning', summary: [{ text: 'Need file' }] },
      { role: 'assistant', content: 'Checking the file.' },
      {
        type: 'function_call',
        id: 'fc-live',
        call_id: 'call-live',
        name: 'read_file',
        arguments: '{"path":"notes.txt"}',
        status: 'completed',
      },
      { type: 'function_call_output', call_id: 'call-live', output: 'file contents' },
      { role: 'user', content: 'What does it say?' },
    ]);
  });

  it('downgrades malformed OpenAI reasoning tool history to plain text when replay lineage is incomplete', () => {
    const service = new LlmService(
      makeConfig({
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-openai',
        model: 'gpt-5.4',
      }),
    ) as any;

    const result = service.buildOpenAIResponsesInput(
      [
        { role: 'user', content: 'Read notes.txt' },
        {
          role: 'assistant',
          content: 'Checking the file.',
          providerReplay: {
            openaiResponseOutput: [
              {
                id: 'fc-live',
                type: 'function_call',
                call_id: 'call-live',
                name: 'read_file',
                arguments: '{"path":"notes.txt"}',
                status: 'completed',
              },
            ],
          },
          tool_calls: [
            {
              id: 'call-live',
              function: { name: 'read_file', arguments: { path: 'notes.txt' } },
              _openai: {
                callId: 'call-live',
                itemId: 'fc-live',
              },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'call-live', content: 'file contents' },
        { role: 'user', content: 'What does it say?' },
      ] as any,
      'gpt-5.4',
    );

    expect(result.input).toEqual([
      { role: 'user', content: 'Read notes.txt' },
      {
        role: 'assistant',
        content: [
          'Checking the file.',
          'Historical tool call from a previous completed turn (exact OpenAI replay unavailable):',
          '- read_file {"path":"notes.txt"}',
        ].join('\n'),
      },
      {
        role: 'assistant',
        content:
          'Historical tool result from read_file (exact OpenAI replay unavailable):\nfile contents',
      },
      { role: 'user', content: 'What does it say?' },
    ]);
  });

  it('downgrades replay-only OpenAI function-call history when a reasoning model is missing reasoning items', () => {
    const service = new LlmService(
      makeConfig({
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-openai',
        model: 'gpt-5.4',
      }),
    ) as any;

    const result = service.buildOpenAIResponsesInput(
      [
        { role: 'user', content: 'Read notes.txt' },
        {
          role: 'assistant',
          content: '',
          providerReplay: {
            openaiResponseOutput: [
              {
                id: 'fc-live',
                type: 'function_call',
                call_id: 'call-live',
                name: 'read_file',
                arguments: '{"path":"notes.txt"}',
                status: 'completed',
              },
            ],
          },
        },
        { role: 'tool', tool_call_id: 'call-live', content: 'file contents' },
        { role: 'user', content: 'What does it say?' },
      ] as any,
      'gpt-5.4',
    );

    expect(result.input).toEqual([
      { role: 'user', content: 'Read notes.txt' },
      {
        role: 'assistant',
        content: [
          'Historical tool call from a previous completed turn (exact OpenAI replay unavailable):',
          '- read_file {"path":"notes.txt"}',
        ].join('\n'),
      },
      {
        role: 'assistant',
        content:
          'Historical tool result from read_file (exact OpenAI replay unavailable):\nfile contents',
      },
      { role: 'user', content: 'What does it say?' },
    ]);
  });

  it('builds Responses bodies with reasoning, tool choice, prompt caching, and temperature rules', () => {
    const openai = new LlmService(
      makeConfig({
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-openai',
        model: 'gpt-5.4',
      }),
    ) as any;
    const compatible = new LlmService(
      makeConfig({
        id: 'custom',
        name: 'Custom',
        baseUrl: 'https://example.ai/v1',
        apiKey: 'sk-custom',
        model: 'custom-model',
      }),
    ) as any;
    const tool = {
      name: 'read_file',
      description: 'Read a file',
      input_schema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    };

    const openAiBody = openai.buildOpenAIResponsesBody(
      'gpt-5.4',
      [{ role: 'user', content: 'Hello' }],
      {
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
    );

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

    const compatibleBody = compatible.buildOpenAIResponsesBody(
      'custom-model',
      [{ role: 'user', content: 'Hello' }],
      {
        temperature: 0.3,
      },
    );
    expect(compatibleBody.temperature).toBe(0.3);
  });

  it('opts out of strict Responses schemas when a tool explicitly disables strict mode', () => {
    const openai = new LlmService(
      makeConfig({
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-openai',
        model: 'gpt-5.4',
      }),
    ) as any;
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

    const body = openai.buildOpenAIResponsesBody(
      'gpt-5.4',
      [{ role: 'user', content: 'Run code' }],
      {
        tools: [
          {
            name: 'python',
            description: 'Execute Python code.',
            input_schema: inputSchema,
            strict: false,
          },
        ],
      },
    );

    expect(body.tools).toEqual([
      expect.objectContaining({
        name: 'python',
        strict: false,
        parameters: inputSchema,
      }),
    ]);
  });

  it('builds and merges OpenAI tool metadata and normalizes usage payloads', () => {
    const service = new LlmService(makeConfig()) as any;
    const reasoningItems = [{ id: 'r1', type: 'reasoning', summary: [] }];

    expect(
      service.buildOpenAIResponseFunctionCallItem({ function: { name: '', arguments: {} } }),
    ).toBeNull();

    const raw = service.buildOpenAIResponseToolRaw(
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

    const mergedStart = service.mergeOpenAIStreamToolCall(undefined, {
      id: 'call_1',
      type: 'function',
      function: { name: 'read_file', arguments: '{"path":' },
    });
    const mergedEnd = service.mergeOpenAIStreamToolCall(mergedStart, {
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
      service.normalizeOpenAIResponsesUsage({
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
    const service = new LlmService(makeConfig()) as any;

    const result = service.normalizeOpenAIResponsesResult({
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
