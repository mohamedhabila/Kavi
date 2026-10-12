// ---------------------------------------------------------------------------
// Tests - LLM Service: tool schemas go to every chat-compatible provider in strict form
// ---------------------------------------------------------------------------
// Traced on GLM 5.3 Flash through OpenRouter (b0e8359e): one upstream sent only the
// arguments a schema required — `reminder` arrived as a bare {"action":"create"} six times
// in a row, and a calendar update dropped the note it was asked to add. With every optional
// property declared required and nullable, the same pinned upstream sent complete calls.
// ---------------------------------------------------------------------------

import { LlmService, makeConfig, mockFetch } from '../../helpers/llmServiceHarness';

const REMINDER_LIKE_TOOL = {
  name: 'reminder',
  description: 'Create, list, update, or cancel a reminder.',
  input_schema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['create', 'list', 'update', 'cancel'] },
      title: { type: 'string' },
      when: {
        type: 'object',
        properties: { kind: { type: 'string' }, delaySeconds: { type: 'number' } },
        required: ['kind'],
      },
    },
    required: ['action'],
  },
};

async function sentParameters(
  provider: Parameters<typeof makeConfig>[0],
  tool: object,
): Promise<{ parameters: any; strict: unknown }> {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ choices: [{ message: { content: 'ok' } }] }),
  });
  await new LlmService(makeConfig(provider)).sendMessage([{ role: 'user', content: 'Remind me' }], {
    tools: [tool as any],
  });
  const body = JSON.parse(mockFetch.mock.calls[mockFetch.mock.calls.length - 1][1].body);
  return {
    parameters: body.tools[0].function.parameters,
    strict: body.tools[0].function.strict,
  };
}

const OPENROUTER = {
  id: 'openrouter',
  name: 'OpenRouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKey: 'sk-openrouter',
  model: 'z-ai/glm-5.3-flash',
};

describe('tool schemas for chat-compatible providers', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('declares every property required, optional ones nullable, for a routed provider', async () => {
    const { parameters, strict } = await sentParameters(OPENROUTER, REMINDER_LIKE_TOOL);

    expect(parameters).toEqual({
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'list', 'update', 'cancel'] },
        title: { type: ['string', 'null'] },
        when: {
          type: ['object', 'null'],
          properties: {
            kind: { type: 'string' },
            delaySeconds: { type: ['number', 'null'] },
          },
          required: ['kind', 'delaySeconds'],
          additionalProperties: false,
        },
      },
      required: ['action', 'title', 'when'],
      additionalProperties: false,
    });
    // `strict` is OpenAI's request flag; other servers get the strict form without it.
    expect(strict).toBeUndefined();
  });

  it('sends a schema the strict form cannot express as declared', async () => {
    const mapTool = {
      name: 'set_env',
      description: 'Set environment variables.',
      input_schema: {
        type: 'object',
        properties: { env: { type: 'object', additionalProperties: { type: 'string' } } },
        required: [],
      },
    };

    const { parameters, strict } = await sentParameters(OPENROUTER, mapTool);

    expect(parameters.properties.env).toMatchObject({
      type: 'object',
      additionalProperties: { type: 'string' },
    });
    expect(parameters.required).toBeUndefined();
    expect(parameters.additionalProperties).toBeUndefined();
    expect(strict).toBeUndefined();
  });
});
