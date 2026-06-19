import { normalizeOpenAIPromptCacheRetention } from '../../src/services/llm/providers/openaiResponses/helpers';
import { buildOpenAIResponsesInput } from '../../src/services/llm/providers/openaiResponses/conversation';
import { toOpenAIResponsesMessageContent, toOpenAIResponsesText } from '../../src/services/llm/providers/openaiResponses/content';
import { extractOpenAIReasoningText, getOpenAIReasoningItemsFromToolCalls, getOpenAIReasoningTextParts } from '../../src/services/llm/core/reasoningExtraction';
import { isAnthropicClaude4Model, isAnthropicClaude4OpusModel, isGemini3Model, isGeminiProModel, isOpenAIReasoningModel, supportsAnthropicAdaptiveThinking, supportsTemperature } from '../../src/services/llm/catalog/providerCapabilities';
import { isGeminiModelName } from '../../src/services/llm/catalog/providerFamilies';
import { resolveProviderTransport } from '../../src/services/llm/catalog/providerProtocols';
import { buildProviderHeaders, resolveProviderBaseUrl } from '../../src/services/llm/core/providerRequest';
import { LlmProviderConfig } from '../../src/types/provider';
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
    const anthropic = makeConfig({
      name: 'Anthropic',
      baseUrl: 'https://api.anthropic.com/v1/',
      apiKey: 'anthropic-key',
    });
    const gemini = makeConfig({
      name: 'Google Gemini',
      baseUrl: ' https://generativelanguage.googleapis.com/v1beta/openai/ ',
      apiKey: 'AIza-test',
    });
    const vertexGemini = makeConfig({
      name: 'Gemini',
      baseUrl: ' https://aiplatform.googleapis.com/v1/ ',
      apiKey: 'AIza-vertex',
    });
    const vertexOpenAiCompatible = makeConfig({
      name: 'Gemini',
      baseUrl:
        'https://us-central1-aiplatform.googleapis.com/v1/projects/demo/locations/us-central1/endpoints/openapi',
      apiKey: 'vertex-openai-key',
    });
    const openai = makeConfig({
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1/',
      apiKey: 'sk-openai',
      model: 'gpt-5.4',
    });
    const compatible = makeConfig({
      name: 'Compatible',
      baseUrl: '',
    });

    expect(resolveProviderTransport(anthropic)).toBe('anthropic');
    expect(buildProviderHeaders(anthropic)).toEqual(
      expect.objectContaining({
        'Content-Type': 'application/json',
        'x-api-key': 'anthropic-key',
        'anthropic-version': '2023-06-01',
      }),
    );

    expect(resolveProviderTransport(gemini)).toBe('gemini');
    expect(buildProviderHeaders(gemini)).toEqual(
      expect.objectContaining({
        'Content-Type': 'application/json',
        'x-goog-api-key': 'AIza-test',
      }),
    );
    expect(resolveProviderBaseUrl(gemini)).toContain('generativelanguage.googleapis.com');
    expect(resolveProviderBaseUrl(gemini).endsWith('/')).toBe(false);

    expect(resolveProviderTransport(vertexGemini)).toBe('gemini');
    expect(buildProviderHeaders(vertexGemini)).toEqual(
      expect.objectContaining({
        'Content-Type': 'application/json',
        'x-goog-api-key': 'AIza-vertex',
      }),
    );
    expect(resolveProviderBaseUrl(vertexGemini)).toBe('https://aiplatform.googleapis.com/v1');

    expect(resolveProviderTransport(vertexOpenAiCompatible)).toBe('compatible');
    expect(resolveProviderBaseUrl(vertexOpenAiCompatible)).toBe(
      'https://us-central1-aiplatform.googleapis.com/v1/projects/demo/locations/us-central1/endpoints/openapi',
    );

    expect(resolveProviderTransport(openai)).toBe('openai');
    expect(buildProviderHeaders(openai)).toEqual(
      expect.objectContaining({
        'Content-Type': 'application/json',
        Authorization: 'Bearer sk-openai',
        'x-api-key': 'sk-openai',
        'api-key': 'sk-openai',
      }),
    );
    expect(resolveProviderBaseUrl(openai)).toBe('https://api.openai.com/v1');
    expect(supportsTemperature('gpt-5.4')).toBe(false);
    expect(supportsTemperature('gpt-4o')).toBe(true);
    expect(isOpenAIReasoningModel('o3-mini')).toBe(true);
    expect(isGeminiModelName('gemini-2.5-pro')).toBe(true);
    expect(normalizeOpenAIPromptCacheRetention()).toBe('24h');
    expect(normalizeOpenAIPromptCacheRetention('in-memory' as any)).toBe('in_memory');
    expect(normalizeOpenAIPromptCacheRetention('24h')).toBe('24h');

    expect(resolveProviderTransport(compatible)).toBe('compatible');
    expect(resolveProviderBaseUrl(compatible)).toContain('api.openai.com');
  });
  it('derives Anthropic and Gemini model capabilities from canonical hosted-family metadata', () => {
    expect(isAnthropicClaude4Model('anthropic/claude-sonnet-4-6')).toBe(true);
    expect(isAnthropicClaude4OpusModel('anthropic/claude-opus-4-6')).toBe(true);
    expect(supportsAnthropicAdaptiveThinking('anthropic/claude-sonnet-4-6')).toBe(true);
    expect(supportsAnthropicAdaptiveThinking('anthropic/claude-sonnet-4-5')).toBe(false);

    expect(isGemini3Model('google/gemini-3.5-flash')).toBe(true);
    expect(isGemini3Model('models/gemini-3-flash-preview')).toBe(true);
    expect(isGemini3Model('google/gemini-2.5-pro')).toBe(false);
    expect(isGeminiProModel('google/gemini-2.5-pro')).toBe(true);
    expect(isGeminiProModel('google/gemini-3-flash-preview')).toBe(false);
    expect(isOpenAIReasoningModel('openrouter/openai/o3-mini')).toBe(true);
  });
  it('normalizes OpenAI Responses message content across text, media, files, and scalars', () => {
    expect(toOpenAIResponsesMessageContent([{ type: 'input_text', text: 'single' }])).toBe(
      'single',
    );
    expect(toOpenAIResponsesMessageContent(42)).toBe('42');
    expect(toOpenAIResponsesMessageContent(null)).toBe('');

    expect(
      toOpenAIResponsesMessageContent([
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
    const text = toOpenAIResponsesText([
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

    const items = getOpenAIReasoningItemsFromToolCalls(toolCalls);
    expect(items).toHaveLength(2);
    expect(getOpenAIReasoningTextParts(items[0])).toEqual([
      { key: 'summary:r1:0', text: 'summary one' },
      { key: 'reasoning:r1:0', text: 'detail one' },
    ]);
    expect(extractOpenAIReasoningText(items)).toBe('summary one\n\ndetail one\n\nfallback only');
  });
  it('builds Responses input from system, replayed assistant items, tool calls, and tool outputs', () => {
    const result = buildOpenAIResponsesInput([
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
        { type: 'reasoning', summary: [] },
        {
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
    const result = buildOpenAIResponsesInput([
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
    const result = buildOpenAIResponsesInput([
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
  it('replays malformed OpenAI reasoning tool history as raw function call structure when replay lineage is incomplete', () => {
    const result = buildOpenAIResponsesInput(
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
        type: 'function_call',
        call_id: 'call-live',
        name: 'read_file',
        arguments: '{"path":"notes.txt"}',
        status: 'completed',
      },
      { type: 'function_call_output', call_id: 'call-live', output: 'file contents' },
      { role: 'user', content: 'What does it say?' },
    ]);
  });
  it('replays replay-only OpenAI function-call history structurally even when reasoning items are missing', () => {
    const result = buildOpenAIResponsesInput(
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
        type: 'function_call',
        call_id: 'call-live',
        name: 'read_file',
        arguments: '{"path":"notes.txt"}',
        status: 'completed',
      },
      { type: 'function_call_output', call_id: 'call-live', output: 'file contents' },
      { role: 'user', content: 'What does it say?' },
    ]);
  });
});
