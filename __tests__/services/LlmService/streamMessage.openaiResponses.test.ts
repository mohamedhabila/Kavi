// ---------------------------------------------------------------------------
// Tests - LLM Service: streamMessage OpenAI Responses streams
// ---------------------------------------------------------------------------

import {
  createMockStreamResponse,
  LlmService,
  makeConfig,
  mockFetch,
} from '../../helpers/llmServiceHarness';

describe('LlmService', () => {
  describe('streamMessage OpenAI Responses streams', () => {
    it('streams OpenAI Responses events and preserves tool metadata', async () => {
      const response = createMockStreamResponse([
        'data: {"type":"response.reasoning_summary_text.delta","item_id":"rs_1","output_index":0,"summary_index":0,"delta":"Need tool"}\n\n',
        'data: {"type":"response.output_item.added","output_index":1,"item":{"type":"function_call","id":"fc_1","call_id":"call_1","name":"read_file","arguments":""}}\n\n',
        'data: {"type":"response.function_call_arguments.delta","output_index":1,"item_id":"fc_1","delta":"{\\"path\\":"}"}\n\n',
        'data: {"type":"response.function_call_arguments.delta","output_index":1,"item_id":"fc_1","delta":"\\"test.txt\\"}"}\n\n',
        'data: {"type":"response.function_call_arguments.done","output_index":1,"item_id":"fc_1","name":"read_file","arguments":"{\\"path\\":\\"test.txt\\"}"}\n\n',
        'data: {"type":"response.output_text.delta","item_id":"msg_1","output_index":2,"content_index":0,"delta":"Reading"}\n\n',
        'data: {"type":"response.output_text.delta","item_id":"msg_1","output_index":2,"content_index":0,"delta":" file"}\n\n',
        'data: {"type":"response.completed","response":{"id":"resp_stream_1","status":"completed","output":[{"id":"rs_1","type":"reasoning","content":[],"summary":[]},{"id":"fc_1","type":"function_call","call_id":"call_1","name":"read_file","arguments":"{\\"path\\":\\"test.txt\\"}"},{"id":"msg_1","type":"message","role":"assistant","content":[{"type":"output_text","text":"Reading file","annotations":[]}]}],"output_text":"Reading file","usage":{"input_tokens":10,"output_tokens":6,"input_tokens_details":{"cached_tokens":4}}}}\n\n',
      ]);
      mockFetch.mockResolvedValueOnce(response);

      const service = new LlmService(
        makeConfig({
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-openai',
          model: 'gpt-5.4',
        }),
      );
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'Read file' }])) {
        events.push(event);
      }

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/responses',
        expect.any(Object),
      );

      expect(events.filter((e) => e.type === 'token').map((e) => e.content)).toEqual([
        'Reading',
        ' file',
      ]);
      expect(events.filter((e) => e.type === 'reasoning').map((e) => e.content)).toEqual([
        'Need tool',
      ]);

      const usage = events.find((e) => e.type === 'usage');
      expect(usage).toEqual(
        expect.objectContaining({
          type: 'usage',
          usage: expect.objectContaining({
            inputTokens: 10,
            outputTokens: 6,
            cacheReadTokens: 4,
          }),
        }),
      );

      const toolCalls = events.filter((e) => e.type === 'tool_call');
      expect(toolCalls.length).toBeGreaterThanOrEqual(1);
      const finalToolCall = toolCalls[toolCalls.length - 1]?.toolCall;
      expect(finalToolCall?.id).toBe('call_1');
      expect(finalToolCall?.name).toBe('read_file');
      expect(finalToolCall?.arguments).toBe('{"path":"test.txt"}');
      expect(finalToolCall?.raw?._openai).toEqual(
        expect.objectContaining({
          itemId: 'fc_1',
          callId: 'call_1',
          outputIndex: 1,
          reasoningItems: [
            {
              id: 'rs_1',
              type: 'reasoning',
              content: [],
              summary: [],
            },
          ],
        }),
      );
      expect(events.findIndex((event) => event.type === 'tool_call')).toBeLessThan(
        events.findIndex((event) => event.type === 'done'),
      );

      expect(events.find((e) => e.type === 'done')).toEqual(
        expect.objectContaining({
          type: 'done',
          content: 'Reading file',
          providerReplay: {
            openaiResponseId: 'resp_stream_1',
            openaiResponseOutput: [
              { id: 'rs_1', type: 'reasoning', content: [], summary: [] },
              {
                id: 'fc_1',
                type: 'function_call',
                call_id: 'call_1',
                name: 'read_file',
                arguments: '{"path":"test.txt"}',
              },
              {
                id: 'msg_1',
                type: 'message',
                role: 'assistant',
                content: [{ type: 'output_text', text: 'Reading file', annotations: [] }],
              },
            ],
          },
        }),
      );
    });

    it('streams OpenAI Responses cumulative tool argument snapshots when the stream ends early', async () => {
      const response = createMockStreamResponse([
        'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","id":"fc_atars_1","call_id":"call_atars_1","name":"atars__get_multi_indicator","arguments":""}}\n\n',
        'data: {"type":"response.function_call_arguments.delta","output_index":0,"item_id":"fc_atars_1","delta":"{\\"symbol\\":\\"AAPL\\""}\n\n',
        'data: {"type":"response.function_call_arguments.delta","output_index":0,"item_id":"fc_atars_1","delta":"{\\"symbol\\":\\"AAPL\\",\\"indicators\\":[\\"rsi\\",\\"macd\\"]}"}\n\n',
      ]);
      mockFetch.mockResolvedValueOnce(response);

      const service = new LlmService(
        makeConfig({
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-openai',
          model: 'gpt-5.4',
        }),
      );
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'Use aTars' }])) {
        events.push(event);
      }

      const toolCalls = events.filter((e) => e.type === 'tool_call');
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].toolCall.id).toBe('call_atars_1');
      expect(toolCalls[0].toolCall.name).toBe('atars__get_multi_indicator');
      expect(toolCalls[0].toolCall.arguments).toBe('{"symbol":"AAPL","indicators":["rsi","macd"]}');
      expect(JSON.parse(toolCalls[0].toolCall.arguments)).toEqual({
        symbol: 'AAPL',
        indicators: ['rsi', 'macd'],
      });
      expect(events.find((e) => e.type === 'done')).toEqual(
        expect.objectContaining({
          type: 'done',
          completion: expect.objectContaining({
            completionStatus: 'incomplete',
          }),
        }),
      );
    });

    it('preserves OpenAI Responses replay from streamed output items when terminal output is empty', async () => {
      const response = createMockStreamResponse([
        'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","id":"fc_1","call_id":"call_1","name":"memory_recall","arguments":""}}\n\n',
        'data: {"type":"response.function_call_arguments.done","output_index":0,"item_id":"fc_1","name":"memory_recall","arguments":"{\\"subject\\":\\"locomo-user\\"}"}\n\n',
        'data: {"type":"response.output_item.done","output_index":0,"item":{"id":"fc_1","type":"function_call","call_id":"call_1","name":"memory_recall","arguments":"{\\"subject\\":\\"locomo-user\\"}","status":"completed"}}\n\n',
        'data: {"type":"response.completed","response":{"id":"resp_stream_empty_output","status":"completed","usage":{"input_tokens":10,"output_tokens":4}}}\n\n',
      ]);
      mockFetch.mockResolvedValueOnce(response);

      const service = new LlmService(
        makeConfig({
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-openai',
          model: 'gpt-5.4',
        }),
      );
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'Recall' }])) {
        events.push(event);
      }

      const toolCalls = events.filter((event) => event.type === 'tool_call');
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].toolCall).toMatchObject({
        id: 'call_1',
        name: 'memory_recall',
        arguments: '{"subject":"locomo-user"}',
      });
      expect(events.find((event) => event.type === 'done')).toEqual(
        expect.objectContaining({
          type: 'done',
          providerReplay: {
            openaiResponseId: 'resp_stream_empty_output',
            openaiResponseOutput: [
              {
                id: 'fc_1',
                type: 'function_call',
                call_id: 'call_1',
                name: 'memory_recall',
                arguments: '{"subject":"locomo-user"}',
                status: 'completed',
              },
            ],
          },
        }),
      );
    });

    it('preserves streamed OpenAI reasoning replay items when terminal output is empty', async () => {
      const response = createMockStreamResponse([
        'data: {"type":"response.output_item.added","output_index":0,"item":{"id":"rs_1","type":"reasoning","summary":[]}}\n\n',
        'data: {"type":"response.output_item.added","output_index":1,"item":{"type":"function_call","id":"fc_1","call_id":"call_1","name":"write_file","arguments":""}}\n\n',
        'data: {"type":"response.function_call_arguments.done","output_index":1,"item_id":"fc_1","name":"write_file","arguments":"{\\"path\\":\\"a.txt\\",\\"content\\":\\"ok\\"}"}\n\n',
        'data: {"type":"response.output_item.done","output_index":1,"item":{"id":"fc_1","type":"function_call","call_id":"call_1","name":"write_file","arguments":"{\\"path\\":\\"a.txt\\",\\"content\\":\\"ok\\"}","status":"completed"}}\n\n',
        'data: {"type":"response.completed","response":{"id":"resp_stream_empty_output","status":"completed","usage":{"input_tokens":10,"output_tokens":4}}}\n\n',
      ]);
      mockFetch.mockResolvedValueOnce(response);

      const service = new LlmService(
        makeConfig({
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-openai',
          model: 'gpt-5.4',
        }),
      );
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'Write' }])) {
        events.push(event);
      }

      expect(events.find((event) => event.type === 'done')).toEqual(
        expect.objectContaining({
          type: 'done',
          providerReplay: {
            openaiResponseId: 'resp_stream_empty_output',
            openaiResponseOutput: [
              { id: 'rs_1', type: 'reasoning', summary: [] },
              {
                id: 'fc_1',
                type: 'function_call',
                call_id: 'call_1',
                name: 'write_file',
                arguments: '{"path":"a.txt","content":"ok"}',
                status: 'completed',
              },
            ],
          },
        }),
      );
    });

    it('emits OpenAI reasoning summaries from the completed response when no summary deltas were streamed', async () => {
      const response = createMockStreamResponse([
        'data: {"type":"response.completed","response":{"status":"completed","output":[{"id":"rs_1","type":"reasoning","summary":[{"type":"summary_text","text":"Need plan"}]},{"id":"msg_1","type":"message","role":"assistant","content":[{"type":"output_text","text":"Answer","annotations":[]}]}],"output_text":"Answer","usage":{"input_tokens":10,"output_tokens":6}}}\n\n',
      ]);
      mockFetch.mockResolvedValueOnce(response);

      const service = new LlmService(
        makeConfig({
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-openai',
          model: 'gpt-5.4',
        }),
      );
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'Think' }])) {
        events.push(event);
      }

      expect(events.filter((e) => e.type === 'reasoning').map((e) => e.content)).toEqual([
        'Need plan',
      ]);
      expect(events.find((e) => e.type === 'done')).toEqual(
        expect.objectContaining({ type: 'done', content: 'Answer' }),
      );
    });

    it('marks OpenAI Responses incomplete terminal events as incomplete completions', async () => {
      const response = createMockStreamResponse([
        'data: {"type":"response.output_text.delta","item_id":"msg_1","output_index":0,"content_index":0,"delta":"Partial answer"}\n\n',
        'data: {"type":"response.incomplete","response":{"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"},"output":[{"id":"msg_1","type":"message","role":"assistant","content":[{"type":"output_text","text":"Partial answer","annotations":[]}]}],"output_text":"Partial answer"}}\n\n',
      ]);
      mockFetch.mockResolvedValueOnce(response);

      const service = new LlmService(
        makeConfig({
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-openai',
          model: 'gpt-5.4',
        }),
      );
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'Think' }])) {
        events.push(event);
      }

      expect(events.find((event) => event.type === 'done')).toEqual(
        expect.objectContaining({
          type: 'done',
          content: 'Partial answer',
          completion: {
            completionStatus: 'incomplete',
            finishReason: 'max_output_tokens',
          },
        }),
      );
    });
  });
});
