// ---------------------------------------------------------------------------
// Tests — LLM Service
// ---------------------------------------------------------------------------

import { LlmService } from '../../src/services/llm/LlmService';
import {
  normalizeOpenAIPromptCacheKey,
  OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH,
} from '../../src/services/context/tokenOptimization';
import { LlmProviderConfig } from '../../src/types';

const mockGetSelectableLocalLlmModels = jest.fn();
const mockIsOnDeviceLlmProvider = jest.fn();
const mockSendLocalLlmMessage = jest.fn();
const mockStreamLocalLlmMessage = jest.fn();

jest.mock('../../src/services/localLlm/runtime', () => {
  const actual = jest.requireActual('../../src/services/localLlm/runtime');
  return {
    ...actual,
    getSelectableLocalLlmModels: (...args: any[]) => mockGetSelectableLocalLlmModels(...args),
    isOnDeviceLlmProvider: (...args: any[]) => mockIsOnDeviceLlmProvider(...args),
    sendLocalLlmMessage: (...args: any[]) => mockSendLocalLlmMessage(...args),
    streamLocalLlmMessage: (...args: any[]) => mockStreamLocalLlmMessage(...args),
  };
});

const makeConfig = (overrides: Partial<LlmProviderConfig> = {}): LlmProviderConfig => ({
  id: 'test',
  name: 'Test',
  baseUrl: 'https://api.test.com/v1',
  apiKey: 'sk-test-key',
  model: 'test-model',
  enabled: true,
  ...overrides,
});

const makeOnDeviceConfig = (overrides: Partial<LlmProviderConfig> = {}): LlmProviderConfig => ({
  id: 'local-test',
  kind: 'on-device',
  name: 'Gemma (on-device)',
  baseUrl: '',
  apiKey: '',
  model: 'gemma-4-E2B-it',
  availableModels: ['gemma-4-E2B-it'],
  modelCapabilities: {
    'gemma-4-E2B-it': {
      vision: false,
      tools: false,
      fileInput: false,
    },
  },
  enabled: true,
  local: {
    runtime: 'litert-lm',
    backend: 'cpu',
    installedModels: [],
  },
  ...overrides,
});

const makeOpenAIResponsesPayload = (overrides: Record<string, any> = {}) => ({
  id: 'resp_test',
  status: 'completed',
  output: [{
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'output_text', text: 'ok', annotations: [] }],
  }],
  output_text: 'ok',
  usage: {
    input_tokens: 5,
    output_tokens: 2,
    input_tokens_details: {
      cached_tokens: 0,
    },
  },
  ...overrides,
});

const makeExpoFailureToolResult = () => ({
  summary: 'Workflow workflow-run-77: FAILURE (FAILURE).',
  workflowRun: {
    id: 'workflow-run-77',
    status: 'FAILURE',
    conclusion: 'FAILURE',
  },
  jobs: [{
    name: 'Build',
    status: 'FAILURE',
    steps: [{ name: 'Install Dependencies', status: 'FAILURE' }],
  }],
  failureLogs: [{
    source: 'Build / Install Dependencies',
    excerpt: 'npm ERR! code E404\nnpm ERR! 404 @openclaw/private-package not found',
  }],
  note: 'Fix the missing private package or registry access before retrying.',
});

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

beforeEach(() => {
  jest.clearAllMocks();
  mockIsOnDeviceLlmProvider.mockImplementation((provider: LlmProviderConfig) => (
    provider.kind === 'on-device' || Boolean(provider.local?.runtime)
  ));
  mockGetSelectableLocalLlmModels.mockImplementation((provider: LlmProviderConfig) => (
    provider.availableModels || [provider.model]
  ));
  mockSendLocalLlmMessage.mockResolvedValue({
    choices: [{ message: { content: 'Local reply' } }],
  });
  mockStreamLocalLlmMessage.mockImplementation(async function* () {
    yield { type: 'token', content: 'Local' };
    yield { type: 'done' };
  });
});

