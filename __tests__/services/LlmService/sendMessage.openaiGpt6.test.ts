// ---------------------------------------------------------------------------
// Tests - LLM Service: OpenAI Responses requests GPT-6 accepts
// ---------------------------------------------------------------------------
//
// Probed against the live API on 2026-10-14: every GPT-6 model answers `temperature`
// with a 400 ("Unsupported parameter: 'temperature' is not supported with this model"),
// Astra and 6.1 Sol reject effort `none`, and every GPT-6 model rejects `minimal`.

import {
  LlmService,
  makeConfig,
  makeOpenAIResponsesPayload,
  mockFetch,
} from '../../helpers/llmServiceHarness';

function openAI(model: string): LlmService {
  return new LlmService(
    makeConfig({
      id: 'openai',
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-openai',
      model,
    }),
  );
}

function mockOk(payload: Record<string, unknown> = {}) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(makeOpenAIResponsesPayload(payload)),
  });
}

function requestBody() {
  return JSON.parse(mockFetch.mock.calls[0][1].body);
}

describe('LlmService OpenAI Responses requests for GPT-6', () => {
  it.each(['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-luna', 'openai/gpt-6-astra'])(
    '%s: sends its reasoning effort and encrypted reasoning, never a temperature',
    async (model) => {
      mockOk();
      await openAI(model).sendMessage([{ role: 'user', content: 'Plan it.' }], {
        temperature: 0.7,
        reasoning_effort: 'xhigh',
      });

      const body = requestBody();
      expect(body).not.toHaveProperty('temperature');
      expect(body.reasoning).toEqual({ effort: 'xhigh', summary: 'auto' });
      expect(body.include).toEqual(['reasoning.encrypted_content']);
    },
  );

  it('asks for low effort on a structured-output request, not none', async () => {
    mockOk({
      output: [
        {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: '{"approved":true}', annotations: [] }],
        },
      ],
      output_text: '{"approved":true}',
    });
    await openAI('gpt-6-astra').sendMessage([{ role: 'user', content: 'Return JSON.' }], {
      structuredOutput: {
        name: 'pilot_report',
        mimeType: 'application/json',
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { approved: { type: 'boolean' } },
          required: ['approved'],
        },
      },
    });

    expect(requestBody().reasoning).toEqual({ effort: 'low', summary: 'auto' });
  });

  it.each(['gpt-5-mini', 'gpt-5.5', 'o4-mini'])(
    '%s: an earlier reasoning model gets no temperature either',
    async (model) => {
      mockOk();
      await openAI(model).sendMessage([{ role: 'user', content: 'Hi' }], { temperature: 0.2 });

      expect(requestBody()).not.toHaveProperty('temperature');
    },
  );

  it('keeps temperature for a non-reasoning GPT', async () => {
    mockOk();
    await openAI('gpt-4.1').sendMessage([{ role: 'user', content: 'Hi' }], { temperature: 0.2 });

    expect(requestBody().temperature).toBe(0.2);
  });
});
