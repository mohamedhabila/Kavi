// ---------------------------------------------------------------------------
// Tests - LLM Service: sendMessage Gemini tool results
// ---------------------------------------------------------------------------

import {
  LlmService,
  makeConfig,
  makeExpoFailureToolResult,
  mockFetch,
} from '../../helpers/llmServiceHarness';

describe('LlmService', () => {
  describe('sendMessage Gemini tool results', () => {
    it('replays Expo failure tool results to Gemini functionResponse payloads as structured JSON', async () => {
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

      const expoFailureResult = makeExpoFailureToolResult();
      const expoFailureText = JSON.stringify(expoFailureResult);
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
          { role: 'user', content: 'Check Expo workflow status.' },
          {
            role: 'assistant',
            content: '',
            providerReplay: {
              geminiParts: [
                {
                  functionCall: {
                    id: 'expo_tc1',
                    name: 'expo_eas_workflow_status',
                    args: { projectId: 'expo-1', runId: 'workflow-run-77' },
                  },
                  thoughtSignature: 'sig-expo-1',
                },
              ],
            },
            tool_calls: [
              {
                id: 'expo_tc1',
                type: 'function',
                function: {
                  name: 'expo_eas_workflow_status',
                  arguments: '{"projectId":"expo-1","runId":"workflow-run-77"}',
                },
              },
            ],
          } as any,
          {
            role: 'tool',
            tool_call_id: 'expo_tc1',
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
        } as any,
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const responsePart = body.contents
        .flatMap((entry: any) => entry.parts || [])
        .find((part: any) => part.functionResponse?.name === 'expo_eas_workflow_status');

      expect(responsePart).toEqual({
        functionResponse: {
          id: 'expo_tc1',
          name: 'expo_eas_workflow_status',
          response: expoFailureResult,
        },
      });
    });

    it('replays signed Gemini tool calls without replaying hidden thought text from the prior tool turn', async () => {
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

      await service.sendMessage(
        [
          { role: 'user', content: 'Find the docs.' },
          {
            role: 'assistant',
            content: '',
            providerReplay: {
              geminiParts: [
                {
                  text: 'I should keep searching until I verify the exact docs host.',
                  thought: true,
                },
                {
                  functionCall: {
                    id: 'tc1',
                    name: 'web_search',
                    args: { queries: ['OpenAI structured outputs official docs'] },
                  },
                  thoughtSignature: 'sig-search-1',
                },
              ],
            },
            tool_calls: [
              {
                id: 'tc1',
                type: 'function',
                function: {
                  name: 'web_search',
                  arguments: '{"queries":["OpenAI structured outputs official docs"]}',
                },
              },
            ],
          } as any,
          {
            role: 'tool',
            tool_call_id: 'tc1',
            name: 'web_search',
            content: JSON.stringify({
              provider: 'gemini',
              searches: [
                {
                  query: 'OpenAI structured outputs official docs',
                  results: [
                    {
                      title: 'developers.openai.com / api / docs / guides / structured outputs',
                      url: 'https://developers.openai.com/api/docs/guides/structured-outputs',
                    },
                  ],
                },
              ],
            }),
          } as any,
        ],
        {
          tools: [
            {
              name: 'web_search',
              description: 'Search the web.',
              input_schema: {
                type: 'object',
                properties: {
                  queries: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                },
                required: ['queries'],
              },
            },
          ],
        } as any,
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const modelParts = body.contents.find((entry: any) => entry.role === 'model')?.parts ?? [];
      expect(modelParts).toEqual([
        {
          text: 'I should keep searching until I verify the exact docs host.',
          thought: true,
        },
        {
          functionCall: {
            id: 'tc1',
            name: 'web_search',
            args: { queries: ['OpenAI structured outputs official docs'] },
          },
          thoughtSignature: 'sig-search-1',
        },
      ]);
    });

    it('normalizes Gemini native function-call responses back into assistant tool_calls', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            candidates: [
              {
                content: {
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
                finishReason: 'STOP',
              },
            ],
            usageMetadata: {
              promptTokenCount: 10,
              candidatesTokenCount: 3,
              totalTokenCount: 13,
            },
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

      const result = await service.sendMessage([{ role: 'user', content: 'Read a.txt' }], {
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
      } as any);

      expect(result.choices[0].message.tool_calls).toEqual([
        expect.objectContaining({
          id: 'tc1',
          function: expect.objectContaining({
            name: 'read_file',
          }),
          raw: expect.objectContaining({
            function: expect.objectContaining({
              name: 'read_file',
              arguments: '{"path":"a.txt"}',
            }),
          }),
        }),
      ]);
      expect(JSON.parse(result.choices[0].message.tool_calls[0].function.arguments)).toEqual({
        path: 'a.txt',
      });
      expect(result.choices[0].message.providerReplay).toEqual({
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
      });
      expect(result.usage).toEqual(
        expect.objectContaining({
          prompt_tokens: 10,
          completion_tokens: 3,
          total_tokens: 13,
        }),
      );
    });
  });
});
