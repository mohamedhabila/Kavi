// ---------------------------------------------------------------------------
// Tests - LLM Service: streamMessage Anthropic thinking streams
// ---------------------------------------------------------------------------

import { LlmService, makeConfig, mockFetch } from '../../helpers/llmServiceHarness';

describe('LlmService', () => {
  describe('streamMessage Anthropic thinking streams', () => {
    it('marks Anthropic streams without message_stop as incomplete completions', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: undefined,
        text: () =>
          Promise.resolve(
            'event: message_start\n' +
              'data: {"type":"message_start","message":{"usage":{"input_tokens":9,"output_tokens":1}}}\n\n' +
              'event: content_block_start\n' +
              'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":"Partial answer"}}\n\n' +
              'event: message_delta\n' +
              'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":4}}\n\n',
          ),
      });

      const service = new LlmService(
        makeConfig({
          id: 'anthropic',
          name: 'Anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          apiKey: 'anthropic-key',
          model: 'claude-sonnet-4-6',
        }),
      );
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'Hi' }])) {
        events.push(event);
      }

      expect(events.find((event) => event.type === 'done')).toEqual(
        expect.objectContaining({
          type: 'done',
          content: 'Partial answer',
          completion: {
            completionStatus: 'incomplete',
            finishReason: 'stream_ended_without_message_stop',
          },
        }),
      );
    });

    it('preserves Anthropic tool input emitted on content_block_start before deltas', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: undefined,
        text: () =>
          Promise.resolve(
            'event: message_start\n' +
              'data: {"type":"message_start","message":{"usage":{"input_tokens":12,"output_tokens":1}}}\n\n' +
              'event: content_block_start\n' +
              'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"read_file","input":{"path":"notes.txt"}}}\n\n' +
              'event: content_block_stop\n' +
              'data: {"type":"content_block_stop","index":0}\n\n' +
              'event: message_delta\n' +
              'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":3}}\n\n' +
              'event: message_stop\n' +
              'data: {"type":"message_stop"}\n\n',
          ),
      });

      const service = new LlmService(
        makeConfig({
          id: 'anthropic',
          name: 'Anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          apiKey: 'anthropic-key',
          model: 'claude-sonnet-4-6',
        }),
      );
      const events: any[] = [];

      for await (const event of service.streamMessage([
        { role: 'user', content: 'Read the file.' },
      ])) {
        events.push(event);
      }

      expect(events.filter((event) => event.type === 'tool_call')).toHaveLength(1);
      expect(events.find((event) => event.type === 'tool_call')?.toolCall).toMatchObject({
        id: 'toolu_1',
        name: 'read_file',
        arguments: '{"path":"notes.txt"}',
        raw: {
          id: 'toolu_1',
          type: 'function',
          function: {
            name: 'read_file',
            arguments: '{"path":"notes.txt"}',
          },
        },
      });
      expect(events.findIndex((event) => event.type === 'tool_call')).toBeLessThan(
        events.findIndex((event) => event.type === 'done'),
      );
      expect(events.find((event) => event.type === 'done')).toEqual(
        expect.objectContaining({
          providerReplay: {
            anthropicBlocks: [
              { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'notes.txt' } },
            ],
          },
        }),
      );
    });

    it('preserves Anthropic thinking blocks and signatures in streamed tool-call metadata', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: undefined,
        text: () =>
          Promise.resolve(
            'event: message_start\n' +
              'data: {"type":"message_start","message":{"usage":{"input_tokens":12,"output_tokens":1}}}\n\n' +
              'event: content_block_start\n' +
              'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}\n\n' +
              'event: content_block_delta\n' +
              'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Need tool"}}\n\n' +
              'event: content_block_delta\n' +
              'data: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig-A"}}\n\n' +
              'event: content_block_stop\n' +
              'data: {"type":"content_block_stop","index":0}\n\n' +
              'event: content_block_start\n' +
              'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"read_file","input":{}}}\n\n' +
              'event: content_block_delta\n' +
              'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\"notes.txt\\"}"}}\n\n' +
              'event: content_block_stop\n' +
              'data: {"type":"content_block_stop","index":1}\n\n' +
              'event: message_delta\n' +
              'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":9}}\n\n' +
              'event: message_stop\n' +
              'data: {"type":"message_stop"}\n\n',
          ),
      });

      const service = new LlmService(
        makeConfig({
          id: 'anthropic',
          name: 'Anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          apiKey: 'anthropic-key',
          model: 'claude-sonnet-4-6',
        }),
      );
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'Hi' }], {
        thinking: { type: 'adaptive' },
      })) {
        events.push(event);
      }

      const toolCall = events.find((event) => event.type === 'tool_call')?.toolCall;
      expect(events.find((event) => event.type === 'reasoning')?.content).toBe('Need tool');
      expect(toolCall).toMatchObject({
        id: 'toolu_1',
        name: 'read_file',
        arguments: '{"path":"notes.txt"}',
        raw: {
          id: 'toolu_1',
          type: 'function',
          function: {
            name: 'read_file',
            arguments: '{"path":"notes.txt"}',
          },
        },
      });
      expect(events.findIndex((event) => event.type === 'tool_call')).toBeLessThan(
        events.findIndex((event) => event.type === 'done'),
      );
      expect(events.find((event) => event.type === 'done')).toEqual(
        expect.objectContaining({
          providerReplay: {
            anthropicBlocks: [
              { type: 'thinking', thinking: 'Need tool', signature: 'sig-A' },
              { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'notes.txt' } },
            ],
          },
        }),
      );
    });

    it('preserves Anthropic redacted thinking blocks in streamed tool-call metadata', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: undefined,
        text: () =>
          Promise.resolve(
            'event: message_start\n' +
              'data: {"type":"message_start","message":{"usage":{"input_tokens":12,"output_tokens":1}}}\n\n' +
              'event: content_block_start\n' +
              'data: {"type":"content_block_start","index":0,"content_block":{"type":"redacted_thinking","data":"opaque-redacted-thinking"}}\n\n' +
              'event: content_block_stop\n' +
              'data: {"type":"content_block_stop","index":0}\n\n' +
              'event: content_block_start\n' +
              'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"read_file","input":{}}}\n\n' +
              'event: content_block_delta\n' +
              'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\"notes.txt\\"}"}}\n\n' +
              'event: content_block_stop\n' +
              'data: {"type":"content_block_stop","index":1}\n\n' +
              'event: message_delta\n' +
              'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":9}}\n\n' +
              'event: message_stop\n' +
              'data: {"type":"message_stop"}\n\n',
          ),
      });

      const service = new LlmService(
        makeConfig({
          id: 'anthropic',
          name: 'Anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          apiKey: 'anthropic-key',
          model: 'claude-sonnet-4-6',
        }),
      );
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'Hi' }], {
        thinking: { type: 'adaptive' },
      })) {
        events.push(event);
      }

      const toolCall = events.find((event) => event.type === 'tool_call')?.toolCall;
      expect(events.find((event) => event.type === 'reasoning')).toBeUndefined();
      expect(toolCall).toMatchObject({
        id: 'toolu_1',
        name: 'read_file',
        arguments: '{"path":"notes.txt"}',
        raw: {
          id: 'toolu_1',
          type: 'function',
          function: {
            name: 'read_file',
            arguments: '{"path":"notes.txt"}',
          },
        },
      });
      expect(events.findIndex((event) => event.type === 'tool_call')).toBeLessThan(
        events.findIndex((event) => event.type === 'done'),
      );
      expect(events.find((event) => event.type === 'done')).toEqual(
        expect.objectContaining({
          providerReplay: {
            anthropicBlocks: [
              { type: 'redacted_thinking', data: 'opaque-redacted-thinking' },
              { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'notes.txt' } },
            ],
          },
        }),
      );
    });
  });
});
