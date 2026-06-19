// ---------------------------------------------------------------------------
// Tests - LLM Service: sendMessage Gemini tool replay
// ---------------------------------------------------------------------------

import { LlmService, makeConfig, mockFetch } from '../../helpers/llmServiceHarness';

describe('LlmService', () => {
  describe('sendMessage Gemini tool replay', () => {
    it('replays Gemini tool history natively with functionCall and functionResponse parts', async () => {
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
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Read file a.txt' },
          {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'tc1',
                type: 'function',
                function: { name: 'read_file', arguments: '{"path":"a.txt"}' },
                extra_content: { google: { thought_signature: 'sig-A' } },
              },
            ],
          } as any,
          {
            role: 'tool',
            content: 'Error: a missing',
            tool_call_id: 'tc1',
            is_error: true,
            name: 'read_file',
          } as any,
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

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const firstBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(firstBody.systemInstruction).toEqual({
        parts: [{ text: 'You are helpful.' }],
      });
      expect(firstBody.contents).toEqual([
        {
          role: 'user',
          parts: [{ text: 'Read file a.txt' }],
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
              thoughtSignature: 'sig-A',
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
                response: { error: 'Error: a missing' },
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

    it('omits unsupported function ids for Vertex Gemini native replay', async () => {
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
          baseUrl: 'https://aiplatform.googleapis.com/v1',
          apiKey: 'AIza-test',
          model: 'gemini-3.5-flash',
        }),
      );

      await service.sendMessage(
        [
          { role: 'user', content: 'Read file a.txt' },
          {
            role: 'assistant',
            content: '',
            providerReplay: {
              geminiParts: [
                {
                  functionCall: {
                    id: 'tc1',
                    name: 'read_file',
                    args: { path: 'a.txt' },
                  },
                  thoughtSignature: 'sig-A',
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
            {
              functionCall: {
                name: 'read_file',
                args: { path: 'a.txt' },
              },
              thoughtSignature: 'sig-A',
            },
          ],
        },
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
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

    it('replays Gemini parallel tool calls with raw thought signatures when providerReplay is absent', async () => {
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
          { role: 'user', content: 'Read files a.txt and b.txt' },
          {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'tc1',
                type: 'function',
                function: { name: 'read_file', arguments: '{"path":"a.txt"}' },
                extra_content: { google: { thought_signature: 'sig-parallel-1' } },
              },
              {
                id: 'tc2',
                type: 'function',
                function: { name: 'read_file', arguments: '{"path":"b.txt"}' },
              },
            ],
          } as any,
          { role: 'tool', content: 'A contents', tool_call_id: 'tc1', name: 'read_file' } as any,
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
          parts: [{ text: 'Read files a.txt and b.txt' }],
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
              thoughtSignature: 'sig-parallel-1',
            },
            {
              functionCall: {
                id: 'tc2',
                name: 'read_file',
                args: { path: 'b.txt' },
              },
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
  });
});