describe('LlmService', () => {
  describe('constructor', () => {
    it('should create an instance with config', () => {
      const service = new LlmService(makeConfig());
      expect(service).toBeInstanceOf(LlmService);
    });
  });

  describe('fetchModels', () => {
    it('should return models on success', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ id: 'gpt-5.4' }, { id: 'gpt-5-mini' }],
          }),
      });

      const service = new LlmService(makeConfig());
      const result = await service.fetchModels();

      expect(result.models).toContain('gpt-5-mini');
      expect(result.models).toContain('gpt-5.4');
      expect(result.models).toEqual([...result.models].sort());
    });

    it('should detect vision capabilities for gpt-5.4', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [{ id: 'gpt-5.4' }] }),
      });

      const service = new LlmService(makeConfig());
      const result = await service.fetchModels();

      expect(result.capabilities['gpt-5.4'].vision).toBe(true);
      expect(result.capabilities['gpt-5.4'].tools).toBe(true);
    });

    it('should detect non-tool models like whisper', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [{ id: 'whisper-1' }] }),
      });

      const service = new LlmService(makeConfig());
      const result = await service.fetchModels();

      expect(result.capabilities['whisper-1'].tools).toBe(false);
    });

    it('should handle array response format', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([{ id: 'model-a' }, { id: 'model-b' }]),
      });

      const service = new LlmService(makeConfig());
      const result = await service.fetchModels();

      expect(result.models).toEqual(['model-a', 'model-b']);
    });

    it('should handle string array format', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(['model-x', 'model-y']),
      });

      const service = new LlmService(makeConfig());
      const result = await service.fetchModels();

      expect(result.models).toEqual(['model-x', 'model-y']);
    });

    it('should return empty on failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const service = new LlmService(makeConfig());
      const result = await service.fetchModels();

      expect(result.models).toEqual([]);
    });

    it('should try alternate URL on first failure', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [{ id: 'fallback-model' }] }),
      });

      const service = new LlmService(makeConfig());
      const result = await service.fetchModels();

      expect(result.models).toContain('fallback-model');
    });

    it('should use default URL when config base URL is empty', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [{ id: 'model-1' }] }),
      });

      const service = new LlmService(makeConfig({ baseUrl: '' }));
      await service.fetchModels();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('api.openai.com'),
        expect.any(Object),
      );
    });

    it('returns on-device models without performing an HTTP fetch', async () => {
      mockGetSelectableLocalLlmModels.mockReturnValueOnce(['gemma-4-E4B-it', 'gemma-4-E2B-it']);

      const service = new LlmService(makeOnDeviceConfig({
        availableModels: ['gemma-4-E4B-it', 'gemma-4-E2B-it'],
        modelCapabilities: {
          'gemma-4-E4B-it': { vision: false, tools: false, fileInput: false },
          'gemma-4-E2B-it': { vision: false, tools: false, fileInput: false },
        },
      }));
      const result = await service.fetchModels();

      expect(mockGetSelectableLocalLlmModels).toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
      expect(result.models).toEqual(['gemma-4-E2B-it', 'gemma-4-E4B-it']);
      expect(result.capabilities['gemma-4-E2B-it']).toEqual({ vision: false, tools: false, fileInput: false });
    });
  });

  describe('sendMessage', () => {
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

      const result = await service.sendMessage([{ role: 'user', content: 'Hi locally' }]);

      expect(mockSendLocalLlmMessage).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'on-device', model: 'gemma-4-E2B-it' }),
        [{ role: 'user', content: 'Hi locally' }],
      );
      expect(mockFetch).not.toHaveBeenCalled();
      expect(result?.choices?.[0]?.message?.content).toBe('Local reply');
    });

    it('opts into OpenAI reasoning summaries for reasoning models', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(makeOpenAIResponsesPayload()),
      });

      const service = new LlmService(makeConfig({
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-openai',
        model: 'gpt-5.4',
      }));

      await service.sendMessage([{ role: 'user', content: 'Think carefully' }], {
        reasoning_effort: 'medium',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.reasoning).toEqual({ effort: 'medium', summary: 'auto' });
    });

    it('adds OpenAI structured output schema via text.format and preserves the response ID', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(makeOpenAIResponsesPayload({
          id: 'resp_structured_1',
          output: [{
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: '{"approved":true}', annotations: [] }],
          }],
          output_text: '{"approved":true}',
        })),
      });

      const service = new LlmService(makeConfig({
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-openai',
        model: 'gpt-5.4',
      }));

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
      expect(body.text).toEqual(expect.objectContaining({
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
      }));
      expect(result?.id).toBe('resp_structured_1');
      expect(result?.choices?.[0]?.message?.providerReplay).toEqual(expect.objectContaining({
        openaiResponseId: 'resp_structured_1',
      }));
    });

    it('uses the Responses API for OpenAI providers and normalizes the result', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(makeOpenAIResponsesPayload({
          output: [{
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Hello!', annotations: [] }],
          }],
          output_text: 'Hello!',
        })),
      });

      const service = new LlmService(makeConfig({
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-openai',
        model: 'gpt-5.4',
      }));

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
      expect(result?.choices?.[0]?.message?.content).toBe('Hello!');
      expect(result?.choices?.[0]?.message?.providerReplay).toEqual(expect.objectContaining({
        openaiResponseId: 'resp_test',
      }));
      expect(result?.providerResponse).toEqual({
        provider: 'openai-responses',
        response: expect.objectContaining({
          id: 'resp_test',
        }),
      });
    });

    it('uses previous_response_id for OpenAI continuations instead of replaying prior assistant artifacts', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(makeOpenAIResponsesPayload()),
      });

      const service = new LlmService(makeConfig({
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-openai',
        model: 'gpt-5.4',
      }));

      await service.sendMessage([
        { role: 'system', content: 'Return only JSON.' },
        { role: 'user', content: 'Assess the run.' },
        {
          role: 'assistant',
          content: 'The run is complete and verified.',
          providerReplay: {
            openaiResponseId: 'resp_prev_1',
            openaiResponseOutput: [
              {
                id: 'fc_1',
                type: 'function_call',
                call_id: 'call_1',
                name: 'pilot_report',
                arguments: '{"approved":true}',
              },
            ],
          },
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: {
              name: 'pilot_report',
              arguments: '{"approved":true}',
            },
          }],
        } as any,
        { role: 'user', content: 'Your previous reply was not machine-readable. Return only raw JSON now.' },
      ], {
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
      expect(body.previous_response_id).toBe('resp_prev_1');
      expect(body.instructions).toBe('Return only JSON.');
      expect(body.input).toEqual([
        { role: 'user', content: 'Your previous reply was not machine-readable. Return only raw JSON now.' },
      ]);
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
              oneOf: [
                { required: ['code'] },
                { required: ['path'] },
              ],
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
      expect(parameters.properties).toEqual(expect.objectContaining({
        code: { type: 'string' },
        path: { type: 'string' },
      }));
      expect(parameters.properties.env.additionalProperties).toEqual({ type: 'string' });
    });

    it('should strictify OpenAI tool schemas before sending them', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(makeOpenAIResponsesPayload()),
      });

      const service = new LlmService(makeConfig({
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-openai',
        model: 'gpt-5.4',
      }));

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
      expect(tool.parameters.required).toEqual(expect.arrayContaining(['repo', 'ref', 'options', 'changes']));
      expect(tool.parameters.required).toHaveLength(4);
      expect(tool.parameters.properties.ref.type).toEqual(['string', 'null']);
      expect(tool.parameters.properties.options.type).toEqual(['object', 'null']);
      expect(tool.parameters.properties.options.additionalProperties).toBe(false);
      expect(tool.parameters.properties.options.required).toEqual(expect.arrayContaining(['branch', 'mode']));
      expect(tool.parameters.properties.options.required).toHaveLength(2);
      expect(tool.parameters.properties.options.properties.mode.type).toEqual(['string', 'null']);
      expect(tool.parameters.properties.options.properties.mode.enum).toEqual(['safe', 'force', null]);
      expect(tool.parameters.properties.changes.items.additionalProperties).toBe(false);
      expect(tool.parameters.properties.changes.items.required).toEqual(expect.arrayContaining(['path', 'content']));
      expect(tool.parameters.properties.changes.items.required).toHaveLength(2);
      expect(tool.parameters.properties.changes.items.properties.content.type).toEqual(['string', 'null']);
    });

    it('normalizes MCP-style array item schemas before sending OpenAI Responses tools', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(makeOpenAIResponsesPayload()),
      });

      const service = new LlmService(makeConfig({
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-openai',
        model: 'gpt-5.4',
      }));

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

      const service = new LlmService(makeConfig({
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-openai',
        model: 'gpt-5.4',
      }));

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
              oneOf: [
                { required: ['code'] },
                { required: ['path'] },
              ],
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

      const service = new LlmService(makeConfig({
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-openai',
        model: 'gpt-5.4',
      }));

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

      const service = new LlmService(makeConfig({
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-openai',
        model: 'gpt-5.4',
      }));

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

    it('does not auto-enable strict mode for dynamic map-like schemas', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(makeOpenAIResponsesPayload()),
      });

      const service = new LlmService(makeConfig({
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-openai',
        model: 'gpt-5.4',
      }));

      await service.sendMessage([{ role: 'user', content: 'Fetch a URL' }], {
        tools: [
          {
            name: 'fetch_url',
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

    it('replays OpenAI tool history as Responses input items', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(makeOpenAIResponsesPayload()),
      });

      const service = new LlmService(makeConfig({
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-openai',
        model: 'gpt-5.4',
      }));

      await service.sendMessage([
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Read notes.txt' },
        {
          role: 'assistant',
          content: 'Checking the file.',
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"notes.txt"}' },
            _openai: {
              itemId: 'fc_1',
              callId: 'call_1',
              reasoningItems: [{
                id: 'rs_1',
                type: 'reasoning',
                content: [],
                summary: [],
              }],
            },
          }],
        } as any,
        { role: 'tool', tool_call_id: 'call_1', content: 'file contents' },
      ], {
        tools: [{
          name: 'read_file',
          description: 'Read a file',
          input_schema: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
          },
        }],
        toolChoice: 'required',
      });

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
        json: () => Promise.resolve({
          output: [{
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'ok' }],
          }],
          output_text: 'ok',
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-openai',
        model: 'gpt-5.4',
      }));

      const result = await service.sendMessage([{ role: 'user', content: 'Return the pilot report.' }], {
        tools: [{
          name: 'pilot_report',
          description: 'Return the pilot report',
          input_schema: {
            type: 'object',
            properties: { approved: { type: 'boolean' } },
            required: ['approved'],
            additionalProperties: false,
          },
        }],
        toolChoice: { type: 'tool', name: 'pilot_report', disableParallelToolUse: true },
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tool_choice).toEqual({ type: 'function', name: 'pilot_report' });
      expect(body.parallel_tool_calls).toBe(false);
    });

    it('replays exact OpenAI assistant output items when provider replay is available', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(makeOpenAIResponsesPayload()),
      });

      const service = new LlmService(makeConfig({
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-openai',
        model: 'gpt-5.4',
      }));

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
        { role: 'user', content: 'Second question' },
      ]);
    });

    it('reconstructs OpenAI tool turns when replayed output misses required reasoning items', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(makeOpenAIResponsesPayload()),
      });

      const service = new LlmService(makeConfig({
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-openai',
        model: 'gpt-5.4',
      }));

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
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"notes.txt"}' },
            _openai: {
              callId: 'call_1',
              itemId: 'fc_1',
              reasoningItems: [{ id: 'rs_1', type: 'reasoning', summary: [] }],
            },
          }],
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

    it('downgrades malformed OpenAI reasoning tool history instead of replaying bare function_call items', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(makeOpenAIResponsesPayload()),
      });

      const service = new LlmService(makeConfig({
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-openai',
        model: 'gpt-5.4',
      }));

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
          role: 'assistant',
          content: [
            'Historical tool call from a previous completed turn (exact OpenAI replay unavailable):',
            '- read_file {"path":"notes.txt"}',
          ].join('\n'),
        },
        {
          role: 'assistant',
          content: 'Historical tool result from read_file (exact OpenAI replay unavailable):\nfile contents',
        },
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
      const service = new LlmService(makeConfig({
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-openai',
        model: 'gpt-5.4',
      }));

      await service.sendMessage([
        { role: 'user', content: 'Check Expo workflow status.' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [{
            id: 'call_expo_1',
            type: 'function',
            function: { name: 'expo_eas_workflow_status', arguments: '{"projectId":"expo-1","runId":"workflow-run-77"}' },
            _openai: { callId: 'call_expo_1' },
          }],
        } as any,
        { role: 'tool', tool_call_id: 'call_expo_1', name: 'expo_eas_workflow_status', content: expoFailureText } as any,
      ], {
        tools: [{
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
        }],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.input).toEqual([
        { role: 'user', content: 'Check Expo workflow status.' },
        {
          role: 'assistant',
          content: [
            'Historical tool call from a previous completed turn (exact OpenAI replay unavailable):',
            '- expo_eas_workflow_status {"projectId":"expo-1","runId":"workflow-run-77"}',
          ].join('\n'),
        },
        {
          role: 'assistant',
          content: `Historical tool result from expo_eas_workflow_status (exact OpenAI replay unavailable):\n${expoFailureText}`,
        },
      ]);
    });

    it('converts OpenAI multimodal content to Responses input parts', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(makeOpenAIResponsesPayload()),
      });

      const service = new LlmService(makeConfig({
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-openai',
        model: 'gpt-5.4',
      }));

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

    it('uses Gemini native generateContent with system instructions, tools, and native thinking config', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          candidates: [{
            content: { parts: [{ text: 'ok' }] },
            finishReason: 'STOP',
          }],
          usageMetadata: {
            promptTokenCount: 8,
            candidatesTokenCount: 2,
            totalTokenCount: 10,
          },
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'gemini',
        name: 'Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com',
        apiKey: 'AIza-test',
        model: 'gemini-2.5-pro',
      }));

      await service.sendMessage([
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Use the tool' },
      ], {
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
      });

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
      expect(body.generationConfig).toEqual(expect.objectContaining({
        thinkingConfig: { thinkingBudget: 8192, includeThoughts: true },
      }));
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
        json: () => Promise.resolve({
          candidates: [{
            content: { parts: [{ text: 'ok' }] },
            finishReason: 'STOP',
          }],
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'gemini',
        name: 'Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com',
        apiKey: 'AIza-test',
        model: 'gemini-3-flash-preview',
      }));

      await service.sendMessage([
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Use the tool' },
      ], {
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
      });

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
        json: () => Promise.resolve({
          candidates: [{
            content: { parts: [{ text: 'ok' }] },
            finishReason: 'STOP',
          }],
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'gemini',
        name: 'Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com',
        apiKey: 'AIza-test',
        model: 'gemini-3-flash-preview',
      }));

      await service.sendMessage([
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Use the tool' },
      ], {
        tools: [{
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
        }],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const parameters = body.tools[0].functionDeclarations[0].parameters;

      expect(parameters.properties.indicators.items.type).toBe('string');
      expect(parameters.properties.indicators.items.title).toBe('Indicator');
      expect(parameters.properties.indicators.items.enum).toEqual(['rsi', 'macd']);
    });

    it('flattens root oneOf tool schemas for Gemini tool declarations', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          candidates: [{
            content: { parts: [{ text: 'ok' }] },
            finishReason: 'STOP',
          }],
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'gemini',
        name: 'Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com',
        apiKey: 'AIza-test',
        model: 'gemini-3-flash-preview',
      }));

      await service.sendMessage([
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Use the tool' },
      ], {
        tools: [{
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
            oneOf: [
              { required: ['code'] },
              { required: ['path'] },
            ],
            required: [],
          },
        }],
      });

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
        json: () => Promise.resolve({
          candidates: [{
            content: { parts: [{ text: 'ok' }] },
            finishReason: 'STOP',
          }],
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'gemini',
        name: 'Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com',
        apiKey: 'AIza-test',
        model: 'gemini-3-flash-preview',
      }));

      await service.sendMessage([
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Use the tool' },
      ], {
        tools: [{
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
        }],
        toolChoice: 'required',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const parameters = body.tools[0].functionDeclarations[0].parameters;

      expect(parameters.properties.recommendedAction.enum).toEqual(['finalize', 'continue', 'blocked']);
      expect(parameters.properties.completionScore.type).toBe('integer');
      expect(parameters.properties.completionScore.enum).toBeUndefined();
      expect(parameters.properties.completionScore.description).toContain('Completion score.');
      expect(parameters.properties.completionScore.description).toContain('Allowed values: 0, 1, 2, 3, 4, 5.');
      expect(parameters.properties.criterionEvaluations.items.properties.score.enum).toBeUndefined();
      expect(parameters.properties.criterionEvaluations.items.properties.score.description).toContain('Allowed values: 0, 1, 2, 3, 4, 5.');
      expect(parameters.properties.criterionEvaluations.items.properties.status.enum).toEqual(['met', 'partial', 'unmet', 'blocked']);
      expect(body.toolConfig).toEqual({
        functionCallingConfig: { mode: 'ANY' },
      });
    });

    it('preserves detailed Gemini function descriptions', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          candidates: [{
            content: { parts: [{ text: 'ok' }] },
            finishReason: 'STOP',
          }],
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'gemini',
        name: 'Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com',
        apiKey: 'AIza-test',
        model: 'gemini-3-flash-preview',
      }));

      const detailedDescription = [
        'Inspect mobile build logs and identify the failing step.',
        'Use this when the user asks for root-cause analysis of an Android or iOS build failure.',
        'Return the exact failing command, the first verified cause, and the most likely fix.',
      ].join(' ');

      await service.sendMessage([
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Use the tool' },
      ], {
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
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tools[0].functionDeclarations[0].description).toBe(detailedDescription);
    });

    it('does not forward generic prompt cache keys to Gemini native generateContent', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          candidates: [{
            content: { parts: [{ text: 'ok' }] },
            finishReason: 'STOP',
          }],
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'gemini',
        name: 'Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com',
        apiKey: 'AIza-test',
        model: 'gemini-3-flash-preview',
      }));

      await service.sendMessage([
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Use the cache' },
      ], {
        enablePromptCaching: true,
        promptCacheKey: 'cm:test:key',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.cachedContent).toBeUndefined();
    });

    it('keeps stable core tools at the front of cache-aware Gemini requests', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          candidates: [{
            content: { parts: [{ text: 'ok' }] },
            finishReason: 'STOP',
          }],
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'gemini',
        name: 'Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com',
        apiKey: 'AIza-test',
        model: 'gemini-3-flash-preview',
      }));

      await service.sendMessage([
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Use the cache' },
      ], {
        enablePromptCaching: true,
        tools: [
          {
            name: 'browser_navigate',
            description: 'Navigate to a page.',
            input_schema: {
              type: 'object',
              properties: { url: { type: 'string' } },
              required: ['url'],
            },
          },
          {
            name: 'read_file',
            description: 'Read a file.',
            input_schema: {
              type: 'object',
              properties: { path: { type: 'string' } },
              required: ['path'],
            },
          },
          {
            name: 'tool_catalog',
            description: 'Inspect deferred tool categories.',
            input_schema: {
              type: 'object',
              properties: {},
            },
          },
        ],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tools[0].functionDeclarations.map((tool: any) => tool.name)).toEqual([
        'read_file',
        'tool_catalog',
        'browser_navigate',
      ]);
    });

    it('forwards native Gemini cachedContents handles when explicitly provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          candidates: [{
            content: { parts: [{ text: 'ok' }] },
            finishReason: 'STOP',
          }],
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'gemini',
        name: 'Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com',
        apiKey: 'AIza-test',
        model: 'gemini-3-flash-preview',
      }));

      await service.sendMessage([
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Use the cache' },
      ], {
        enablePromptCaching: true,
        promptCacheKey: 'cachedContents/native-cache-123',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.cachedContent).toBe('cachedContents/native-cache-123');
    });

    it('restricts Gemini native function calling to one exact tool when requested', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'gemini',
        name: 'Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com',
        apiKey: 'AIza-test',
        model: 'gemini-3-flash-preview',
      }));

      const result = await service.sendMessage([{ role: 'user', content: 'Return the pilot report.' }], {
        tools: [{
          name: 'pilot_report',
          description: 'Return the pilot report',
          input_schema: {
            type: 'object',
            properties: { approved: { type: 'boolean' } },
            required: ['approved'],
            additionalProperties: false,
          },
        }],
        toolChoice: { type: 'tool', name: 'pilot_report', disableParallelToolUse: true },
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.toolConfig).toEqual({
        functionCallingConfig: {
          mode: 'ANY',
          allowedFunctionNames: ['pilot_report'],
        },
      });
      expect(result?.providerResponse).toEqual({
        provider: 'gemini',
        response: expect.objectContaining({
          candidates: expect.any(Array),
        }),
      });
    });

    it('adds Gemini structured output schema when requested', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          candidates: [{ content: { parts: [{ text: '{"approved":true}' }] }, finishReason: 'STOP' }],
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'gemini',
        name: 'Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com',
        apiKey: 'AIza-test',
        model: 'gemini-3-flash-preview',
      }));

      await service.sendMessage([{ role: 'user', content: 'Return the pilot report.' }], {
        tools: [{
          name: 'pilot_report',
          description: 'Return the pilot report',
          input_schema: {
            type: 'object',
            properties: { approved: { type: 'boolean' } },
            required: ['approved'],
            additionalProperties: false,
          },
        }],
        toolChoice: { type: 'tool', name: 'pilot_report', disableParallelToolUse: true },
        structuredOutput: {
          name: 'pilot_report',
          mimeType: 'application/json',
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              approved: { type: 'boolean' },
              completionScore: {
                type: 'integer',
                enum: [0, 1, 2, 3, 4, 5],
                description: 'Completion score.',
              },
            },
            required: ['approved', 'completionScore'],
          },
        },
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.generationConfig).toEqual(expect.objectContaining({
        responseMimeType: 'application/json',
      }));
      expect(body.generationConfig.responseJsonSchema).toEqual(expect.objectContaining({
        type: 'object',
        properties: expect.objectContaining({
          approved: expect.objectContaining({ type: 'boolean' }),
          completionScore: expect.objectContaining({
            type: 'integer',
            description: expect.stringContaining('Allowed values: 0, 1, 2, 3, 4, 5.'),
          }),
        }),
      }));
      expect(body.generationConfig.responseJsonSchema.properties.completionScore.enum).toBeUndefined();
      expect(body.toolConfig).toEqual({
        functionCallingConfig: {
          mode: 'ANY',
          allowedFunctionNames: ['pilot_report'],
        },
      });
    });

    it('uses Gemini native structured output even when configured with the OpenAI-style Gemini endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          candidates: [{ content: { parts: [{ text: '{"approved":true}' }] }, finishReason: 'STOP' }],
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'gemini',
        name: 'Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        apiKey: 'AIza-test',
        model: 'gemini-3-flash-preview',
      }));

      await service.sendMessage([{ role: 'user', content: 'Return JSON.' }], {
        structuredOutput: {
          name: 'pilot_report',
          mimeType: 'application/json',
          schema: {
            type: 'object',
            properties: {
              approved: { type: 'boolean' },
            },
            required: ['approved'],
          },
        },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent',
        expect.objectContaining({ method: 'POST' }),
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.generationConfig).toEqual(expect.objectContaining({
        responseMimeType: 'application/json',
        responseJsonSchema: expect.objectContaining({
          type: 'object',
          properties: expect.objectContaining({
            approved: expect.objectContaining({ type: 'boolean' }),
          }),
        }),
      }));
      expect(body.response_format).toBeUndefined();
    });

    it('uses the Vertex publisher-model endpoint for native Gemini requests on the default Gemini provider', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          candidates: [{ content: { parts: [{ text: 'vertex ok' }] }, finishReason: 'STOP' }],
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'gemini-vertex',
        name: 'Gemini',
        baseUrl: 'https://aiplatform.googleapis.com/v1',
        apiKey: 'AIza-vertex',
        model: 'gemini-3-flash-preview',
      }));

      await service.sendMessage([{ role: 'user', content: 'Return JSON.' }], {
        structuredOutput: {
          mimeType: 'application/json',
          schema: {
            type: 'object',
            properties: {
              approved: { type: 'boolean' },
            },
            required: ['approved'],
          },
        },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-3-flash-preview:generateContent',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('keeps Gemini structured output enabled for no-tool requests on older Gemini models', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          candidates: [{ content: { parts: [{ text: '{"approved":true}' }] }, finishReason: 'STOP' }],
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'gemini',
        name: 'Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com',
        apiKey: 'AIza-test',
        model: 'gemini-2.5-flash',
      }));

      await service.sendMessage([{ role: 'user', content: 'Return JSON.' }], {
        structuredOutput: {
          mimeType: 'application/json',
          schema: {
            type: 'object',
            properties: {
              approved: { type: 'boolean' },
            },
            required: ['approved'],
          },
        },
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.generationConfig).toEqual(expect.objectContaining({
        responseMimeType: 'application/json',
        responseJsonSchema: expect.objectContaining({
          type: 'object',
          properties: expect.objectContaining({
            approved: expect.objectContaining({ type: 'boolean' }),
          }),
        }),
      }));
      expect(body.tools).toBeUndefined();
      expect(body.toolConfig).toBeUndefined();
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

    it('adds structured output via native compatible response_format for OpenRouter-style providers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ choices: [{ message: { content: '{"approved":true}' } }] }),
      });

      const service = new LlmService(makeConfig({
        id: 'openrouter',
        name: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: 'sk-openrouter',
        model: 'openai/gpt-5.4',
      }));

      await service.sendMessage([{ role: 'user', content: 'Return JSON.' }], {
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

      expect(mockFetch).toHaveBeenCalledWith(
        'https://openrouter.ai/api/v1/chat/completions',
        expect.objectContaining({ method: 'POST' }),
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.response_format).toEqual({
        type: 'json_schema',
        json_schema: {
          name: 'pilot_report',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['approved'],
            properties: {
              approved: { type: 'boolean' },
            },
          },
        },
      });
      expect(body.text).toBeUndefined();
    });

    it('should throw on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: () => Promise.resolve('Invalid API key'),
      });

      const service = new LlmService(makeConfig());
      await expect(
        service.sendMessage([{ role: 'user', content: 'Hi' }]),
      ).rejects.toThrow('LLM API error 401');
    });

    it('replays Gemini tool history natively with functionCall and functionResponse parts', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          candidates: [{
            content: { parts: [{ text: 'Recovered' }] },
            finishReason: 'STOP',
          }],
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'gemini',
        name: 'Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        apiKey: 'AIza-test',
        model: 'gemini-3.1-pro-preview',
      }));

      await service.sendMessage([
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
        { role: 'tool', content: 'Error: a missing', tool_call_id: 'tc1', is_error: true, name: 'read_file' } as any,
        { role: 'user', content: 'Try again' },
      ], {
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
          parts: [{
            functionCall: {
              name: 'read_file',
              args: { path: 'a.txt' },
            },
            thoughtSignature: 'sig-A',
          }],
        },
        {
          role: 'user',
          parts: [{
            functionResponse: {
              name: 'read_file',
              response: { error: 'Error: a missing' },
            },
          }],
        },
        {
          role: 'user',
          parts: [{ text: 'Try again' }],
        },
      ]);
    });

    it('replays Gemini parallel tool calls without providerReplay when the signed call metadata is intact', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          candidates: [{
            content: { parts: [{ text: 'Recovered' }] },
            finishReason: 'STOP',
          }],
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'gemini',
        name: 'Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        apiKey: 'AIza-test',
        model: 'gemini-3.1-pro-preview',
      }));

      await service.sendMessage([
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
      ], {
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
                name: 'read_file',
                args: { path: 'a.txt' },
              },
              thoughtSignature: 'sig-parallel-1',
            },
            {
              functionCall: {
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
                name: 'read_file',
                response: { result: 'A contents' },
              },
            },
            {
              functionResponse: {
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

    it('replays Gemini sequential tool turns without providerReplay when each turn retains its signature', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          candidates: [{
            content: { parts: [{ text: 'Recovered' }] },
            finishReason: 'STOP',
          }],
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'gemini',
        name: 'Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        apiKey: 'AIza-test',
        model: 'gemini-3.1-pro-preview',
      }));

      await service.sendMessage([
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
      ], {
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

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.contents).toEqual([
        {
          role: 'user',
          parts: [{ text: 'Inspect both files' }],
        },
        {
          role: 'model',
          parts: [{
            functionCall: {
              name: 'read_file',
              args: { path: 'a.txt' },
            },
            thoughtSignature: 'sig-seq-1',
          }],
        },
        {
          role: 'user',
          parts: [{
            functionResponse: {
              name: 'read_file',
              response: { result: 'A contents' },
            },
          }],
        },
        {
          role: 'model',
          parts: [{
            functionCall: {
              name: 'read_file',
              args: { path: 'b.txt' },
            },
            thoughtSignature: 'sig-seq-2',
          }],
        },
        {
          role: 'user',
          parts: [{
            functionResponse: {
              name: 'read_file',
              response: { result: 'B contents' },
            },
          }],
        },
        {
          role: 'user',
          parts: [{ text: 'Summarize the files' }],
        },
      ]);
    });

    it('downgrades Gemini legacy tool turns without providerReplay to plain text instead of emitting invalid function parts', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          candidates: [{
            content: { parts: [{ text: 'Recovered' }] },
            finishReason: 'STOP',
          }],
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'gemini',
        name: 'Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        apiKey: 'AIza-test',
        model: 'gemini-3.1-pro-preview',
      }));

      await service.sendMessage([
        { role: 'user', content: 'Read file a.txt' },
        {
          role: 'assistant',
          content: 'Planning: inspect the file.',
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
      ], {
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
              text: 'Tool invocation history (exact Gemini replay metadata unavailable):\n- read_file {"path":"a.txt"}',
            },
          ],
        },
        {
          role: 'user',
          parts: [{ text: 'Tool result from read_file:\nA contents' }],
        },
        {
          role: 'user',
          parts: [{ text: 'Try again' }],
        },
      ]);

      expect(body.contents.flatMap((entry: any) => entry.parts || []).some((part: any) => part.functionCall || part.functionResponse)).toBe(false);
    });

    it('replays persisted Gemini thought parts with signatures on later turns', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          candidates: [{
            content: { parts: [{ text: 'Recovered' }] },
            finishReason: 'STOP',
          }],
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'gemini',
        name: 'Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com',
        apiKey: 'AIza-test',
        model: 'gemini-2.5-pro',
      }));

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

    it('replays Expo failure tool results to Gemini functionResponse payloads as structured JSON', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          candidates: [{
            content: { parts: [{ text: 'Recovered' }] },
            finishReason: 'STOP',
          }],
        }),
      });

      const expoFailureResult = makeExpoFailureToolResult();
      const expoFailureText = JSON.stringify(expoFailureResult);
      const service = new LlmService(makeConfig({
        id: 'gemini',
        name: 'Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        apiKey: 'AIza-test',
        model: 'gemini-3.1-pro-preview',
      }));

      await service.sendMessage([
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
          tool_calls: [{
            id: 'expo_tc1',
            type: 'function',
            function: { name: 'expo_eas_workflow_status', arguments: '{"projectId":"expo-1","runId":"workflow-run-77"}' },
          }],
        } as any,
        { role: 'tool', tool_call_id: 'expo_tc1', name: 'expo_eas_workflow_status', content: expoFailureText } as any,
      ], {
        tools: [{
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
        }],
      } as any);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const responsePart = body.contents
        .flatMap((entry: any) => entry.parts || [])
        .find((part: any) => part.functionResponse?.name === 'expo_eas_workflow_status');

      expect(responsePart).toEqual({
        functionResponse: {
          name: 'expo_eas_workflow_status',
          response: expoFailureResult,
        },
      });
    });

    it('normalizes Gemini native function-call responses back into assistant tool_calls', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          candidates: [{
            content: {
              parts: [{
                functionCall: {
                  id: 'tc1',
                  name: 'read_file',
                  args: { path: 'a.txt' },
                },
                thoughtSignature: 'sig-A',
              }],
            },
            finishReason: 'STOP',
          }],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 3,
            totalTokenCount: 13,
          },
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'gemini',
        name: 'Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        apiKey: 'AIza-test',
        model: 'gemini-3.1-pro-preview',
      }));

      const result = await service.sendMessage([
        { role: 'user', content: 'Read a.txt' },
      ], {
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
            extra_content: {
              google: {
                thought_signature: 'sig-A',
              },
            },
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
              name: 'read_file',
              args: { path: 'a.txt' },
            },
            thoughtSignature: 'sig-A',
          },
        ],
      });
      expect(result.usage).toEqual(expect.objectContaining({
        prompt_tokens: 10,
        completion_tokens: 3,
        total_tokens: 13,
      }));
    });

    it('should use custom model when specified', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ choices: [] }),
      });

      const service = new LlmService(makeConfig());
      await service.sendMessage([{ role: 'user', content: 'test' }], {
        model: 'custom-model',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.model).toBe('custom-model');
    });

    it('should set maxTokens and temperature', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ choices: [] }),
      });

      const service = new LlmService(makeConfig());
      await service.sendMessage([{ role: 'user', content: 'test' }], {
        maxTokens: 4096,
        temperature: 0.7,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.max_tokens).toBe(4096);
      expect(body.temperature).toBe(0.7);
    });

    it('caps Anthropic strict tools before the first request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 4 },
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'anthropic-key',
        model: 'claude-sonnet-4-6',
      }));

      await service.sendMessage([{ role: 'user', content: 'Use a tool if needed.' }], {
        tools: Array.from({ length: 8 }, (_, index) => ({
          name: `tool_${index}`,
          description: `Tool ${index}. Extra detail that Anthropic does not need in the first pass.`,
          strict: true,
          input_schema: {
            type: 'object',
            properties: {
              value: { type: 'string', description: 'Value to pass to the tool' },
            },
            required: ['value'],
          },
        })),
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tools).toHaveLength(8);
      expect(body.tools.filter((tool: any) => tool.strict === true)).toHaveLength(4);
      expect(body.tools.slice(0, 4).every((tool: any) => tool.strict === true)).toBe(true);
      expect(body.tools.slice(4).every((tool: any) => tool.strict === undefined)).toBe(true);
      // Anthropic tool descriptions are no longer truncated to first sentence —
      // full descriptions are preserved per Anthropic best practices.
      expect(body.tools[0].description).toBe('Tool 0. Extra detail that Anthropic does not need in the first pass.');
      // Property descriptions are preserved for Anthropic (Claude relies on them).
      expect(body.tools[0].input_schema.properties.value.description).toBe('Value to pass to the tool');
    });

    it('does not mark complex Anthropic schemas strict even when the tool requests it', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 4 },
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'anthropic-key',
        model: 'claude-sonnet-4-6',
      }));

      await service.sendMessage([{ role: 'user', content: 'Use a tool if needed.' }], {
        tools: [
          {
            name: 'complex_tool',
            description: 'Complex tool. More detail that should be trimmed.',
            strict: true,
            input_schema: {
              type: 'object',
              properties: {
                query: { type: 'string', description: 'Search query' },
                count: { type: 'number', description: 'Number of results' },
                filters: {
                  type: 'object',
                  properties: {
                    country: { type: 'string', description: 'Country filter' },
                  },
                  required: ['country'],
                },
              },
              required: ['query'],
            },
          },
        ],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tools[0].strict).toBeUndefined();
      expect(body.tools[0].description).toBe('Complex tool. More detail that should be trimmed.');
      expect(body.tools[0].input_schema).toEqual({
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          count: { type: 'number', description: 'Number of results' },
          filters: {
            type: 'object',
            properties: {
              country: { type: 'string', description: 'Country filter' },
            },
            required: ['country'],
          },
        },
        required: ['query'],
      });
    });

    it('keeps Anthropic tool_use and tool_result messages properly paired', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          content: [{ type: 'text', text: 'Done' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 4 },
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'anthropic-key',
        model: 'claude-sonnet-4-6',
      }));

      await service.sendMessage([
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Run the tool.' },
        {
          role: 'assistant',
          content: 'Checking the file.',
          tool_calls: [{
            id: 'toolu_1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"notes.txt"}' },
          }],
        } as any,
        { role: 'tool', tool_call_id: 'toolu_1', content: 'file contents' },
      ], {
        tools: [{
          name: 'read_file',
          description: 'Read a file',
          input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
        }],
        toolChoice: 'required',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.system).toBe('You are helpful.');
      expect(body.tool_choice).toEqual({ type: 'any' });
      expect(body.messages).toEqual([
        { role: 'user', content: 'Run the tool.' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Checking the file.' },
            { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'notes.txt' } },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_1', content: 'file contents' },
          ],
        },
      ]);
    });

    it('reorders Anthropic user content so tool_result blocks come before text', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          content: [{ type: 'text', text: 'Done' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 4 },
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'anthropic-key',
        model: 'claude-sonnet-4-6',
      }));

      await service.sendMessage([
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Run the tool.' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [{
            id: 'toolu_2',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"notes.txt"}' },
          }],
        } as any,
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What should I do next?' },
            { type: 'tool_result', tool_use_id: 'toolu_2', content: 'file contents' },
          ],
        } as any,
      ]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages).toEqual([
        { role: 'user', content: 'Run the tool.' },
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'toolu_2', name: 'read_file', input: { path: 'notes.txt' } },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_2', content: 'file contents' },
            { type: 'text', text: 'What should I do next?' },
          ],
        },
      ]);
    });

    it('replays Expo failure tool results to Anthropic tool_result content unchanged', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          content: [{ type: 'text', text: 'Done' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 4 },
        }),
      });

      const expoFailureResult = makeExpoFailureToolResult();
      const expoFailureText = JSON.stringify(expoFailureResult);
      const service = new LlmService(makeConfig({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'anthropic-key',
        model: 'claude-sonnet-4-6',
      }));

      await service.sendMessage([
        { role: 'user', content: 'Check Expo workflow status.' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [{
            id: 'toolu_expo_1',
            type: 'function',
            function: { name: 'expo_eas_workflow_status', arguments: '{"projectId":"expo-1","runId":"workflow-run-77"}' },
          }],
        } as any,
        { role: 'tool', tool_call_id: 'toolu_expo_1', name: 'expo_eas_workflow_status', content: expoFailureText } as any,
      ], {
        tools: [{
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
        }],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages).toEqual([
        { role: 'user', content: 'Check Expo workflow status.' },
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'toolu_expo_1', name: 'expo_eas_workflow_status', input: { projectId: 'expo-1', runId: 'workflow-run-77' } },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_expo_1', content: expoFailureText },
          ],
        },
      ]);
    });

    it('sanitizes legacy Anthropic assistant content arrays with empty text blocks', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          content: [{ type: 'text', text: 'Recovered' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 12, output_tokens: 6 },
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'anthropic-key',
        model: 'claude-sonnet-4-6',
      }));

      await service.sendMessage([
        { role: 'user', content: 'Sort [3,1,2] using javascript.' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: '' },
            { type: 'tool_use', id: 'toolu_1', name: 'javascript', input: {} },
          ],
        } as any,
        {
          role: 'tool',
          tool_call_id: 'toolu_1',
          name: 'javascript',
          content: "Error: 'code' is required for javascript and must be a string",
          is_error: true,
        } as any,
      ], {
        tools: [{
          name: 'javascript',
          description: 'Execute JavaScript',
          input_schema: {
            type: 'object',
            properties: { code: { type: 'string' } },
            required: ['code'],
          },
        }],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages).toEqual([
        { role: 'user', content: 'Sort [3,1,2] using javascript.' },
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'toolu_1', name: 'javascript', input: {} },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_1',
              content: "Error: 'code' is required for javascript and must be a string",
              is_error: true,
            },
          ],
        },
      ]);
    });

    it('drops stale Anthropic tool_use history before a later fresh user turn', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          content: [{ type: 'text', text: 'Handled safely' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 12, output_tokens: 6 },
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'anthropic-key',
        model: 'claude-sonnet-4-6',
      }));

      await service.sendMessage([
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'First task' },
        {
          role: 'assistant',
          content: 'Checking the file.',
          tool_calls: [{
            id: 'toolu_stale_1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"notes.txt"}' },
          }],
          assistantMetadata: {
            kind: 'final',
            completionStatus: 'incomplete',
            finishReason: 'response_failed',
          },
        } as any,
        { role: 'user', content: 'New question after the failed turn.' },
      ], {
        tools: [{
          name: 'read_file',
          description: 'Read a file.',
          input_schema: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
          },
        }],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages).toEqual([
        { role: 'user', content: 'First task' },
        { role: 'assistant', content: 'Checking the file.' },
        { role: 'user', content: 'New question after the failed turn.' },
      ]);
    });

    it('strips Anthropic thinking replay from prior plain assistant turns before a later user follow-up', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          content: [{ type: 'text', text: 'Handled safely' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 12, output_tokens: 6 },
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'anthropic-key',
        model: 'claude-sonnet-4-6',
      }));

      await service.sendMessage([
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'First task' },
        {
          role: 'assistant',
          content: 'Completed first task.',
          providerReplay: {
            anthropicBlocks: [
              { type: 'thinking', thinking: 'I should think before answering.', signature: 'sig-A' },
              { type: 'text', text: 'Completed first task.' },
            ],
          },
          assistantMetadata: {
            kind: 'final',
            completionStatus: 'complete',
            finishReason: 'end_turn',
          },
        } as any,
        { role: 'user', content: 'Second task' },
      ]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages).toEqual([
        { role: 'user', content: 'First task' },
        { role: 'assistant', content: 'Completed first task.' },
        { role: 'user', content: 'Second task' },
      ]);
    });

    it('converts OpenAI image_url user content to Anthropic image blocks', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          content: [{ type: 'text', text: 'It is a tiny PNG.' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 8, output_tokens: 5 },
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'anthropic-key',
        model: 'claude-sonnet-4-6',
      }));

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
      expect(body.messages).toEqual([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this image.' },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: 'abc',
              },
            },
          ],
        },
      ]);
    });

    it('uses max_output_tokens and omits temperature for OpenAI GPT-5 models', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(makeOpenAIResponsesPayload()),
      });

      const service = new LlmService(makeConfig({
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-openai',
        model: 'gpt-5.4',
      }));

      await service.sendMessage([{ role: 'user', content: 'Hello' }], {
        model: 'gpt-5.4',
        maxTokens: 512,
        temperature: 0.7,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.max_output_tokens).toBe(512);
      expect(body.temperature).toBeUndefined();
    });

    it('keeps max_tokens and temperature for non-OpenAI compatible providers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ choices: [{ message: { content: 'ok' } }] }),
      });

      const service = new LlmService(makeConfig({
        id: 'custom',
        name: 'Custom',
        baseUrl: 'https://example.ai/v1',
        apiKey: 'sk-custom',
        model: 'custom-model',
      }));

      await service.sendMessage([{ role: 'user', content: 'Hello' }], {
        model: 'custom-model',
        maxTokens: 256,
        temperature: 0.4,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.max_tokens).toBe(256);
      expect(body.max_completion_tokens).toBeUndefined();
      expect(body.temperature).toBe(0.4);
    });

    it('should pass abort signal', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ choices: [] }),
      });

      const controller = new AbortController();
      const service = new LlmService(makeConfig());
      await service.sendMessage([{ role: 'user', content: 'test' }], {
        signal: controller.signal,
      });

      expect(mockFetch.mock.calls[0][1].signal).toBe(controller.signal);
    });

    it('adds OpenAI prompt cache hints when enabled', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(makeOpenAIResponsesPayload()),
      });

      const service = new LlmService(makeConfig({
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-openai',
        model: 'gpt-5.4',
      }));

      await service.sendMessage([{ role: 'user', content: 'Hello' }], {
        enablePromptCaching: true,
        promptCacheKey: 'cm:test:key',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.prompt_cache_key).toBe('cm:test:key');
      expect(body.prompt_cache_retention).toBe('in_memory');
    });

    it('keeps stable core tools at the front of cache-aware OpenAI requests', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(makeOpenAIResponsesPayload()),
      });

      const service = new LlmService(makeConfig({
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-openai',
        model: 'gpt-5.4',
      }));

      await service.sendMessage([{ role: 'user', content: 'Hello' }], {
        enablePromptCaching: true,
        promptCacheKey: 'cm:test:key',
        tools: [
          {
            name: 'browser_navigate',
            description: 'Navigate to a page.',
            input_schema: {
              type: 'object',
              properties: { url: { type: 'string' } },
              required: ['url'],
            },
          },
          {
            name: 'read_file',
            description: 'Read a file.',
            input_schema: {
              type: 'object',
              properties: { path: { type: 'string' } },
              required: ['path'],
            },
          },
          {
            name: 'tool_catalog',
            description: 'Inspect deferred tool categories.',
            input_schema: {
              type: 'object',
              properties: {},
            },
          },
        ],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tools.map((tool: any) => tool.name)).toEqual([
        'read_file',
        'tool_catalog',
        'browser_navigate',
      ]);
    });

    it('compacts oversized OpenAI prompt cache keys before serialization', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(makeOpenAIResponsesPayload()),
      });

      const service = new LlmService(makeConfig({
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-openai',
        model: 'gpt-5.1-codex-mini',
      }));

      const rawKey = 'cm:openai-enterprise-production:gpt-5.1-codex-mini:sub-1743476400000-mchsvm1f_abc123_7';

      await service.sendMessage([{ role: 'user', content: 'Hello' }], {
        enablePromptCaching: true,
        promptCacheKey: rawKey,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.prompt_cache_key).toBe(normalizeOpenAIPromptCacheKey(rawKey));
      expect(body.prompt_cache_key.length).toBeLessThanOrEqual(OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH);
      expect(body.prompt_cache_retention).toBe('in_memory');
    });

    it('normalizes legacy OpenAI prompt cache retention values', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(makeOpenAIResponsesPayload()),
      });

      const service = new LlmService(makeConfig({
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-openai',
        model: 'gpt-5.4',
      }));

      await service.sendMessage([{ role: 'user', content: 'Hello' }], {
        enablePromptCaching: true,
        promptCacheRetention: 'in-memory',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.prompt_cache_retention).toBe('in_memory');
    });

    it('adds Anthropic automatic cache control when enabled', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 2 },
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'anthropic-key',
        model: 'claude-sonnet-4-6',
      }));

      await service.sendMessage([{ role: 'user', content: 'Hello' }], {
        enablePromptCaching: true,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.cache_control).toEqual({ type: 'ephemeral' });
    });

    it('adds Anthropic explicit cache breakpoints for the stable system and tool prefix', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 2 },
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'anthropic-key',
        model: 'claude-sonnet-4-6',
      }));

      await service.sendMessage([
        { role: 'system', content: 'Stable core\n\nDynamic tail' },
        { role: 'user', content: 'Hello' },
      ], {
        enablePromptCaching: true,
        systemPromptSections: [
          { text: 'Stable core', cacheable: true },
          { text: 'Dynamic tail', cacheable: false },
        ],
        tools: [
          {
            name: 'browser_navigate',
            description: 'Navigate to a page.',
            input_schema: {
              type: 'object',
              properties: {
                url: { type: 'string' },
              },
              required: ['url'],
            },
          },
          {
            name: 'read_file',
            description: 'Read a file.',
            input_schema: {
              type: 'object',
              properties: {
                path: { type: 'string' },
              },
              required: ['path'],
            },
          },
          {
            name: 'tool_catalog',
            description: 'Inspect deferred tool categories.',
            input_schema: {
              type: 'object',
              properties: {},
            },
          },
        ],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.cache_control).toEqual({ type: 'ephemeral' });
      expect(body.system).toEqual([
        { type: 'text', text: 'Stable core', cache_control: { type: 'ephemeral' } },
        { type: 'text', text: 'Dynamic tail' },
      ]);
      expect(body.tools.map((tool: any) => tool.name)).toEqual([
        'read_file',
        'tool_catalog',
        'browser_navigate',
      ]);
      expect(body.tools[1]).toEqual(expect.objectContaining({
        cache_control: { type: 'ephemeral' },
      }));
      expect(body.tools[2].cache_control).toBeUndefined();
    });

    it('forwards Anthropic adaptive thinking parameters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 2 },
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'anthropic-key',
        model: 'claude-sonnet-4-6',
      }));

      await service.sendMessage([{ role: 'user', content: 'Think carefully' }], {
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
      expect(body.output_config).toEqual({ effort: 'medium' });
    });

    it('adds Anthropic native structured output without requiring thinking', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          content: [{ type: 'text', text: '{"approved":true}' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 2 },
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'anthropic-key',
        model: 'claude-sonnet-4-6',
      }));

      const result = await service.sendMessage([{ role: 'user', content: 'Return the pilot report.' }], {
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
      expect(body.thinking).toBeUndefined();
      expect(body.output_config).toEqual({
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['approved'],
            properties: {
              approved: { type: 'boolean' },
            },
          },
        },
      });
      expect(result?.providerResponse).toEqual({
        provider: 'anthropic',
        response: expect.objectContaining({
          content: expect.any(Array),
        }),
      });
    });

    it('returns Anthropic summarized thinking as message reasoning in non-streaming responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          content: [
            { type: 'thinking', thinking: 'Need a plan first.', signature: 'sig-A' },
            { type: 'text', text: 'ok' },
          ],
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 2 },
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'anthropic-key',
        model: 'claude-sonnet-4-6',
      }));

      const result = await service.sendMessage([{ role: 'user', content: 'Think carefully' }], {
        thinking: { type: 'adaptive' },
      });

      expect(result.choices[0].message.reasoning).toBe('Need a plan first.');
      expect(result.choices[0].message.providerReplay).toEqual({
        anthropicBlocks: [
          { type: 'thinking', thinking: 'Need a plan first.', signature: 'sig-A' },
          { type: 'text', text: 'ok' },
        ],
      });
    });

    it('removes Anthropic temperature when adaptive thinking is enabled', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 2 },
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'anthropic-key',
        model: 'claude-sonnet-4-6',
      }));

      await service.sendMessage([{ role: 'user', content: 'Think carefully' }], {
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high' },
        temperature: 0.2,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
      expect(body.output_config).toEqual({ effort: 'high' });
      expect(body.temperature).toBeUndefined();
    });

    it('omits non-1 direct Anthropic temperature for Claude Sonnet 4.6 requests', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 2 },
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'anthropic-key',
        model: 'claude-sonnet-4-6',
      }));

      await service.sendMessage([{ role: 'user', content: 'Return a structured review.' }], {
        temperature: 0,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.temperature).toBeUndefined();
    });

    it('preserves direct Anthropic temperature for Claude Haiku 4.5 requests', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 2 },
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'anthropic-key',
        model: 'claude-haiku-4-5',
      }));

      await service.sendMessage([{ role: 'user', content: 'Be concise.' }], {
        temperature: 0.2,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.temperature).toBe(0.2);
    });

    it('disables Anthropic thinking when tool use is forced', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 2 },
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'anthropic-key',
        model: 'claude-sonnet-4-6',
      }));

      await service.sendMessage([{ role: 'user', content: 'Use the tool.' }], {
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        tools: [{
          name: 'read_file',
          description: 'Read a file.',
          input_schema: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
          },
        }],
        toolChoice: 'required',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tool_choice).toEqual({ type: 'any' });
      expect(body.thinking).toBeUndefined();
      expect(body.output_config).toBeUndefined();
    });

    it('allows required Anthropic tool turns to disable parallel tool use', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 2 },
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'anthropic-key',
        model: 'claude-sonnet-4-6',
      }));

      await service.sendMessage([{ role: 'user', content: 'Wait for the worker output.' }], {
        tools: [{
          name: 'sessions_wait',
          description: 'Wait for background worker output.',
          input_schema: {
            type: 'object',
            properties: { sessionId: { type: 'string' } },
            required: [],
          },
        }],
        toolChoice: { type: 'required', disableParallelToolUse: true },
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tool_choice).toEqual({
        type: 'any',
        disable_parallel_tool_use: true,
      });
    });

    it('forces one exact Anthropic tool when requested', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 2 },
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'anthropic-key',
        model: 'claude-sonnet-4-6',
      }));

      await service.sendMessage([{ role: 'user', content: 'Return the pilot report.' }], {
        thinking: { type: 'adaptive' },
        tools: [{
          name: 'pilot_report',
          description: 'Return the pilot report.',
          input_schema: {
            type: 'object',
            properties: { approved: { type: 'boolean' } },
            required: ['approved'],
            additionalProperties: false,
          },
        }],
        toolChoice: { type: 'tool', name: 'pilot_report', disableParallelToolUse: true },
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tool_choice).toEqual({
        type: 'tool',
        name: 'pilot_report',
        disable_parallel_tool_use: true,
      });
      expect(body.thinking).toBeUndefined();
    });

    it('keeps Anthropic thinking enabled when tool use is optional', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 2 },
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'anthropic-key',
        model: 'claude-sonnet-4-6',
      }));

      await service.sendMessage([{ role: 'user', content: 'Use a tool if needed.' }], {
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        tools: [{
          name: 'read_file',
          description: 'Read a file.',
          input_schema: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
          },
        }],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tools).toHaveLength(1);
      expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
      expect(body.output_config).toEqual({ effort: 'medium' });
    });

    it('disables Anthropic thinking while continuing a tool loop without replayable thinking blocks', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 2 },
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'anthropic-key',
        model: 'claude-sonnet-4-6',
      }));

      await service.sendMessage([
        { role: 'user', content: 'Run the tool.' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [{
            id: 'toolu_1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"notes.txt"}' },
          }],
        } as any,
        { role: 'tool', tool_call_id: 'toolu_1', content: 'file contents' } as any,
      ], {
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        tools: [{
          name: 'read_file',
          description: 'Read a file.',
          input_schema: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
          },
        }],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.thinking).toBeUndefined();
      expect(body.output_config).toBeUndefined();
    });

    it('drops partial Anthropic signed replay blocks when they do not cover every tool call', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 2 },
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'anthropic-key',
        model: 'claude-sonnet-4-6',
      }));

      await service.sendMessage([
        { role: 'user', content: 'Run the tools.' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [{
            id: 'toolu_1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"notes.txt"}' },
            raw: {
              id: 'toolu_1',
              type: 'function',
              function: { name: 'read_file', arguments: '{"path":"notes.txt"}' },
              extra_content: {
                anthropic: {
                  assistant_blocks: [
                    { type: 'thinking', thinking: 'I should inspect both tools first.', signature: 'sig-A' },
                    { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'notes.txt' } },
                  ],
                },
              },
            },
          }, {
            id: 'toolu_2',
            type: 'function',
            function: { name: 'list_dir', arguments: '{"path":"."}' },
          }],
        } as any,
        { role: 'tool', tool_call_id: 'toolu_1', content: 'file contents' } as any,
        { role: 'tool', tool_call_id: 'toolu_2', content: 'directory contents' } as any,
      ], {
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        tools: [{
          name: 'read_file',
          description: 'Read a file.',
          input_schema: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
          },
        }, {
          name: 'list_dir',
          description: 'List a directory.',
          input_schema: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
          },
        }],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages[1]).toEqual({
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'notes.txt' } },
          { type: 'tool_use', id: 'toolu_2', name: 'list_dir', input: { path: '.' } },
        ],
      });
      expect(body.thinking).toBeUndefined();
      expect(body.output_config).toBeUndefined();
    });

    it('keeps Anthropic thinking enabled while continuing a tool loop with replayable thinking blocks', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 2 },
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'anthropic-key',
        model: 'claude-sonnet-4-6',
      }));

      await service.sendMessage([
        { role: 'user', content: 'Run the tool.' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [{
            id: 'toolu_1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"notes.txt"}' },
            raw: {
              id: 'toolu_1',
              type: 'function',
              function: { name: 'read_file', arguments: '{"path":"notes.txt"}' },
              extra_content: {
                anthropic: {
                  assistant_blocks: [
                    { type: 'thinking', thinking: 'I should inspect the file first.', signature: 'sig-A' },
                    { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'notes.txt' } },
                  ],
                },
              },
            },
          }],
        } as any,
        { role: 'tool', tool_call_id: 'toolu_1', content: 'file contents' } as any,
      ], {
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        temperature: 0.2,
        tools: [{
          name: 'read_file',
          description: 'Read a file.',
          input_schema: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
          },
        }],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages[1]).toEqual({
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'I should inspect the file first.', signature: 'sig-A' },
          { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'notes.txt' } },
        ],
      });
      expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
      expect(body.output_config).toEqual({ effort: 'medium' });
      expect(body.temperature).toBeUndefined();
    });

    it('replays Anthropic providerReplay blocks when raw tool metadata is unavailable', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 2 },
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'anthropic-key',
        model: 'claude-sonnet-4-6',
      }));

      await service.sendMessage([
        { role: 'user', content: 'Run the tool.' },
        {
          role: 'assistant',
          content: '',
          providerReplay: {
            anthropicBlocks: [
              { type: 'thinking', thinking: 'I should inspect the file first.', signature: 'sig-A' },
              { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'notes.txt' } },
            ],
          },
          tool_calls: [{
            id: 'toolu_1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"notes.txt"}' },
          }],
        } as any,
        { role: 'tool', tool_call_id: 'toolu_1', content: 'file contents' } as any,
      ], {
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        tools: [{
          name: 'read_file',
          description: 'Read a file.',
          input_schema: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
          },
        }],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages[1]).toEqual({
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'I should inspect the file first.', signature: 'sig-A' },
          { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'notes.txt' } },
        ],
      });
      expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
      expect(body.output_config).toEqual({ effort: 'medium' });
    });

    it('keeps Anthropic thinking enabled while continuing a tool loop with replayable redacted thinking blocks', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 2 },
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'anthropic-key',
        model: 'claude-sonnet-4-6',
      }));

      await service.sendMessage([
        { role: 'user', content: 'Run the tool.' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [{
            id: 'toolu_1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"notes.txt"}' },
            raw: {
              id: 'toolu_1',
              type: 'function',
              function: { name: 'read_file', arguments: '{"path":"notes.txt"}' },
              extra_content: {
                anthropic: {
                  assistant_blocks: [
                    { type: 'redacted_thinking', data: 'opaque-redacted-thinking' },
                    { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'notes.txt' } },
                  ],
                },
              },
            },
          }],
        } as any,
        { role: 'tool', tool_call_id: 'toolu_1', content: 'file contents' } as any,
      ], {
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        tools: [{
          name: 'read_file',
          description: 'Read a file.',
          input_schema: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
          },
        }],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages[1]).toEqual({
        role: 'assistant',
        content: [
          { type: 'redacted_thinking', data: 'opaque-redacted-thinking' },
          { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'notes.txt' } },
        ],
      });
      expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
      expect(body.output_config).toEqual({ effort: 'medium' });
    });

    it('clamps Anthropic thinking budgets below max_tokens for direct callers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 2 },
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'anthropic-key',
        model: 'claude-sonnet-4-6',
      }));

      await service.sendMessage([{ role: 'user', content: 'Think carefully' }], {
        maxTokens: 2048,
        thinking: { type: 'enabled', budget_tokens: 32768 },
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.max_tokens).toBe(2048);
      expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 2047, display: 'summarized' });
    });

    it('preserves full Anthropic tool descriptions per best practices', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 4 },
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'anthropic-key',
        model: 'claude-sonnet-4-6',
      }));

      const fullDescription =
        'Spawn an isolated sub-agent session to perform a task in parallel. ' +
        'By default it launches in the background so the agent can poll status and continue other work. ' +
        'Sub-agents are intentionally untimed and keep running until completion unless you cancel them for drift or redundancy. ' +
        'Use waitForCompletion=true only when you intentionally want to wait on that worker in the current tool call.';

      await service.sendMessage([{ role: 'user', content: 'Spawn a sub-agent.' }], {
        tools: [{
          name: 'sessions_spawn',
          description: fullDescription,
          input_schema: {
            type: 'object',
            properties: {
              prompt: { type: 'string', description: 'Task instructions for the sub-agent' },
              model: { type: 'string', description: 'Model override (optional)' },
            },
            required: ['prompt'],
          },
        }],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      // Full description preserved (not truncated to first sentence)
      expect(body.tools[0].description).toBe(fullDescription);
      // Property descriptions preserved
      expect(body.tools[0].input_schema.properties.prompt.description).toBe('Task instructions for the sub-agent');
      expect(body.tools[0].input_schema.properties.model.description).toBe('Model override (optional)');
    });

    it('caps extremely long Anthropic tool descriptions at 2000 characters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 2 },
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'anthropic-key',
        model: 'claude-sonnet-4-6',
      }));

      const longDescription = 'X'.repeat(3000);

      await service.sendMessage([{ role: 'user', content: 'test' }], {
        tools: [{
          name: 'big_tool',
          description: longDescription,
          input_schema: { type: 'object', properties: {} },
        }],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tools[0].description.length).toBe(2000);
      expect(body.tools[0].description.endsWith('...')).toBe(true);
    });

    it('preserves Anthropic schema descriptions for array items and nested objects', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 2 },
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'anthropic-key',
        model: 'claude-sonnet-4-6',
      }));

      await service.sendMessage([{ role: 'user', content: 'test' }], {
        tools: [{
          name: 'multi_tool',
          description: 'A tool with nested schemas.',
          input_schema: {
            type: 'object',
            properties: {
              tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of tags to apply',
              },
              config: {
                type: 'object',
                description: 'Configuration options',
                properties: {
                  verbose: { type: 'boolean', description: 'Enable verbose output' },
                },
              },
            },
          },
        }],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const schema = body.tools[0].input_schema;
      expect(schema.properties.tags.description).toBe('List of tags to apply');
      expect(schema.properties.config.description).toBe('Configuration options');
      expect(schema.properties.config.properties.verbose.description).toBe('Enable verbose output');
    });

    it('normalizes MCP-style array item schemas for Anthropic tool declarations', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 2 },
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'anthropic-key',
        model: 'claude-sonnet-4-6',
      }));

      await service.sendMessage([{ role: 'user', content: 'test' }], {
        tools: [{
          name: 'mcp__atars__get_multi_indicator',
          description: 'Retrieve multiple indicators.',
          input_schema: {
            type: 'object',
            properties: {
              indicators: {
                type: 'array',
                items: {
                  description: 'Indicator code',
                  enum: ['rsi', 'macd'],
                },
              },
            },
            required: ['indicators'],
          },
        }],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const schema = body.tools[0].input_schema;

      expect(schema.properties.indicators.items.type).toBe('string');
      expect(schema.properties.indicators.items.description).toBe('Indicator code');
      expect(schema.properties.indicators.items.enum).toEqual(['rsi', 'macd']);
    });
  });

  describe('generateImage', () => {
    it('uses the OpenAI image generations endpoint and returns base64 image data', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          output_format: 'png',
          data: [{
            b64_json: 'abc123',
            revised_prompt: 'revised prompt',
          }],
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-image-1.5',
      }));

      const result = await service.generateImage({
        prompt: 'A retro robot poster',
        quality: 'high',
        format: 'png',
      });

      expect(result.b64_json).toBe('abc123');
      expect(result.revisedPrompt).toBe('revised prompt');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/images/generations',
        expect.objectContaining({ method: 'POST' }),
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.prompt).toBe('A retro robot poster');
      expect(body.model).toBe('gpt-image-1.5');
      expect(body.output_format).toBe('png');
      expect(body.quality).toBe('high');
    });

    it('normalizes image generation usage metadata', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          output_format: 'png',
          data: [{
            b64_json: 'abc123',
          }],
          usage: {
            input_tokens: 120,
            output_tokens: 480,
            total_tokens: 600,
            input_tokens_details: {
              text_tokens: 20,
              image_tokens: 100,
            },
            output_tokens_details: {
              image_tokens: 480,
            },
          },
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-image-1.5',
      }));

      const result = await service.generateImage({
        prompt: 'A retro robot poster',
        format: 'png',
      });

      expect(result.usage).toEqual(
        expect.objectContaining({
          model: 'gpt-image-1.5',
          inputTokens: 120,
          outputTokens: 480,
          totalTokens: 600,
          tokenDetails: expect.objectContaining({
            inputImageTokens: 100,
            outputImageTokens: 480,
          }),
        }),
      );
    });

    it('uses Gemini generateContent for Gemini providers with an explicit user role', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          candidates: [{
            content: {
              parts: [{ inlineData: { mimeType: 'image/png', data: 'gemini-image' } }],
            },
          }],
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'gemini',
        name: 'Google Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: 'gemini-key',
        model: 'gemini-3.1-flash-image-preview',
      }));

      const result = await service.generateImage({ prompt: 'A watercolor fox', size: '1024x1024' });

      expect(result.b64_json).toBe('gemini-image');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'x-goog-api-key': 'gemini-key' }),
        }),
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'A watercolor fox' }] }]);
      expect(body.generationConfig).toEqual({
        responseModalities: ['IMAGE'],
        imageConfig: {
          aspectRatio: '1:1',
          imageSize: '1K',
        },
      });
    });

    it('uses the Vertex publisher-model endpoint for Gemini image generation on Vertex providers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          candidates: [{
            content: {
              parts: [{ inlineData: { mimeType: 'image/png', data: 'vertex-image' } }],
            },
          }],
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'gemini-vertex-image',
        name: 'Gemini',
        baseUrl: 'https://aiplatform.googleapis.com/v1',
        apiKey: 'gemini-key',
        model: 'gemini-3.1-flash-image-preview',
      }));

      const result = await service.generateImage({ prompt: 'A watercolor fox' });

      expect(result.b64_json).toBe('vertex-image');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-3.1-flash-image-preview:generateContent',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'x-goog-api-key': 'gemini-key' }),
        }),
      );
    });

    it('surfaces Gemini prompt blocks during image generation', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          promptFeedback: {
            blockReason: 'IMAGE_SAFETY',
          },
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'gemini',
        name: 'Google Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: 'gemini-key',
        model: 'gemini-3.1-flash-image-preview',
      }));

      await expect(service.generateImage({ prompt: 'A violent scene' })).rejects.toThrow(
        'Gemini image prompt blocked: IMAGE_SAFETY',
      );
    });

    it('surfaces Gemini no-image finish reasons during image generation', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          candidates: [{
            finishReason: 'NO_IMAGE',
            content: {
              parts: [{ text: 'No image could be produced.' }],
            },
          }],
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'gemini',
        name: 'Google Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: 'gemini-key',
        model: 'gemini-3.1-flash-image-preview',
      }));

      await expect(service.generateImage({ prompt: 'A portrait' })).rejects.toThrow(
        'Gemini image generation returned no image data (finish reason: no_image)',
      );
    });

    it('throws for anthropic providers', async () => {
      const service = new LlmService(makeConfig({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'anthropic-key',
      }));

      await expect(service.generateImage({ prompt: 'A portrait' })).rejects.toThrow(
        'Anthropic image generation is not supported',
      );
    });
  });

  describe('editImage', () => {
    it('uses the OpenAI image edits endpoint and normalizes usage', async () => {
      class MockFormData {
        entries: Array<[string, unknown]> = [];

        append(name: string, value: unknown) {
          this.entries.push([name, value]);
        }
      }

      const originalFormData = global.FormData;
      (global as typeof globalThis & { FormData: typeof MockFormData }).FormData = MockFormData as any;

      try {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            output_format: 'webp',
            data: [{
              b64_json: 'edited123',
              revised_prompt: 'edited prompt',
            }],
            usage: {
              input_tokens: 80,
              output_tokens: 320,
              total_tokens: 400,
            },
          }),
        });

        const service = new LlmService(makeConfig({
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-openai',
          model: 'gpt-image-1.5',
        }));

        const result = await service.editImage({
          prompt: 'Add a red scarf',
          images: [{
            uri: 'file:///tmp/source.png',
            name: 'source.png',
            mimeType: 'image/png',
          }],
          mask: {
            uri: 'file:///tmp/mask.png',
            name: 'mask.png',
            mimeType: 'image/png',
          },
          format: 'webp',
          inputFidelity: 'high',
          outputCompression: 82,
        });

        expect(mockFetch).toHaveBeenCalledWith(
          'https://api.openai.com/v1/images/edits',
          expect.objectContaining({ method: 'POST' }),
        );

        const body = mockFetch.mock.calls[0][1].body as MockFormData;
        const fieldNames = body.entries.map(([name]) => name);
        expect(fieldNames).toEqual(
          expect.arrayContaining([
            'model',
            'prompt',
            'image',
            'mask',
            'output_format',
            'input_fidelity',
            'output_compression',
          ]),
        );

        expect(result).toEqual(
          expect.objectContaining({
            b64_json: 'edited123',
            revisedPrompt: 'edited prompt',
            outputFormat: 'webp',
            usage: expect.objectContaining({
              model: 'gpt-image-1.5',
              inputTokens: 80,
              outputTokens: 320,
              totalTokens: 400,
            }),
          }),
        );
      } finally {
        (global as typeof globalThis & { FormData: typeof MockFormData | undefined }).FormData = originalFormData as any;
      }
    });

    it('uses Gemini generateContent for image edits with inline image data', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          candidates: [{
            content: {
              parts: [{ inlineData: { mimeType: 'image/png', data: 'gemini-edited' } }],
            },
          }],
          usageMetadata: {
            promptTokenCount: 64,
            candidatesTokenCount: 256,
            totalTokenCount: 320,
          },
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'gemini',
        name: 'Google Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: 'gemini-key',
        model: 'gemini-3.1-flash-image-preview',
      }));

      const result = await service.editImage({
        prompt: 'Add dramatic studio lighting',
        images: [{
          uri: 'file:///tmp/source.png',
          name: 'source.png',
          mimeType: 'image/png',
          dataUri: 'data:image/png;base64,AAAA',
        }],
        size: '1024x1024',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'x-goog-api-key': 'gemini-key' }),
        }),
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.contents).toEqual([
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'image/png', data: 'AAAA' } },
            { text: 'Add dramatic studio lighting' },
          ],
        },
      ]);

      expect(result).toEqual(
        expect.objectContaining({
          b64_json: 'gemini-edited',
          usage: expect.objectContaining({
            model: 'gemini-3.1-flash-image-preview',
            inputTokens: 64,
            outputTokens: 256,
            totalTokens: 320,
          }),
        }),
      );
    });
  });

  describe('streamMessage', () => {
    function createMockStreamResponse(chunks: string[]) {
      let index = 0;
      const encoder = new TextEncoder();
      const readableStream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (index < chunks.length) {
            controller.enqueue(encoder.encode(chunks[index]));
            index++;
          } else {
            controller.close();
          }
        },
      });

      return {
        ok: true,
        body: readableStream,
      };
    }

    it('streams on-device tokens from the local runtime', async () => {
      mockStreamLocalLlmMessage.mockImplementationOnce(async function* () {
        yield { type: 'token', content: 'Local' };
        yield { type: 'token', content: ' reply' };
        yield { type: 'done' };
      });

      const service = new LlmService(makeOnDeviceConfig());
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'Stream locally' }])) {
        events.push(event);
      }

      expect(mockStreamLocalLlmMessage).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'on-device' }),
        [{ role: 'user', content: 'Stream locally' }],
      );
      expect(mockFetch).not.toHaveBeenCalled();
      expect(events.filter((event) => event.type === 'token')).toEqual([
        { type: 'token', content: 'Local' },
        { type: 'token', content: ' reply' },
      ]);
      expect(events.find((event) => event.type === 'done')).toEqual({
        type: 'done',
        completion: {
          completionStatus: 'complete',
        },
      });
    });

    it('should stream tokens from SSE response', async () => {
      const response = createMockStreamResponse([
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
        'data: [DONE]\n\n',
      ]);
      mockFetch.mockResolvedValueOnce(response);

      const service = new LlmService(makeConfig());
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'Hi' }])) {
        events.push(event);
      }

      const tokens = events.filter((e) => e.type === 'token');
      expect(tokens).toHaveLength(2);
      expect(tokens[0].content).toBe('Hello');
      expect(tokens[1].content).toBe(' world');

      const done = events.find((e) => e.type === 'done');
      expect(done).toBeDefined();
      expect(done.content).toBe('Hello world');
    });

    it('should handle reasoning tokens', async () => {
      const response = createMockStreamResponse([
        'data: {"choices":[{"delta":{"reasoning_content":"Let me think"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"Answer"}}]}\n\n',
        'data: [DONE]\n\n',
      ]);
      mockFetch.mockResolvedValueOnce(response);

      const service = new LlmService(makeConfig());
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'Think' }])) {
        events.push(event);
      }

      const reasoning = events.filter((e) => e.type === 'reasoning');
      expect(reasoning).toHaveLength(1);
      expect(reasoning[0].content).toBe('Let me think');
    });

    it('routes Gemini reasoning tokens to dedicated reasoning events', async () => {
      const response = createMockStreamResponse([
        'data: {"candidates":[{"content":{"parts":[{"text":"Let me think","thought":true}]}}]}\n\n',
        'data: {"candidates":[{"content":{"parts":[{"text":"Answer"}]}}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":5,"thoughtsTokenCount":7,"totalTokenCount":22}}\n\n',
      ]);
      mockFetch.mockResolvedValueOnce(response);

      const service = new LlmService(makeConfig({
        id: 'gemini',
        name: 'Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        apiKey: 'AIza-test',
        model: 'gemini-2.5-pro',
      }));
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'Think' }])) {
        events.push(event);
      }

      expect(mockFetch).toHaveBeenCalledWith(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse',
        expect.any(Object),
      );

      expect(events.filter((e) => e.type === 'reasoning')).toEqual([
        expect.objectContaining({ type: 'reasoning', content: 'Let me think' }),
      ]);
      expect(events.filter((e) => e.type === 'token')).toEqual([
        expect.objectContaining({ type: 'token', content: 'Answer' }),
      ]);
      expect(events.find((e) => e.type === 'done')).toEqual(
        expect.objectContaining({
          type: 'done',
          content: 'Answer',
          providerReplay: {
            geminiParts: [
              { text: 'Let me think', thought: true },
              { text: 'Answer' },
            ],
          },
        }),
      );
    });

    it('routes structured thought parts to reasoning for non-Gemini streams', async () => {
      const response = createMockStreamResponse([
        'data: {"choices":[{"delta":{"content":[{"type":"text","text":"Need plan","thought":true},{"type":"text","text":"Answer"}]}}]}\n\n',
        'data: [DONE]\n\n',
      ]);
      mockFetch.mockResolvedValueOnce(response);

      const service = new LlmService(makeConfig());
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'Think' }])) {
        events.push(event);
      }

      expect(events.filter((e) => e.type === 'reasoning')).toEqual([
        expect.objectContaining({ type: 'reasoning', content: 'Need plan' }),
      ]);
      expect(events.filter((e) => e.type === 'token')).toEqual([
        expect.objectContaining({ type: 'token', content: 'Answer' }),
      ]);
      expect(events.find((e) => e.type === 'done')).toEqual(
        expect.objectContaining({ type: 'done', content: 'Answer' }),
      );
    });

    it('routes Gemini thought parts embedded in structured content arrays to reasoning', async () => {
      const response = createMockStreamResponse([
        'data: {"candidates":[{"content":{"parts":[{"text":"Need plan","thought":true},{"text":"Answer"}]}}]}\n\n',
      ]);
      mockFetch.mockResolvedValueOnce(response);

      const service = new LlmService(makeConfig({
        id: 'gemini',
        name: 'Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        apiKey: 'AIza-test',
        model: 'gemini-3.1-pro-preview',
      }));
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'Think' }])) {
        events.push(event);
      }

      expect(events.filter((e) => e.type === 'reasoning')).toEqual([
        expect.objectContaining({ type: 'reasoning', content: 'Need plan' }),
      ]);
      expect(events.filter((e) => e.type === 'token')).toEqual([
        expect.objectContaining({ type: 'token', content: 'Answer' }),
      ]);
      expect(events.find((e) => e.type === 'done')).toEqual(
        expect.objectContaining({ type: 'done', content: 'Answer' }),
      );
    });

    it('marks Gemini streams without a finish reason as incomplete completions', async () => {
      const response = createMockStreamResponse([
        'data: {"candidates":[{"content":{"parts":[{"text":"Answer"}]}}]}\n\n',
      ]);
      mockFetch.mockResolvedValueOnce(response);

      const service = new LlmService(makeConfig({
        id: 'gemini',
        name: 'Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        apiKey: 'AIza-test',
        model: 'gemini-2.5-pro',
      }));
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'Think' }])) {
        events.push(event);
      }

      expect(events.find((event) => event.type === 'done')).toEqual(
        expect.objectContaining({
          type: 'done',
          content: 'Answer',
          completion: {
            completionStatus: 'incomplete',
            finishReason: 'stream_ended_without_finish_reason',
          },
        }),
      );
    });

    it('dedupes cumulative Gemini text deltas', async () => {
      const response = createMockStreamResponse([
        'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}\n\n',
        'data: {"candidates":[{"content":{"parts":[{"text":"Hello world"}]}}]}\n\n',
        'data: {"candidates":[{"content":{"parts":[{"text":"Hello world from Gemini"}]}}]}\n\n',
      ]);
      mockFetch.mockResolvedValueOnce(response);

      const service = new LlmService(makeConfig({
        id: 'gemini',
        name: 'Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        apiKey: 'AIza-test',
        model: 'gemini-3-flash-preview',
      }));
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'Hi' }])) {
        events.push(event);
      }

      expect(events.filter((e) => e.type === 'token').map((e) => e.content)).toEqual([
        'Hello',
        ' world',
        ' from Gemini',
      ]);
      expect(events.find((e) => e.type === 'done')).toEqual(
        expect.objectContaining({ type: 'done', content: 'Hello world from Gemini' }),
      );
    });

    it('should handle tool call chunks', async () => {
      const response = createMockStreamResponse([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"tc1","function":{"name":"read_file","arguments":""}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"path\\":"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"test.txt\\"}"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
        'data: [DONE]\n\n',
      ]);
      mockFetch.mockResolvedValueOnce(response);

      const service = new LlmService(makeConfig());
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'Read file' }])) {
        events.push(event);
      }

      const toolCalls = events.filter((e) => e.type === 'tool_call');
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].toolCall.id).toBe('tc1');
      expect(toolCalls[0].toolCall.name).toBe('read_file');
      expect(toolCalls[0].toolCall.arguments).toBe('{"path":"test.txt"}');
      expect(events.findIndex((event) => event.type === 'tool_call')).toBeLessThan(
        events.findIndex((event) => event.type === 'done'),
      );
    });

    it('should merge cumulative tool call argument snapshots for compat streams', async () => {
      const response = createMockStreamResponse([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"tc_atars_1","function":{"name":"atars__get_multi_indicator","arguments":""}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"symbol\\":\\"AAPL\\""}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"symbol\\":\\"AAPL\\",\\"indicators\\":[\\"rsi\\"]"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"symbol\\":\\"AAPL\\",\\"indicators\\":[\\"rsi\\",\\"macd\\"],\\"timeframe\\":\\"1d\\"}"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
        'data: [DONE]\n\n',
      ]);
      mockFetch.mockResolvedValueOnce(response);

      const service = new LlmService(makeConfig());
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'Use aTars' }])) {
        events.push(event);
      }

      const toolCalls = events.filter((e) => e.type === 'tool_call');
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].toolCall.id).toBe('tc_atars_1');
      expect(toolCalls[0].toolCall.name).toBe('atars__get_multi_indicator');
      expect(toolCalls[0].toolCall.arguments).toBe('{"symbol":"AAPL","indicators":["rsi","macd"],"timeframe":"1d"}');
      expect(JSON.parse(toolCalls[0].toolCall.arguments)).toEqual({
        symbol: 'AAPL',
        indicators: ['rsi', 'macd'],
        timeframe: '1d',
      });
    });

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

      const service = new LlmService(makeConfig({
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-openai',
        model: 'gpt-5.4',
      }));
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'Read file' }])) {
        events.push(event);
      }

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/responses',
        expect.any(Object),
      );

      expect(events.filter((e) => e.type === 'token').map((e) => e.content)).toEqual(['Reading', ' file']);
      expect(events.filter((e) => e.type === 'reasoning').map((e) => e.content)).toEqual(['Need tool']);

      const usage = events.find((e) => e.type === 'usage');
      expect(usage).toEqual(expect.objectContaining({
        type: 'usage',
        usage: expect.objectContaining({
          inputTokens: 10,
          outputTokens: 6,
          cacheReadTokens: 4,
        }),
      }));

      const toolCalls = events.filter((e) => e.type === 'tool_call');
      expect(toolCalls.length).toBeGreaterThanOrEqual(1);
      const finalToolCall = toolCalls[toolCalls.length - 1]?.toolCall;
      expect(finalToolCall?.id).toBe('call_1');
      expect(finalToolCall?.name).toBe('read_file');
      expect(finalToolCall?.arguments).toBe('{"path":"test.txt"}');
      expect(finalToolCall?.raw?._openai).toEqual(expect.objectContaining({
        itemId: 'fc_1',
        callId: 'call_1',
        outputIndex: 1,
        reasoningItems: [{
          id: 'rs_1',
          type: 'reasoning',
          content: [],
          summary: [],
        }],
      }));
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

      const service = new LlmService(makeConfig({
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-openai',
        model: 'gpt-5.4',
      }));
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

    it('emits OpenAI reasoning summaries from the completed response when no summary deltas were streamed', async () => {
      const response = createMockStreamResponse([
        'data: {"type":"response.completed","response":{"status":"completed","output":[{"id":"rs_1","type":"reasoning","summary":[{"type":"summary_text","text":"Need plan"}]},{"id":"msg_1","type":"message","role":"assistant","content":[{"type":"output_text","text":"Answer","annotations":[]}]}],"output_text":"Answer","usage":{"input_tokens":10,"output_tokens":6}}}\n\n',
      ]);
      mockFetch.mockResolvedValueOnce(response);

      const service = new LlmService(makeConfig({
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-openai',
        model: 'gpt-5.4',
      }));
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'Think' }])) {
        events.push(event);
      }

      expect(events.filter((e) => e.type === 'reasoning').map((e) => e.content)).toEqual(['Need plan']);
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

      const service = new LlmService(makeConfig({
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-openai',
        model: 'gpt-5.4',
      }));
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

    it('preserves Gemini tool-call metadata from streaming chunks', async () => {
      const response = createMockStreamResponse([
        'data: {"candidates":[{"content":{"parts":[{"functionCall":{"id":"tc1","name":"read_file","args":{"path":"test.txt"}},"thoughtSignature":"sig-A"}]}}]}\n\n',
      ]);
      mockFetch.mockResolvedValueOnce(response);

      const service = new LlmService(makeConfig({
        id: 'gemini',
        name: 'Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        apiKey: 'AIza-test',
        model: 'gemini-3-flash-preview',
      }));
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'Read file' }])) {
        events.push(event);
      }

      const toolCalls = events.filter((e) => e.type === 'tool_call');
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].toolCall.raw).toEqual({
        id: 'tc1',
        type: 'function',
        extra_content: {
          google: {
            thought_signature: 'sig-A',
          },
        },
        function: {
          name: 'read_file',
          arguments: '{"path":"test.txt"}',
        },
      });
      expect(events.findIndex((event) => event.type === 'tool_call')).toBeLessThan(
        events.findIndex((event) => event.type === 'done'),
      );
      expect(events.find((e) => e.type === 'done')).toEqual(
        expect.objectContaining({
          type: 'done',
          content: '',
          providerReplay: {
            geminiParts: [
              {
                functionCall: {
                  name: 'read_file',
                  args: { path: 'test.txt' },
                },
                thoughtSignature: 'sig-A',
              },
            ],
          },
        }),
      );
    });

    it('emits only the final Gemini native functionCall snapshot when the tool choice is revised mid-stream', async () => {
      const response = createMockStreamResponse([
        'data: {"candidates":[{"content":{"parts":[{"functionCall":{"id":"tc1","name":"read_file","args":{"path":"draft.txt"}}}]}}]}\n\n',
        'data: {"candidates":[{"content":{"parts":[{"functionCall":{"id":"tc1","name":"text_search","args":{"query":"draft"}}}]}}]}\n\n',
        'data: {"candidates":[{"content":{"parts":[{"functionCall":{"id":"tc1","name":"read_file","args":{"path":"final.txt"}}}]},"finishReason":"STOP"}]}\n\n',
      ]);
      mockFetch.mockResolvedValueOnce(response);

      const service = new LlmService(makeConfig({
        id: 'gemini',
        name: 'Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        apiKey: 'AIza-test',
        model: 'gemini-3-flash-preview',
      }));
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'Read the final file' }])) {
        events.push(event);
      }

      const toolCalls = events.filter((event) => event.type === 'tool_call');
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].toolCall).toMatchObject({
        id: 'tc1',
        name: 'read_file',
        arguments: '{"path":"final.txt"}',
      });
      expect(events.findIndex((event) => event.type === 'tool_call')).toBeLessThan(
        events.findIndex((event) => event.type === 'done'),
      );
      expect(events.find((event) => event.type === 'done')).toEqual(
        expect.objectContaining({
          type: 'done',
          providerReplay: {
            geminiParts: [
              {
                functionCall: {
                  name: 'read_file',
                  args: { path: 'final.txt' },
                },
              },
            ],
          },
          completion: {
            completionStatus: 'complete',
            finishReason: 'STOP',
          },
        }),
      );
    });

    it('should handle usage data', async () => {
      const response = createMockStreamResponse([
        'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
        'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":10,"completion_tokens":5,"prompt_tokens_details":{"cached_tokens":8}}}\n\n',
        'data: [DONE]\n\n',
      ]);
      mockFetch.mockResolvedValueOnce(response);

      const service = new LlmService(makeConfig());
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'test' }])) {
        events.push(event);
      }

      const usage = events.find((e) => e.type === 'usage');
      expect(usage).toBeDefined();
      expect(usage.usage.inputTokens).toBe(10);
      expect(usage.usage.outputTokens).toBe(5);
      expect(usage.usage.cacheReadTokens).toBe(8);
    });

    it('requests usage for Gemini-compatible streaming chat completions', async () => {
      const response = createMockStreamResponse([
        'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
        'data: [DONE]\n\n',
      ]);
      mockFetch.mockResolvedValueOnce(response);

      const service = new LlmService(makeConfig({
        id: 'openrouter',
        name: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: 'sk-or-test',
        model: 'google/gemini-2.5-pro',
      }));

      for await (const _event of service.streamMessage([{ role: 'user', content: 'test' }])) {
        // exhaust stream
      }

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.stream).toBe(true);
      expect(body.stream_options).toEqual({ include_usage: true });
    });

    it('surfaces usage from usage-only Gemini-compatible terminal chunks', async () => {
      const response = createMockStreamResponse([
        'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
        'data: {"choices":[],"usage":{"prompt_tokens":18,"completion_tokens":4,"prompt_tokens_details":{"cached_tokens":12}}}\n\n',
        'data: [DONE]\n\n',
      ]);
      mockFetch.mockResolvedValueOnce(response);

      const service = new LlmService(makeConfig({
        id: 'openrouter',
        name: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: 'sk-or-test',
        model: 'google/gemini-2.5-pro',
      }));
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'test' }])) {
        events.push(event);
      }

      expect(events.filter((event) => event.type === 'token').map((event) => event.content)).toEqual(['Hi']);
      expect(events.find((event) => event.type === 'usage')).toEqual({
        type: 'usage',
        usage: {
          inputTokens: 18,
          outputTokens: 4,
          cacheReadTokens: 12,
          cacheWriteTokens: 0,
          totalTokens: 22,
        },
      });
      expect(events.find((event) => event.type === 'done')).toEqual(
        expect.objectContaining({ type: 'done', content: 'Hi' }),
      );
    });

    it('should normalize cached tokens from input_tokens_details in OpenAI-compatible streams', async () => {
      const response = createMockStreamResponse([
        'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
        'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":10,"completion_tokens":5,"input_tokens_details":{"cached_tokens":6}}}\n\n',
        'data: [DONE]\n\n',
      ]);
      mockFetch.mockResolvedValueOnce(response);

      const service = new LlmService(makeConfig());
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'test' }])) {
        events.push(event);
      }

      const usage = events.find((e) => e.type === 'usage');
      expect(usage).toBeDefined();
      expect(usage.usage.cacheReadTokens).toBe(6);
    });

    it('should normalize cached tokens from cache_read_input_tokens in OpenAI-compatible streams', async () => {
      const response = createMockStreamResponse([
        'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
        'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":10,"completion_tokens":5,"cache_read_input_tokens":4}}\n\n',
        'data: [DONE]\n\n',
      ]);
      mockFetch.mockResolvedValueOnce(response);

      const service = new LlmService(makeConfig());
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'test' }])) {
        events.push(event);
      }

      const usage = events.find((e) => e.type === 'usage');
      expect(usage).toBeDefined();
      expect(usage.usage.cacheReadTokens).toBe(4);
    });

    it('should handle missing [DONE] marker gracefully', async () => {
      const response = createMockStreamResponse([
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      ]);
      mockFetch.mockResolvedValueOnce(response);

      const service = new LlmService(makeConfig());
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'Hi' }])) {
        events.push(event);
      }

      const done = events.find((e) => e.type === 'done');
      expect(done).toBeDefined();
      expect(done.content).toBe('Hello');
      expect(done.completion).toEqual({
        completionStatus: 'incomplete',
        finishReason: 'stream_ended_without_done_marker',
      });
    });

    it('should parse SSE text when response.body is unavailable', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: undefined,
        text: () => Promise.resolve(
          'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n' +
          'data: {"choices":[{"delta":{"content":" world"}}]}\n\n' +
          'data: [DONE]\n\n',
        ),
      });

      const service = new LlmService(makeConfig());
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'Hi' }])) {
        events.push(event);
      }

      expect(events.filter((e) => e.type === 'token').map((e) => e.content)).toEqual(['Hello', ' world']);
      expect(events.find((e) => e.type === 'done')?.content).toBe('Hello world');
    });

    it('should combine multi-line SSE data blocks', async () => {
      const response = createMockStreamResponse([
        'event: message\n',
        'data: {\n',
        'data:   "choices":[{"delta":{"content":"Hello world"}}]\n',
        'data: }\n\n',
        'data: [DONE]\n\n',
      ]);
      mockFetch.mockResolvedValueOnce(response);

      const service = new LlmService(makeConfig());
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'Hi' }])) {
        events.push(event);
      }

      expect(events.filter((e) => e.type === 'token').map((e) => e.content)).toEqual(['Hello world']);
      expect(events.find((e) => e.type === 'done')?.content).toBe('Hello world');
    });

    it('should keep Anthropic stream responses on the SSE path when body is unavailable', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: undefined,
        text: () => Promise.resolve(
          'event: message_start\n' +
          'data: {"type":"message_start","message":{"usage":{"input_tokens":12,"output_tokens":1}}}\n\n' +
          'event: content_block_start\n' +
          'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
          'event: content_block_delta\n' +
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n' +
          'event: content_block_delta\n' +
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}\n\n' +
          'event: message_delta\n' +
          'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":9}}\n\n' +
          'event: message_stop\n' +
          'data: {"type":"message_stop"}\n\n',
        ),
      });

      const service = new LlmService(makeConfig({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'anthropic-key',
        model: 'claude-sonnet-4-6',
      }));
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'Hi' }])) {
        events.push(event);
      }

      expect(events.filter((e) => e.type === 'token').map((e) => e.content)).toEqual(['Hello', ' world']);
      expect(events.find((e) => e.type === 'done')).toEqual(expect.objectContaining({
        content: 'Hello world',
        providerReplay: {
          anthropicBlocks: [
            { type: 'text', text: 'Hello world' },
          ],
        },
      }));
      expect(events.find((e) => e.type === 'usage')?.usage).toEqual({ inputTokens: 12, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 13 });
    });

    it('falls back to buffered Anthropic SSE parsing when response.body lacks getReader', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: {},
        text: () => Promise.resolve(
          'event: message_start\n' +
          'data: {"type":"message_start","message":{"usage":{"input_tokens":12,"output_tokens":1}}}\n\n' +
          'event: content_block_start\n' +
          'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
          'event: content_block_delta\n' +
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n' +
          'event: content_block_delta\n' +
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}\n\n' +
          'event: message_delta\n' +
          'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":9}}\n\n' +
          'event: message_stop\n' +
          'data: {"type":"message_stop"}\n\n',
        ),
      });

      const service = new LlmService(makeConfig({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'anthropic-key',
        model: 'claude-sonnet-4-6',
      }));
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'Hi' }])) {
        events.push(event);
      }

      expect(events.filter((event) => event.type === 'token').map((event) => event.content)).toEqual(['Hello', ' world']);
      expect(events.find((event) => event.type === 'done')?.content).toBe('Hello world');
      expect(events.find((event) => event.type === 'usage')?.usage).toEqual({
        inputTokens: 12,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 13,
      });
    });

    it('accumulates Anthropic text emitted entirely on content_block_start', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: undefined,
        text: () => Promise.resolve(
          'event: message_start\n' +
          'data: {"type":"message_start","message":{"usage":{"input_tokens":9,"output_tokens":1}}}\n\n' +
          'event: content_block_start\n' +
          'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":"Final worker summary"}}\n\n' +
          'event: content_block_stop\n' +
          'data: {"type":"content_block_stop","index":0}\n\n' +
          'event: message_delta\n' +
          'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":4}}\n\n' +
          'event: message_stop\n' +
          'data: {"type":"message_stop"}\n\n',
        ),
      });

      const service = new LlmService(makeConfig({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'anthropic-key',
        model: 'claude-sonnet-4-6',
      }));
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'Hi' }])) {
        events.push(event);
      }

      expect(events.filter((event) => event.type === 'token').map((event) => event.content)).toEqual(['Final worker summary']);
      expect(events.find((event) => event.type === 'done')?.content).toBe('Final worker summary');
    });

    it('marks Anthropic streams without message_stop as incomplete completions', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: undefined,
        text: () => Promise.resolve(
          'event: message_start\n' +
          'data: {"type":"message_start","message":{"usage":{"input_tokens":9,"output_tokens":1}}}\n\n' +
          'event: content_block_start\n' +
          'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":"Partial answer"}}\n\n' +
          'event: message_delta\n' +
          'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":4}}\n\n',
        ),
      });

      const service = new LlmService(makeConfig({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'anthropic-key',
        model: 'claude-sonnet-4-6',
      }));
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
        text: () => Promise.resolve(
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

      const service = new LlmService(makeConfig({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'anthropic-key',
        model: 'claude-sonnet-4-6',
      }));
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'Read the file.' }])) {
        events.push(event);
      }

      expect(events.filter((event) => event.type === 'tool_call')).toHaveLength(1);
      expect(events.find((event) => event.type === 'tool_call')?.toolCall).toMatchObject({
        id: 'toolu_1',
        name: 'read_file',
        arguments: '{"path":"notes.txt"}',
        raw: {
          extra_content: {
            anthropic: {
              assistant_blocks: [
                { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'notes.txt' } },
              ],
            },
          },
        },
      });
      expect(events.findIndex((event) => event.type === 'tool_call')).toBeLessThan(
        events.findIndex((event) => event.type === 'done'),
      );
    });

    it('preserves Anthropic thinking blocks and signatures in streamed tool-call metadata', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: undefined,
        text: () => Promise.resolve(
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

      const service = new LlmService(makeConfig({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'anthropic-key',
        model: 'claude-sonnet-4-6',
      }));
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
          extra_content: {
            anthropic: {
              assistant_blocks: [
                { type: 'thinking', thinking: 'Need tool', signature: 'sig-A' },
                { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'notes.txt' } },
              ],
            },
          },
        },
      });
      expect(events.findIndex((event) => event.type === 'tool_call')).toBeLessThan(
        events.findIndex((event) => event.type === 'done'),
      );
    });

    it('preserves Anthropic redacted thinking blocks in streamed tool-call metadata', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: undefined,
        text: () => Promise.resolve(
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

      const service = new LlmService(makeConfig({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'anthropic-key',
        model: 'claude-sonnet-4-6',
      }));
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
          extra_content: {
            anthropic: {
              assistant_blocks: [
                { type: 'redacted_thinking', data: 'opaque-redacted-thinking' },
                { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'notes.txt' } },
              ],
            },
          },
        },
      });
      expect(events.findIndex((event) => event.type === 'tool_call')).toBeLessThan(
        events.findIndex((event) => event.type === 'done'),
      );
    });

    it('should propagate Anthropic streaming errors instead of swallowing them', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: undefined,
        text: () => Promise.resolve(
          'event: message_start\n' +
          'data: {"type":"message_start","message":{"usage":{"input_tokens":5,"output_tokens":1}}}\n\n' +
          'event: content_block_delta\n' +
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Partial"}}\n\n' +
          'event: error\n' +
          'data: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n',
        ),
      });

      const service = new LlmService(makeConfig({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'anthropic-key',
        model: 'claude-sonnet-4-6',
      }));

      await expect(async () => {
        const events: any[] = [];
        for await (const event of service.streamMessage([{ role: 'user', content: 'Hi' }])) {
          events.push(event);
        }
      }).rejects.toThrow('Anthropic overloaded_error: Overloaded');
    });

    it('should continue past JSON parse errors in OpenAI streaming without swallowing real errors', async () => {
      const response = createMockStreamResponse([
        'data: {"choices":[{"delta":{"content":"Good"}}]}\n\n',
        'data: {not valid json}\n\n',
        'data: {"choices":[{"delta":{"content":" day"}}]}\n\n',
        'data: [DONE]\n\n',
      ]);
      mockFetch.mockResolvedValueOnce(response);

      const service = new LlmService(makeConfig());
      const events: any[] = [];

      for await (const event of service.streamMessage([{ role: 'user', content: 'Hi' }])) {
        events.push(event);
      }

      expect(events.filter((e) => e.type === 'token').map((e) => e.content)).toEqual(['Good', ' day']);
    });

    it('should omit the deprecated anthropic-beta header for Claude 4.6 adaptive thinking requests', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 2 },
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'anthropic-key',
        model: 'claude-sonnet-4-6',
      }));

      await service.sendMessage([{ role: 'user', content: 'Hello' }], {
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        tools: [{
          name: 'read_file',
          description: 'Read a file.',
          input_schema: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
          },
        }],
      });

      expect(mockFetch.mock.calls[0][1].headers).toMatchObject({
        'anthropic-version': '2023-06-01',
      });
      expect(mockFetch.mock.calls[0][1].headers).not.toHaveProperty('anthropic-beta');
    });

    it('should include anthropic-beta header for manual Claude 4 tool-use thinking requests that still require it', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 2 },
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'anthropic-key',
        model: 'claude-sonnet-4-5',
      }));

      await service.sendMessage([{ role: 'user', content: 'Hello' }], {
        thinking: { type: 'enabled', budget_tokens: 2048 },
        tools: [{
          name: 'read_file',
          description: 'Read a file.',
          input_schema: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
          },
        }],
      });

      expect(mockFetch.mock.calls[0][1].headers).toMatchObject({
        'anthropic-beta': 'interleaved-thinking-2025-05-14',
        'anthropic-version': '2023-06-01',
      });
    });

    it('should merge consecutive user messages for Anthropic alternation requirement', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          content: [{ type: 'text', text: 'Done' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 4 },
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'anthropic-key',
        model: 'claude-sonnet-4-6',
      }));

      await service.sendMessage([
        { role: 'user', content: 'First question.' },
        { role: 'user', content: 'Follow up.' },
      ]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0]).toEqual({
        role: 'user',
        content: 'First question.\n\nFollow up.',
      });
    });

    it('should merge consecutive assistant messages for Anthropic alternation requirement', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          content: [{ type: 'text', text: 'Done' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 4 },
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'anthropic-key',
        model: 'claude-sonnet-4-6',
      }));

      await service.sendMessage([
        { role: 'user', content: 'Start.' },
        { role: 'assistant', content: 'Reply one.' } as any,
        { role: 'assistant', content: 'Reply two.' } as any,
        { role: 'user', content: 'Continue.' },
      ]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages).toHaveLength(3);
      expect(body.messages[0]).toEqual({ role: 'user', content: 'Start.' });
      // Merged assistant: two text blocks in array form
      expect(body.messages[1].role).toBe('assistant');
      expect(body.messages[1].content).toEqual([
        { type: 'text', text: 'Reply one.' },
        { type: 'text', text: 'Reply two.' },
      ]);
      expect(body.messages[2]).toEqual({ role: 'user', content: 'Continue.' });
    });

    it('should use array content form for Anthropic assistant messages with tool_use', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          content: [{ type: 'text', text: 'Done' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 4 },
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'anthropic-key',
        model: 'claude-sonnet-4-6',
      }));

      await service.sendMessage([
        { role: 'user', content: 'Read the file.' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [{
            id: 'toolu_1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"x.txt"}' },
          }],
        } as any,
        { role: 'tool', tool_call_id: 'toolu_1', content: 'contents' },
      ]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const assistantMsg = body.messages.find((m: any) => m.role === 'assistant');
      expect(assistantMsg.content).toEqual([
        { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'x.txt' } },
      ]);
    });

    it('should set is_error on Anthropic tool_result when content starts with Error:', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          content: [{ type: 'text', text: 'I see the error' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 4 },
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'anthropic-key',
        model: 'claude-sonnet-4-6',
      }));

      await service.sendMessage([
        { role: 'user', content: 'Run javascript.' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [{
            id: 'toolu_1',
            type: 'function',
            function: { name: 'javascript', arguments: '{}' },
          }],
        } as any,
        { role: 'tool', tool_call_id: 'toolu_1', content: 'Error: "code" is required for javascript and must be a string' },
      ]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const toolResultMsg = body.messages.find((m: any) =>
        m.role === 'user' && Array.isArray(m.content) && m.content.some((b: any) => b.type === 'tool_result'),
      );
      const toolResult = toolResultMsg.content.find((b: any) => b.type === 'tool_result');
      expect(toolResult.is_error).toBe(true);
    });

    it('should set is_error on Anthropic tool_result when is_error flag is passed through', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 2 },
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'anthropic-key',
        model: 'claude-sonnet-4-6',
      }));

      await service.sendMessage([
        { role: 'user', content: 'Do something.' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [{
            id: 'toolu_1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"x.txt"}' },
          }],
        } as any,
        { role: 'tool', tool_call_id: 'toolu_1', content: 'Error: Permission denied', is_error: true } as any,
      ]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const toolResultMsg = body.messages.find((m: any) =>
        m.role === 'user' && Array.isArray(m.content) && m.content.some((b: any) => b.type === 'tool_result'),
      );
      const toolResult = toolResultMsg.content.find((b: any) => b.type === 'tool_result');
      expect(toolResult.is_error).toBe(true);
    });

    it('should not set is_error on successful Anthropic tool_result', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          content: [{ type: 'text', text: 'Done' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 4 },
        }),
      });

      const service = new LlmService(makeConfig({
        id: 'anthropic',
        name: 'Anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'anthropic-key',
        model: 'claude-sonnet-4-6',
      }));

      await service.sendMessage([
        { role: 'user', content: 'Read the file.' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [{
            id: 'toolu_1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"x.txt"}' },
          }],
        } as any,
        { role: 'tool', tool_call_id: 'toolu_1', content: 'file contents here' },
      ]);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const toolResultMsg = body.messages.find((m: any) =>
        m.role === 'user' && Array.isArray(m.content) && m.content.some((b: any) => b.type === 'tool_result'),
      );
      const toolResult = toolResultMsg.content.find((b: any) => b.type === 'tool_result');
      expect(toolResult.is_error).toBeUndefined();
    });
  });
});
