// ---------------------------------------------------------------------------
// Tests - LLM Service: sendMessage chat-compatible basic requests
// ---------------------------------------------------------------------------

import {
  LlmService,
  makeConfig,
  makeOnDeviceConfig,
  mockFetch,
  mockSendLocalLlmMessage,
} from '../../helpers/llmServiceHarness';

describe('LlmService', () => {
  describe('sendMessage chat-compatible basic requests', () => {
    it('should send a chat completion request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ choices: [{ message: { content: 'Hello!' } }] }),
      });

      const service = new LlmService(makeConfig());
      await service.sendMessage([{ role: 'user', content: 'Hi' }]);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer sk-test-key',
          }),
        }),
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.model).toBe('test-model');
      expect(body.messages).toEqual([{ role: 'user', content: 'Hi' }]);
      expect(body.stream).toBe(false);
    });

    it('delegates on-device requests to the local runtime', async () => {
      const service = new LlmService(makeOnDeviceConfig());

      const localTool = {
        name: 'read_file',
        description: 'Read a file',
        input_schema: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      };
      const result = await service.sendMessage([{ role: 'user', content: 'Hi locally' }], {
        conversationId: 'conv-local-service',
        maxTokens: 512,
        temperature: 0.2,
        tools: [localTool],
      });

      expect(mockSendLocalLlmMessage).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'on-device', model: 'gemma-4-E2B-it' }),
        [{ role: 'user', content: 'Hi locally' }],
        [localTool],
        {
          conversationId: 'conv-local-service',
          maxTokens: 512,
          temperature: 0.2,
        },
      );
      expect(mockFetch).not.toHaveBeenCalled();
      expect(result?.choices?.[0]?.message?.content).toBe('Local reply');
    });

    it('should include tools in request when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ choices: [{ message: { content: 'ok' } }] }),
      });

      const service = new LlmService(makeConfig());
      await service.sendMessage([{ role: 'user', content: 'test' }], {
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
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tools).toHaveLength(1);
      expect(body.tools[0].type).toBe('function');
      expect(body.tools[0].function.name).toBe('read_file');
    });

    it('normalizes MCP-style array item schemas for compatible chat-completions providers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ choices: [{ message: { content: 'ok' } }] }),
      });

      const service = new LlmService(makeConfig());
      await service.sendMessage([{ role: 'user', content: 'Use aTars' }], {
        tools: [
          {
            name: 'mcp__atars__get_multi_indicator',
            description: 'Retrieve multiple indicators.',
            input_schema: {
              type: 'object',
              properties: {
                indicators: {
                  type: 'array',
                  items: {
                    title: 'Indicator',
                    enum: ['rsi', 'macd'],
                  },
                },
              },
              required: ['indicators'],
            },
          },
        ],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const parameters = body.tools[0].function.parameters;

      expect(parameters.properties.indicators.items.type).toBe('string');
      expect(parameters.properties.indicators.items.title).toBe('Indicator');
      expect(parameters.properties.indicators.items.enum).toEqual(['rsi', 'macd']);
    });

    it('flattens root oneOf tool schemas for compatible chat-completions providers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ choices: [{ message: { content: 'ok' } }] }),
      });

      const service = new LlmService(makeConfig());
      await service.sendMessage([{ role: 'user', content: 'Run JavaScript' }], {
        tools: [
          {
            name: 'javascript',
            description: 'Execute JavaScript.',
            strict: true,
            input_schema: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                path: { type: 'string' },
                env: {
                  type: 'object',
                  additionalProperties: { type: 'string' },
                },
              },
              oneOf: [{ required: ['code'] }, { required: ['path'] }],
              required: [],
            },
          },
        ],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const parameters = body.tools[0].function.parameters;

      expect(parameters.type).toBe('object');
      expect(parameters.oneOf).toBeUndefined();
      expect(parameters.anyOf).toBeUndefined();
      expect(parameters.allOf).toBeUndefined();
      expect(parameters.properties).toEqual(
        expect.objectContaining({
          code: { type: 'string' },
          path: { type: 'string' },
        }),
      );
      expect(parameters.properties.env.additionalProperties).toEqual({ type: 'string' });
    });

    it('should include tool_choice when tool execution is required', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ choices: [{ message: { content: 'ok' } }] }),
      });

      const service = new LlmService(makeConfig());
      await service.sendMessage([{ role: 'user', content: 'Read the file' }], {
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
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tool_choice).toBe('required');
    });

    it('should force one exact tool on compatible chat completions requests', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ choices: [{ message: { content: 'ok' } }] }),
      });

      const service = new LlmService(makeConfig());
      await service.sendMessage([{ role: 'user', content: 'Return the pilot report' }], {
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
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tool_choice).toEqual({ type: 'function', function: { name: 'pilot_report' } });
      expect(body.parallel_tool_calls).toBe(false);
    });
  });
});
