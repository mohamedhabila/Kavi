import { LlmService, makeConfig, mockFetch } from '../../helpers/llmServiceHarness';

// A 400 on a request with tools read the body once (to look for an oversized schema) and
// then again for the error: the second read failed, so the error said only "Bad Request"
// and a live failure on Claude Sonnet 5.5 could not be diagnosed.

const READ_FILE = {
  name: 'read_file',
  description: 'Read a file.',
  input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
};

function refusal(message: string) {
  const body = JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message } });
  let read = false;
  return {
    ok: false,
    status: 400,
    statusText: 'Bad Request',
    text: () => {
      if (read) return Promise.reject(new TypeError('Body has already been consumed.'));
      read = true;
      return Promise.resolve(body);
    },
  };
}

it("keeps the API's reason when Claude refuses a request with tools", async () => {
  mockFetch.mockResolvedValueOnce(
    refusal('messages.3: tool_use ids were found without tool_result'),
  );
  const service = new LlmService(
    makeConfig({
      id: 'anthropic',
      name: 'Anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      apiKey: 'anthropic-key',
      model: 'claude-sonnet-5-5',
    }),
  );

  await expect(
    service.sendMessage([{ role: 'user', content: 'Read it.' }], { tools: [READ_FILE] }),
  ).rejects.toThrow('tool_use ids were found without tool_result');
});
