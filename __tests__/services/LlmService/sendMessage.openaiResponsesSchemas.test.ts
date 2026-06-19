// ---------------------------------------------------------------------------
// Tests - LLM Service: sendMessage OpenAI Responses schemas
// ---------------------------------------------------------------------------

import {
  LlmService,
  makeConfig,
  makeOpenAIResponsesPayload,
  mockFetch,
} from '../../helpers/llmServiceHarness';
import { compactToolDefinitionForPrompt } from '../../../src/engine/tools/toolManagerTokenBudget';
import { CALENDAR_CREATE_TOOL } from '../../../src/engine/tools/native/calendar/definitions';

describe('LlmService', () => {
  describe('sendMessage OpenAI Responses schemas', () => {
    it('should strictify OpenAI tool schemas before sending them', async () => {
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

      await service.sendMessage([{ role: 'user', content: 'Commit the files' }], {
        tools: [
          {
            name: 'commit_files',
            description: 'Commit files to GitHub',
            strict: true,
            input_schema: {
              type: 'object',
              properties: {
                repo: { type: 'string' },
                ref: { type: 'string' },
                options: {
                  type: 'object',
                  properties: {
                    branch: { type: 'string' },
                    mode: { type: 'string', enum: ['safe', 'force'] },
                  },
                  required: ['branch'],
                },
                changes: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      path: { type: 'string' },
                      content: { type: 'string' },
                    },
                    required: ['path'],
                  },
                },
              },
              required: ['repo'],
            },
          },
        ],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const tool = body.tools[0];

      expect(tool.name).toBe('commit_files');
      expect(tool.strict).toBe(true);
      expect(tool.parameters.additionalProperties).toBe(false);
      expect(tool.parameters.required).toEqual(
        expect.arrayContaining(['repo', 'ref', 'options', 'changes']),
      );
      expect(tool.parameters.required).toHaveLength(4);
      expect(tool.parameters.properties.ref.type).toEqual(['string', 'null']);
      expect(tool.parameters.properties.options.type).toEqual(['object', 'null']);
      expect(tool.parameters.properties.options.additionalProperties).toBe(false);
      expect(tool.parameters.properties.options.required).toEqual(
        expect.arrayContaining(['branch', 'mode']),
      );
      expect(tool.parameters.properties.options.required).toHaveLength(2);
      expect(tool.parameters.properties.options.properties.mode.type).toEqual(['string', 'null']);
      expect(tool.parameters.properties.options.properties.mode.enum).toEqual([
        'safe',
        'force',
        null,
      ]);
      expect(tool.parameters.properties.changes.items.additionalProperties).toBe(false);
      expect(tool.parameters.properties.changes.items.required).toEqual(
        expect.arrayContaining(['path', 'content']),
      );
      expect(tool.parameters.properties.changes.items.required).toHaveLength(2);
      expect(tool.parameters.properties.changes.items.properties.content.type).toEqual([
        'string',
        'null',
      ]);
    });

    it('normalizes MCP-style array item schemas before sending OpenAI Responses tools', async () => {
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
                  },
                },
              },
              required: ['indicators'],
            },
          },
        ],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const tool = body.tools[0];

      expect(tool.strict).toBe(true);
      expect(tool.parameters.properties.indicators.items.type).toBe('string');
      expect(tool.parameters.properties.indicators.items.title).toBe('Indicator');
    });

    it('flattens root oneOf tool schemas before sending OpenAI Responses tools', async () => {
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
      const tool = body.tools[0];

      expect(tool.strict).toBe(false);
      expect(tool.parameters.type).toBe('object');
      expect(tool.parameters.oneOf).toBeUndefined();
      expect(tool.parameters.anyOf).toBeUndefined();
      expect(tool.parameters.allOf).toBeUndefined();
      expect(tool.parameters.properties.code).toEqual({ type: 'string' });
      expect(tool.parameters.properties.path).toEqual({ type: 'string' });
      expect(tool.parameters.properties.env.additionalProperties).toEqual({ type: 'string' });
    });

    it('does not auto-enable strict mode for nested unsupported composition keywords', async () => {
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

      await service.sendMessage([{ role: 'user', content: 'Update config' }], {
        tools: [
          {
            name: 'update_config',
            description: 'Update configuration values.',
            input_schema: {
              type: 'object',
              properties: {
                target: {
                  oneOf: [
                    { type: 'string' },
                    {
                      type: 'object',
                      properties: {
                        path: { type: 'string' },
                      },
                      required: ['path'],
                      additionalProperties: false,
                    },
                  ],
                },
              },
              required: ['target'],
            },
          },
        ],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tools[0].strict).toBe(false);
      expect(body.tools[0].parameters.properties.target.oneOf).toHaveLength(2);
    });

    it('auto-enables strict mode for simple compatible OpenAI schemas', async () => {
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

      await service.sendMessage([{ role: 'user', content: 'Read a file' }], {
        tools: [
          {
            name: 'read_file',
            description: 'Read a file',
            input_schema: {
              type: 'object',
              properties: {
                path: { type: 'string' },
              },
              required: ['path'],
            },
          },
        ],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const tool = body.tools[0];

      expect(tool.strict).toBe(true);
      expect(tool.parameters.additionalProperties).toBe(false);
      expect(tool.parameters.required).toEqual(['path']);
    });

    it('sends the native calendar create tool as a strict OpenAI Responses schema', async () => {
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

      await service.sendMessage([{ role: 'user', content: 'Create the calendar event.' }], {
        tools: [compactToolDefinitionForPrompt(CALENDAR_CREATE_TOOL)],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const tool = body.tools[0];

      expect(tool.name).toBe('calendar_create_event');
      expect(tool.strict).toBe(true);
      expect(tool.parameters.additionalProperties).toBe(false);
      expect(tool.parameters.required).toEqual(
        expect.arrayContaining([
          'title',
          'startDate',
          'endDate',
          'location',
          'notes',
          'calendarId',
          'allDay',
        ]),
      );
      expect(tool.parameters.required).toHaveLength(7);
      expect(tool.parameters.properties.title.type).toBe('string');
      expect(tool.parameters.properties.location.type).toEqual(['string', 'null']);
      expect(tool.parameters.properties.notes.type).toEqual(['string', 'null']);
      expect(tool.parameters.properties.calendarId.type).toEqual(['string', 'null']);
      expect(tool.parameters.properties.allDay.type).toEqual(['boolean', 'null']);
    });

    it('does not auto-enable strict mode for dynamic map-like schemas', async () => {
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

      await service.sendMessage([{ role: 'user', content: 'Fetch a URL' }], {
        tools: [
          {
            name: 'web_fetch',
            description: 'Fetch a URL',
            input_schema: {
              type: 'object',
              properties: {
                url: { type: 'string' },
                headers: {
                  type: 'object',
                  additionalProperties: { type: 'string' },
                },
              },
              required: ['url'],
            },
          },
        ],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const tool = body.tools[0];

      expect(tool.strict).toBe(false);
      expect(tool.parameters.properties.headers.additionalProperties).toEqual({ type: 'string' });
    });
  });
});
