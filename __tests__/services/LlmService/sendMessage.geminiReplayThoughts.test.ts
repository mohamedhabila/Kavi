// ---------------------------------------------------------------------------
// Tests - LLM Service: sendMessage Gemini sequential replay and thoughts
// ---------------------------------------------------------------------------

import { LlmService, makeConfig, mockFetch } from '../../helpers/llmServiceHarness';

describe('LlmService', () => {
  describe('sendMessage Gemini sequential replay and thoughts', () => {
    it('replays Gemini sequential tool turns with raw thought signatures when providerReplay is absent', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            candidates: [
              {
                content: { parts: [{ text: 'Recovered' }] },
                finishReason: 'STOP',
              },
            ],
          }),
      });

      const service = new LlmService(
        makeConfig({
          id: 'gemini',
          name: 'Gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
          apiKey: 'AIza-test',
          model: 'gemini-3.1-pro-preview',
        }),
      );

      await service.sendMessage(
        [
          { role: 'user', content: 'Inspect both files' },
          {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'tc1',
                type: 'function',
                function: { name: 'read_file', arguments: '{"path":"a.txt"}' },
                extra_content: { google: { thought_signature: 'sig-seq-1' } },
              },
            ],
          } as any,
          { role: 'tool', content: 'A contents', tool_call_id: 'tc1', name: 'read_file' } as any,
          {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'tc2',
                type: 'function',
                function: { name: 'read_file', arguments: '{"path":"b.txt"}' },
                extra_content: { google: { thought_signature: 'sig-seq-2' } },
              },
            ],
          } as any,
          { role: 'tool', content: 'B contents', tool_call_id: 'tc2', name: 'read_file' } as any,
          { role: 'user', content: 'Summarize the files' },
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
        } as any,
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.contents).toEqual([
        {
          role: 'user',
          parts: [{ text: 'Inspect both files' }],
        },
        {
          role: 'model',
          parts: [
            {
              functionCall: {
                id: 'tc1',
                name: 'read_file',
                args: { path: 'a.txt' },
              },
              thoughtSignature: 'sig-seq-1',
            },
          ],
        },
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
                id: 'tc1',
                name: 'read_file',
                response: { result: 'A contents' },
              },
            },
          ],
        },
        {
          role: 'model',
          parts: [
            {
              functionCall: {
                id: 'tc2',
                name: 'read_file',
                args: { path: 'b.txt' },
              },
              thoughtSignature: 'sig-seq-2',
            },
          ],
        },
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
                id: 'tc2',
                name: 'read_file',
                response: { result: 'B contents' },
              },
            },
          ],
        },
        {
          role: 'user',
          parts: [{ text: 'Summarize the files' }],
        },
      ]);
    });

    it('replays raw Gemini tool call and tool result structure when providerReplay is unavailable', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            candidates: [
              {
                content: { parts: [{ text: 'Recovered' }] },
                finishReason: 'STOP',
              },
            ],
          }),
      });

      const service = new LlmService(
        makeConfig({
          id: 'gemini',
          name: 'Gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
          apiKey: 'AIza-test',
          model: 'gemini-3.1-pro-preview',
        }),
      );

      await service.sendMessage(
        [
          { role: 'user', content: 'Read file a.txt' },
          {
            role: 'assistant',
            content: 'Planning: inspect the file.',
            tool_calls: [
              {
                id: 'tc1',
                type: 'function',
                function: { name: 'read_file', arguments: '{"path":"a.txt"}' },
                raw: { thoughtSignature: 'sig-tc1' },
              },
            ],
          } as any,
          { role: 'tool', content: 'A contents', tool_call_id: 'tc1', name: 'read_file' } as any,
          { role: 'user', content: 'Try again' },
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
        } as any,
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.contents).toEqual([
        {
          role: 'user',
          parts: [{ text: 'Read file a.txt' }],
        },
        {
          role: 'model',
          parts: [
            { text: 'Planning: inspect the file.' },
            {
              functionCall: {
                id: 'tc1',
                name: 'read_file',
                args: { path: 'a.txt' },
              },
              thoughtSignature: 'sig-tc1',
            },
          ],
        },
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
                id: 'tc1',
                name: 'read_file',
                response: { result: 'A contents' },
              },
            },
          ],
        },
        {
          role: 'user',
          parts: [{ text: 'Try again' }],
        },
      ]);
    });

    it('replays persisted Gemini thought parts with signatures on later turns', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            candidates: [
              {
                content: { parts: [{ text: 'Recovered' }] },
                finishReason: 'STOP',
              },
            ],
          }),
      });

      const service = new LlmService(
        makeConfig({
          id: 'gemini',
          name: 'Gemini',
          baseUrl: 'https://generativelanguage.googleapis.com',
          apiKey: 'AIza-test',
          model: 'gemini-2.5-pro',
        }),
      );

      await service.sendMessage([
        { role: 'user', content: 'First turn' },
        {
          role: 'assistant',
          content: 'Visible answer',
          providerReplay: {
            geminiParts: [
              { text: 'Need plan', thought: true, thoughtSignature: 'sig-think-1' },
              { text: 'Visible answer' },
            ],
          },
        } as any,
        { role: 'user', content: 'Second turn' },
      ]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.contents).toEqual([
        {
          role: 'user',
          parts: [{ text: 'First turn' }],
        },
        {
          role: 'model',
          parts: [
            { text: 'Need plan', thought: true, thoughtSignature: 'sig-think-1' },
            { text: 'Visible answer' },
          ],
        },
        {
          role: 'user',
          parts: [{ text: 'Second turn' }],
        },
      ]);
    });
  });
});
