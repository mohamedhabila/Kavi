// ---------------------------------------------------------------------------
// Tests - LLM Service: sendMessage OpenAI Responses replay
// ---------------------------------------------------------------------------

import {
  LlmService,
  makeConfig,
  makeOpenAIResponsesPayload,
  makeExpoFailureToolResult,
  mockFetch,
} from '../../helpers/llmServiceHarness';

describe('LlmService', () => {
  describe('sendMessage OpenAI Responses replay', () => {
    it('replays OpenAI tool history as Responses input items', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(makeOpenAIResponsesPayload()),
      });

      const service = new LlmService(
        makeConfig({
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-openai',
          model: 'gpt-5.4',
        }),
      );

      await service.sendMessage(
        [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Read notes.txt' },
          {
            role: 'assistant',
            content: 'Checking the file.',
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'read_file', arguments: '{"path":"notes.txt"}' },
                _openai: {
                  itemId: 'fc_1',
                  callId: 'call_1',
                  reasoningItems: [
                    {
                      id: 'rs_1',
                      type: 'reasoning',
                      content: [],
                      summary: [],
                    },
                  ],
                },
              },
            ],
          } as any,
          { role: 'tool', tool_call_id: 'call_1', content: 'file contents' },
        ],
        {
          tools: [
            {
              name: 'read_file',
              description: 'Read a file',
              input_schema: {
                type: 'object',
                properties: { path: { type: 'string' } },
                required: ['path'],
              },
            },
          ],
          toolChoice: 'required',
        },
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.instructions).toBe('You are helpful.');
      expect(body.tool_choice).toBe('required');
      expect(body.input).toEqual([
        { role: 'user', content: 'Read notes.txt' },
        { id: 'rs_1', type: 'reasoning', content: [], summary: [] },
        { role: 'assistant', content: 'Checking the file.' },
        {
          type: 'function_call',
          id: 'fc_1',
          call_id: 'call_1',
          name: 'read_file',
          arguments: '{"path":"notes.txt"}',
          status: 'completed',
        },
        {
          type: 'function_call_output',
          call_id: 'call_1',
          output: 'file contents',
        },
      ]);
    });

    it('forces one exact OpenAI Responses tool when requested', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            output: [
              {
                id: 'msg_1',
                type: 'message',
                role: 'assistant',
                content: [{ type: 'output_text', text: 'ok' }],
              },
            ],
            output_text: 'ok',
          }),
      });

      const service = new LlmService(
        makeConfig({
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-openai',
          model: 'gpt-5.4',
        }),
      );

      const result = await service.sendMessage(
        [{ role: 'user', content: 'Return the pilot report.' }],
        {
          tools: [
            {
              name: 'pilot_report',
              description: 'Return the pilot report',
              input_schema: {
                type: 'object',
                properties: { approved: { type: 'boolean' } },
                required: ['approved'],
                additionalProperties: false,
              },
            },
          ],
          toolChoice: { type: 'tool', name: 'pilot_report', disableParallelToolUse: true },
        },
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tool_choice).toEqual({ type: 'function', name: 'pilot_report' });
      expect(body.parallel_tool_calls).toBe(false);
      expect(result?.choices?.[0]?.message?.content).toBe('ok');
    });

    it('replays exact OpenAI assistant output items when provider replay is available', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(makeOpenAIResponsesPayload()),
      });

      const service = new LlmService(
        makeConfig({
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-openai',
          model: 'gpt-5.4',
        }),
      );

      await service.sendMessage([
        { role: 'user', content: 'First question' },
        {
          role: 'assistant',
          content: 'Flattened fallback',
          providerReplay: {
            openaiResponseOutput: [
              {
                id: 'rs_prev',
                type: 'reasoning',
                summary: [{ type: 'summary_text', text: 'Need plan' }],
              },
              {
                id: 'msg_prev',
                type: 'message',
                role: 'assistant',
                content: [{ type: 'output_text', text: 'First answer', annotations: [] }],
              },
            ],
          },
        } as any,
        { role: 'user', content: 'Second question' },
      ]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.input).toEqual([
        { role: 'user', content: 'First question' },
        {
          type: 'reasoning',
          summary: [{ type: 'summary_text', text: 'Need plan' }],
        },
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'First answer', annotations: [] }],
        },
        { role: 'user', content: 'Second question' },
      ]);
    });

    it('reconstructs OpenAI tool turns when replayed output misses required reasoning items', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(makeOpenAIResponsesPayload()),
      });

      const service = new LlmService(
        makeConfig({
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-openai',
          model: 'gpt-5.4',
        }),
      );

      await service.sendMessage([
        { role: 'user', content: 'Read notes.txt' },
        {
          role: 'assistant',
          content: 'Checking the file.',
          providerReplay: {
            openaiResponseOutput: [
              {
                id: 'fc_1',
                type: 'function_call',
                call_id: 'call_1',
                name: 'read_file',
                arguments: '{"path":"notes.txt"}',
                status: 'completed',
              },
              {
                id: 'msg_prev',
                type: 'message',
                role: 'assistant',
                content: [{ type: 'output_text', text: 'Fallback text', annotations: [] }],
              },
            ],
          },
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'read_file', arguments: '{"path":"notes.txt"}' },
              _openai: {
                callId: 'call_1',
                itemId: 'fc_1',
                reasoningItems: [{ id: 'rs_1', type: 'reasoning', summary: [] }],
              },
            },
          ],
        } as any,
        { role: 'tool', tool_call_id: 'call_1', content: 'file contents' },
        { role: 'user', content: 'What does it say?' },
      ]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.input).toEqual([
        { role: 'user', content: 'Read notes.txt' },
        { id: 'rs_1', type: 'reasoning', summary: [] },
        { role: 'assistant', content: 'Checking the file.' },
        {
          type: 'function_call',
          id: 'fc_1',
          call_id: 'call_1',
          name: 'read_file',
          arguments: '{"path":"notes.txt"}',
          status: 'completed',
        },
        {
          type: 'function_call_output',
          call_id: 'call_1',
          output: 'file contents',
        },
        { role: 'user', content: 'What does it say?' },
      ]);
    });

    it('replays malformed OpenAI reasoning tool history as raw function_call items instead of textifying it', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(makeOpenAIResponsesPayload()),
      });

      const service = new LlmService(
        makeConfig({
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-openai',
          model: 'gpt-5.4',
        }),
      );

      await service.sendMessage([
        { role: 'user', content: 'Read notes.txt' },
        {
          role: 'assistant',
          content: '',
          providerReplay: {
            openaiResponseOutput: [
              {
                id: 'fc_1',
                type: 'function_call',
                call_id: 'call_1',
                name: 'read_file',
                arguments: '{"path":"notes.txt"}',
                status: 'completed',
              },
            ],
          },
        } as any,
        { role: 'tool', tool_call_id: 'call_1', content: 'file contents' },
        { role: 'user', content: 'What does it say?' },
      ]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.input).toEqual([
        { role: 'user', content: 'Read notes.txt' },
        {
          type: 'function_call',
          call_id: 'call_1',
          name: 'read_file',
          arguments: '{"path":"notes.txt"}',
          status: 'completed',
        },
        { type: 'function_call_output', call_id: 'call_1', output: 'file contents' },
        { role: 'user', content: 'What does it say?' },
      ]);
    });

    it('does not continue from or replay unmatched OpenAI function calls', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(makeOpenAIResponsesPayload()),
      });

      const service = new LlmService(
        makeConfig({
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-openai',
          model: 'gpt-5.4',
        }),
      );

      await service.sendMessage([
        { role: 'user', content: 'Read notes.txt' },
        {
          role: 'assistant',
          content: 'Checking the file.',
          providerReplay: {
            openaiResponseId: 'resp_tool_without_output',
            openaiResponseOutput: [
              {
                id: 'fc_orphan',
                type: 'function_call',
                call_id: 'call_orphan',
                name: 'read_file',
                arguments: '{"path":"notes.txt"}',
                status: 'completed',
              },
            ],
          },
          tool_calls: [
            {
              id: 'call_orphan',
              type: 'function',
              function: { name: 'read_file', arguments: '{"path":"notes.txt"}' },
            },
          ],
        } as any,
        { role: 'user', content: 'What happened?' },
      ]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.previous_response_id).toBeUndefined();
      expect(body.input).toEqual([
        { role: 'user', content: 'Read notes.txt' },
        { role: 'assistant', content: 'Checking the file.' },
        { role: 'user', content: 'What happened?' },
      ]);
    });

    it('replays OpenAI function-call responses when matching tool outputs follow', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(makeOpenAIResponsesPayload()),
      });

      const service = new LlmService(
        makeConfig({
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-openai',
          model: 'gpt-5.4',
        }),
      );

      await service.sendMessage([
        { role: 'user', content: 'Read notes.txt' },
        {
          role: 'assistant',
          content: '',
          providerReplay: {
            openaiResponseId: 'resp_tool_with_output',
            openaiResponseOutput: [
              {
                id: 'fc_prev',
                type: 'function_call',
                call_id: 'call_prev',
                name: 'read_file',
                arguments: '{"path":"notes.txt"}',
                status: 'completed',
              },
            ],
          },
          tool_calls: [
            {
              id: 'call_prev',
              type: 'function',
              function: { name: 'read_file', arguments: '{"path":"notes.txt"}' },
            },
          ],
        } as any,
        { role: 'tool', tool_call_id: 'call_prev', content: 'file contents' },
        { role: 'user', content: 'What does it say?' },
      ]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.previous_response_id).toBeUndefined();
      expect(body.store).toBe(false);
      expect(body.input).toEqual([
        { role: 'user', content: 'Read notes.txt' },
        {
          type: 'function_call',
          call_id: 'call_prev',
          name: 'read_file',
          arguments: '{"path":"notes.txt"}',
          status: 'completed',
        },
        { type: 'function_call_output', call_id: 'call_prev', output: 'file contents' },
        { role: 'user', content: 'What does it say?' },
      ]);
    });

    it('replays Expo failure tool results to OpenAI Responses unchanged', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(makeOpenAIResponsesPayload()),
      });

      const expoFailureResult = makeExpoFailureToolResult();
      const expoFailureText = JSON.stringify(expoFailureResult);
      const service = new LlmService(
        makeConfig({
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-openai',
          model: 'gpt-5.4',
        }),
      );

      await service.sendMessage(
        [
          { role: 'user', content: 'Check Expo workflow status.' },
          {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_expo_1',
                type: 'function',
                function: {
                  name: 'expo_eas_workflow_status',
                  arguments: '{"projectId":"expo-1","runId":"workflow-run-77"}',
                },
                _openai: { callId: 'call_expo_1' },
              },
            ],
          } as any,
          {
            role: 'tool',
            tool_call_id: 'call_expo_1',
            name: 'expo_eas_workflow_status',
            content: expoFailureText,
          } as any,
        ],
        {
          tools: [
            {
              name: 'expo_eas_workflow_status',
              description: 'Inspect Expo workflow status.',
              input_schema: {
                type: 'object',
                properties: {
                  projectId: { type: 'string' },
                  runId: { type: 'string' },
                },
                required: ['projectId'],
              },
            },
          ],
        },
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.input).toEqual([
        { role: 'user', content: 'Check Expo workflow status.' },
        {
          type: 'function_call',
          call_id: 'call_expo_1',
          name: 'expo_eas_workflow_status',
          arguments: '{"projectId":"expo-1","runId":"workflow-run-77"}',
          status: 'completed',
        },
        {
          type: 'function_call_output',
          call_id: 'call_expo_1',
          output: expoFailureText,
        },
      ]);
    });

    it('converts OpenAI multimodal content to Responses input parts', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(makeOpenAIResponsesPayload()),
      });

      const service = new LlmService(
        makeConfig({
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-openai',
          model: 'gpt-5.4',
        }),
      );

      await service.sendMessage([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this image.' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,abc', detail: 'high' } },
          ],
        },
      ] as any);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.input).toEqual([
        {
          role: 'user',
          content: [
            { type: 'input_text', text: 'Describe this image.' },
            { type: 'input_image', image_url: 'data:image/png;base64,abc', detail: 'high' },
          ],
        },
      ]);
    });
  });
});
