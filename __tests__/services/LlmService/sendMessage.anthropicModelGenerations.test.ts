// ---------------------------------------------------------------------------
// Tests — LLM Service: sendMessage Anthropic request shape per model
// ---------------------------------------------------------------------------
//
// Thinking and effort arrive already shaped from what the model's models API declares
// (engine/thinking.ts) and go out as they are. The request layer keeps only the rules no
// declaration carries: sampling params a model rejects, and the forced tool_choice that
// Fable 5.1 rejects.

import { LlmService, makeConfig, mockFetch } from '../../helpers/llmServiceHarness';

function mockOkResponse() {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () =>
      Promise.resolve({
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 5, output_tokens: 2 },
      }),
  });
}

function requestBody() {
  return JSON.parse(mockFetch.mock.calls[0][1].body);
}

const READ_FILE_TOOL = {
  name: 'read_file',
  description: 'Read a file.',
  input_schema: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
  },
};

function claude(model: string): LlmService {
  return new LlmService(
    makeConfig({
      id: 'anthropic',
      name: 'Anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      apiKey: 'anthropic-key',
      model,
    }),
  );
}

const ADAPTIVE = {
  type: 'adaptive',
  display: 'summarized',
  block_binding: { prefix_mismatch_behavior: 'drop_block' },
};

describe('LlmService', () => {
  describe('sendMessage Anthropic request shapes per model', () => {
    it('Fable 5.1: keeps its declared thinking, drops temperature, and turns a forced tool_choice into an instruction', async () => {
      mockOkResponse();
      await claude('claude-fable-5-1').sendMessage([{ role: 'user', content: 'Use the tool.' }], {
        thinking: { type: 'adaptive' },
        temperature: 0.7,
        maxTokens: 8000,
        output_config: { effort: 'xhigh' },
        tools: [READ_FILE_TOOL],
        toolChoice: 'required',
      });

      const body = requestBody();
      // A forced tool_choice and thinking cannot go together; the forced choice wins.
      expect(body.thinking).toBeUndefined();
      expect(body.temperature).toBeUndefined();
      expect(body.tool_choice).toEqual({ type: 'auto' });
      expect(body.system).toContain('read_file');
    });

    it('Fable 5.1: sends its declared adaptive thinking on an ordinary turn', async () => {
      mockOkResponse();
      await claude('claude-fable-5-1').sendMessage([{ role: 'user', content: 'Plan it.' }], {
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high' },
      });

      expect(requestBody().thinking).toEqual(ADAPTIVE);
      expect(requestBody().output_config).toEqual({ effort: 'high' });
    });

    it('Fable 5 (not 5.1) leaves a forced tool_choice as it is', async () => {
      mockOkResponse();
      await claude('claude-fable-5').sendMessage([{ role: 'user', content: 'Use the tool.' }], {
        tools: [READ_FILE_TOOL],
        toolChoice: 'required',
      });

      expect(requestBody().tool_choice).toEqual({ type: 'any' });
    });

    it.each(['claude-haiku-5-5', 'claude-opus-5', 'claude-sonnet-5-5', 'claude-opus-4-8'])(
      '%s: drops temperature even without thinking',
      async (model) => {
        mockOkResponse();
        await claude(model).sendMessage([{ role: 'user', content: 'Hi' }], {
          temperature: 0,
          output_config: { effort: 'low' },
        });

        expect(requestBody().temperature).toBeUndefined();
        expect(requestBody().output_config).toEqual({ effort: 'low' });
      },
    );

    it.each(['claude-sonnet-4-6', 'claude-haiku-4-5'])(
      '%s: keeps temperature without thinking',
      async (model) => {
        mockOkResponse();
        await claude(model).sendMessage([{ role: 'user', content: 'Hi' }], { temperature: 0.3 });

        expect(requestBody().temperature).toBe(0.3);
      },
    );

    it('Haiku 4.5: sends its declared manual thinking and drops temperature while it thinks', async () => {
      mockOkResponse();
      await claude('claude-haiku-4-5').sendMessage([{ role: 'user', content: 'Plan it.' }], {
        thinking: { type: 'enabled', budget_tokens: 3000 },
        temperature: 0.3,
        maxTokens: 8000,
      });

      expect(requestBody().thinking).toEqual({
        type: 'enabled',
        budget_tokens: 3000,
        display: 'summarized',
        block_binding: { prefix_mismatch_behavior: 'drop_block' },
      });
      expect(requestBody().temperature).toBeUndefined();
    });

    it('sends a declared off switch as it is, so a model that thinks by default stops', async () => {
      mockOkResponse();
      await claude('claude-haiku-5-5').sendMessage([{ role: 'user', content: 'Hi' }], {
        thinking: { type: 'disabled' },
      });

      expect(requestBody().thinking).toEqual({ type: 'disabled' });
    });
  });
});
