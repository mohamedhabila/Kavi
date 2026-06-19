// ---------------------------------------------------------------------------
// Tests - LLM Service: sendMessage OpenAI Responses basics
// ---------------------------------------------------------------------------

import {
  LlmService,
  makeConfig,
  makeOpenAIResponsesPayload,
  mockFetch,
} from '../../helpers/llmServiceHarness';
import { mergeOpenAIStreamToolCall } from '../../../src/services/llm/providers/openaiResponses/helpers';

describe('LlmService', () => {
  describe('sendMessage OpenAI Responses basics', () => {
    it('preserves accumulated OpenAI Responses tool arguments when later stream snapshots are partial', () => {
      const initial = mergeOpenAIStreamToolCall(undefined, {
        id: 'call_1',
        type: 'function',
        function: {
          name: 'calendar_create_event',
          arguments: JSON.stringify({
            title: 'E2E Native Review',
            startDate: '2026-06-10T09:00:00Z',
          }),
        },
      });

      const merged = mergeOpenAIStreamToolCall(initial, {
        id: 'call_1',
        type: 'function',
        function: {
          name: 'calendar_create_event',
          arguments: JSON.stringify({
            endDate: '2026-06-10T10:00:00Z',
            calendarId: 'default',
          }),
        },
      });

      expect(JSON.parse(merged.arguments)).toEqual({
        title: 'E2E Native Review',
        startDate: '2026-06-10T09:00:00Z',
        endDate: '2026-06-10T10:00:00Z',
        calendarId: 'default',
      });
    });

    it('opts into OpenAI reasoning summaries for reasoning models', async () => {
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

      await service.sendMessage([{ role: 'user', content: 'Think carefully' }], {
        reasoning_effort: 'medium',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.reasoning).toEqual({ effort: 'medium', summary: 'auto' });
    });

    it('adds OpenAI structured output schema via text.format and preserves the response ID', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve(
            makeOpenAIResponsesPayload({
              id: 'resp_structured_1',
              output: [
                {
                  id: 'msg_1',
                  type: 'message',
                  role: 'assistant',
                  content: [{ type: 'output_text', text: '{"approved":true}', annotations: [] }],
                },
              ],
              output_text: '{"approved":true}',
            }),
          ),
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

      const result = await service.sendMessage([{ role: 'user', content: 'Return JSON.' }], {
        structuredOutput: {
          name: 'pilot_report',
          mimeType: 'application/json',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              approved: { type: 'boolean' },
            },
            required: ['approved'],
          },
        },
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.reasoning).toEqual({ effort: 'none', summary: 'auto' });
      expect(body.text).toEqual(
        expect.objectContaining({
          format: expect.objectContaining({
            type: 'json_schema',
            name: 'pilot_report',
            strict: true,
            schema: expect.objectContaining({
              type: 'object',
              additionalProperties: false,
              required: ['approved'],
              properties: expect.objectContaining({
                approved: expect.objectContaining({ type: 'boolean' }),
              }),
            }),
          }),
        }),
      );
      expect(result?.id).toBe('resp_structured_1');
      expect(result?.output_parsed).toEqual({ approved: true });
      expect(result?.choices?.[0]?.message?.providerReplay).toEqual(
        expect.objectContaining({
          openaiResponseId: 'resp_structured_1',
        }),
      );
    });

    it('uses the Responses API for OpenAI providers and normalizes the result', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve(
            makeOpenAIResponsesPayload({
              output: [
                {
                  id: 'msg_1',
                  type: 'message',
                  role: 'assistant',
                  content: [{ type: 'output_text', text: 'Hello!', annotations: [] }],
                },
              ],
              output_text: 'Hello!',
            }),
          ),
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

      const result = await service.sendMessage([{ role: 'user', content: 'Hi' }]);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/responses',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer sk-openai',
          }),
        }),
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.model).toBe('gpt-5.4');
      expect(body.input).toEqual([{ role: 'user', content: 'Hi' }]);
      expect(body.messages).toBeUndefined();
      expect(body.stream).toBe(false);
      expect(body.store).toBe(false);
      expect(result?.choices?.[0]?.message?.content).toBe('Hello!');
      expect(result?.choices?.[0]?.message?.providerReplay).toEqual(
        expect.objectContaining({
          openaiResponseId: 'resp_test',
        }),
      );
      expect(result?.providerResponse).toEqual({
        provider: 'openai-responses',
        response: expect.objectContaining({
          id: 'resp_test',
        }),
      });
    });

    it('replays OpenAI Responses continuations statelessly for cacheable prefixes', async () => {
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
          { role: 'system', content: 'Return only JSON.' },
          { role: 'user', content: 'Assess the run.' },
          {
            role: 'assistant',
            content: 'The run is complete and verified.',
            providerReplay: {
              openaiResponseId: 'resp_prev_1',
              openaiResponseOutput: [
                {
                  id: 'msg_prev',
                  type: 'message',
                  role: 'assistant',
                  content: [
                    {
                      type: 'output_text',
                      text: 'The run is complete and verified.',
                      annotations: [],
                    },
                  ],
                },
              ],
            },
          } as any,
          {
            role: 'user',
            content: 'Your previous reply was not machine-readable. Return only raw JSON now.',
          },
        ],
        {
          structuredOutput: {
            name: 'pilot_report',
            mimeType: 'application/json',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                approved: { type: 'boolean' },
              },
              required: ['approved'],
            },
          },
        },
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.previous_response_id).toBeUndefined();
      expect(body.store).toBe(false);
      expect(body.instructions).toBe('Return only JSON.');
      expect(body.input).toEqual([
        { role: 'user', content: 'Assess the run.' },
        {
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'output_text',
              text: 'The run is complete and verified.',
              annotations: [],
            },
          ],
        },
        {
          role: 'user',
          content: 'Your previous reply was not machine-readable. Return only raw JSON now.',
        },
      ]);
    });
  });
});
