// ---------------------------------------------------------------------------
// Tests - LLM Service: sendMessage Gemini schemas
// ---------------------------------------------------------------------------

import { LlmService, makeConfig, mockFetch } from '../../helpers/llmServiceHarness';
import { UPDATE_GOALS_TOOL } from '../../../src/engine/tools/goal-definitions';

describe('LlmService', () => {
  describe('sendMessage Gemini schemas', () => {
    it('uses Gemini native generateContent with system instructions, tools, and native thinking config', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            candidates: [
              {
                content: { parts: [{ text: 'ok' }] },
                finishReason: 'STOP',
              },
            ],
            usageMetadata: {
              promptTokenCount: 8,
              candidatesTokenCount: 2,
              totalTokenCount: 10,
            },
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
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Use the tool' },
        ],
        {
          thinking: { thinkingBudget: 8192 },
          tools: [
            {
              name: 'search_docs',
              description: 'Search docs',
              strict: true,
              input_schema: {
                type: 'object',
                properties: [] as any,
                required: [],
              },
            },
          ],
        },
      );

      expect(mockFetch).toHaveBeenCalledWith(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'x-goog-api-key': 'AIza-test',
          }),
        }),
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.systemInstruction).toEqual({
        parts: [{ text: 'You are helpful.' }],
      });
      expect(body.contents).toEqual([
        {
          role: 'user',
          parts: [{ text: 'Use the tool' }],
        },
      ]);
      expect(body.generationConfig).toEqual(
        expect.objectContaining({
          maxOutputTokens: 32000,
          thinkingConfig: { thinkingBudget: 8192, includeThoughts: true },
        }),
      );
      expect(body.tools).toEqual([
        {
          functionDeclarations: [
            expect.objectContaining({
              name: 'search_docs',
              parameters: expect.objectContaining({
                properties: {},
              }),
            }),
          ],
        },
      ]);
      expect(body.tools[0].functionDeclarations[0].parameters.required).toBeUndefined();
      expect(body.toolConfig).toEqual({
        functionCallingConfig: { mode: 'AUTO' },
      });
    });

    it('strips unsupported additionalProperties fields from Gemini native tool schemas', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            candidates: [
              {
                content: { parts: [{ text: 'ok' }] },
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
          model: 'gemini-3-flash-preview',
        }),
      );

      await service.sendMessage(
        [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Use the tool' },
        ],
        {
          tools: [
            {
              name: 'update_config',
              description: 'Update configuration values.',
              input_schema: {
                type: 'object',
                properties: {
                  path: { type: 'string' },
                  options: {
                    type: 'object',
                    properties: {
                      mode: { type: 'string' },
                    },
                    required: ['mode'],
                    additionalProperties: false,
                  },
                  headers: {
                    type: 'object',
                    additionalProperties: { type: 'string' },
                  },
                  changes: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        key: { type: 'string' },
                      },
                      required: ['key'],
                      additionalProperties: false,
                    },
                  },
                },
                required: ['path'],
                additionalProperties: false,
              },
            },
          ],
        },
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const parameters = body.tools[0].functionDeclarations[0].parameters;

      expect(parameters.additionalProperties).toBeUndefined();
      expect(parameters.properties.options.additionalProperties).toBeUndefined();
      expect(parameters.properties.headers.additionalProperties).toBeUndefined();
      expect(parameters.properties.changes.items.additionalProperties).toBeUndefined();
      expect(parameters.properties.headers.type).toBe('object');
    });

    it('normalizes MCP-style array item schemas for Gemini tool declarations', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            candidates: [
              {
                content: { parts: [{ text: 'ok' }] },
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
          model: 'gemini-3-flash-preview',
        }),
      );

      await service.sendMessage(
        [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Use the tool' },
        ],
        {
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
        },
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const parameters = body.tools[0].functionDeclarations[0].parameters;

      expect(parameters.properties.indicators.items.type).toBe('string');
      expect(parameters.properties.indicators.items.title).toBe('Indicator');
      expect(parameters.properties.indicators.items.enum).toEqual(['rsi', 'macd']);
    });

    it('sends canonical root update_goals schema for Gemini native tool declarations', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            candidates: [
              {
                content: { parts: [{ text: 'ok' }] },
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
          model: 'gemini-3-flash-preview',
        }),
      );

      await service.sendMessage([{ role: 'user', content: 'Track this goal' }], {
        tools: [UPDATE_GOALS_TOOL],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const parameters = body.tools[0].functionDeclarations[0].parameters;

      expect(parameters.required).toEqual(expect.arrayContaining(['action', 'id', 'name']));
      expect(parameters.properties.goals).toBeUndefined();
      expect(parameters.properties.id).toEqual(expect.objectContaining({ type: 'string' }));
      expect(parameters.properties.name).toEqual(expect.objectContaining({ type: 'string' }));
      expect(parameters.properties.completionPolicy.enum).toEqual(['blocking', 'persistent']);
    });

    it('flattens root oneOf tool schemas for Gemini tool declarations', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            candidates: [
              {
                content: { parts: [{ text: 'ok' }] },
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
          model: 'gemini-3-flash-preview',
        }),
      );

      await service.sendMessage(
        [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Use the tool' },
        ],
        {
          tools: [
            {
              name: 'javascript',
              description: 'Execute JavaScript.',
              input_schema: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  path: { type: 'string' },
                  timeoutMs: { type: ['number', 'null'] },
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
        },
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const parameters = body.tools[0].functionDeclarations[0].parameters;

      expect(parameters.type).toBe('object');
      expect(parameters.oneOf).toBeUndefined();
      expect(parameters.anyOf).toBeUndefined();
      expect(parameters.allOf).toBeUndefined();
      expect(parameters.properties.code).toEqual({ type: 'string' });
      expect(parameters.properties.path).toEqual({ type: 'string' });
      expect(parameters.properties.timeoutMs.type).toBe('number');
      expect(parameters.properties.timeoutMs.nullable).toBe(true);
      expect(parameters.properties.env.additionalProperties).toBeUndefined();
    });

    it('drops non-string Gemini enums while preserving them as description hints', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            candidates: [
              {
                content: { parts: [{ text: 'ok' }] },
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
          model: 'gemini-3-flash-preview',
        }),
      );

      await service.sendMessage(
        [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Use the tool' },
        ],
        {
          tools: [
            {
              name: 'pilot_report',
              description: 'Return the structured pilot governance assessment for the current run.',
              input_schema: {
                type: 'object',
                properties: {
                  recommendedAction: {
                    type: 'string',
                    enum: ['finalize', 'continue', 'blocked'],
                  },
                  completionScore: {
                    type: 'integer',
                    enum: [0, 1, 2, 3, 4, 5],
                    description: 'Completion score.',
                  },
                  criterionEvaluations: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        score: {
                          type: 'integer',
                          enum: [0, 1, 2, 3, 4, 5],
                        },
                        status: {
                          type: 'string',
                          enum: ['met', 'partial', 'unmet', 'blocked'],
                        },
                      },
                      required: ['score', 'status'],
                    },
                  },
                },
                required: ['recommendedAction', 'completionScore', 'criterionEvaluations'],
              },
            },
          ],
          toolChoice: 'required',
        },
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const parameters = body.tools[0].functionDeclarations[0].parameters;

      expect(parameters.properties.recommendedAction.enum).toEqual([
        'finalize',
        'continue',
        'blocked',
      ]);
      expect(parameters.properties.completionScore.type).toBe('integer');
      expect(parameters.properties.completionScore.enum).toBeUndefined();
      expect(parameters.properties.completionScore.description).toContain('Completion score.');
      expect(parameters.properties.completionScore.description).toContain(
        'Allowed values: 0, 1, 2, 3, 4, 5.',
      );
      expect(
        parameters.properties.criterionEvaluations.items.properties.score.enum,
      ).toBeUndefined();
      expect(
        parameters.properties.criterionEvaluations.items.properties.score.description,
      ).toContain('Allowed values: 0, 1, 2, 3, 4, 5.');
      expect(parameters.properties.criterionEvaluations.items.properties.status.enum).toEqual([
        'met',
        'partial',
        'unmet',
        'blocked',
      ]);
      expect(body.toolConfig).toEqual({
        functionCallingConfig: { mode: 'ANY' },
      });
    });

    it('preserves detailed Gemini function descriptions', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            candidates: [
              {
                content: { parts: [{ text: 'ok' }] },
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
          model: 'gemini-3-flash-preview',
        }),
      );

      const detailedDescription = [
        'Inspect mobile build logs and identify the failing step.',
        'Use this when the user asks for root-cause analysis of an Android or iOS build failure.',
        'Return the exact failing command, the first verified cause, and the most likely fix.',
      ].join(' ');

      await service.sendMessage(
        [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Use the tool' },
        ],
        {
          tools: [
            {
              name: 'inspect_build_logs',
              description: detailedDescription,
              input_schema: {
                type: 'object',
                properties: {
                  platform: { type: 'string' },
                },
                required: ['platform'],
              },
            },
          ],
        },
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tools[0].functionDeclarations[0].description).toBe(detailedDescription);
    });
  });
});
