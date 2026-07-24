import { testProviderConnection } from '../../../src/services/llm/support/providerConnection';
import type { LlmProviderConfig } from '../../../src/types/provider';

function makeProvider(overrides: Partial<LlmProviderConfig> = {}): LlmProviderConfig {
  return {
    id: 'provider-1',
    kind: 'remote',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'secret-key',
    model: 'gpt-5.4',
    enabled: true,
    ...overrides,
  };
}

function makeResponse(status: number, payload: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(payload),
  } as unknown as Response;
}

describe('testProviderConnection', () => {
  it('verifies OpenAI-compatible providers through the read-only models endpoint', async () => {
    const performFetch = jest.fn().mockResolvedValue(makeResponse(200, { data: [] }));

    await expect(testProviderConnection(makeProvider(), { performFetch })).resolves.toEqual({
      outcome: 'success',
    });

    expect(performFetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models',
      expect.objectContaining({
        method: 'GET',
        redirect: 'error',
        headers: expect.objectContaining({ Authorization: 'Bearer secret-key' }),
      }),
    );
  });

  it('verifies OpenRouter keys with its authenticated key endpoint', async () => {
    const performFetch = jest.fn().mockResolvedValue(makeResponse(200, { data: { label: 'key' } }));

    await expect(
      testProviderConnection(
        makeProvider({
          name: 'OpenRouter',
          providerFamily: 'openrouter',
          baseUrl: 'https://openrouter.ai/api/v1',
          model: 'openai/gpt-5.4',
        }),
        { performFetch },
      ),
    ).resolves.toEqual({ outcome: 'success' });

    expect(performFetch).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/key',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('verifies Anthropic through its read-only models endpoint', async () => {
    const performFetch = jest.fn().mockResolvedValue(makeResponse(200, { data: [] }));

    await expect(
      testProviderConnection(
        makeProvider({
          name: 'Anthropic',
          providerFamily: 'anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          model: 'claude-sonnet-4-6',
        }),
        { performFetch },
      ),
    ).resolves.toEqual({ outcome: 'success' });

    expect(performFetch).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({
          'anthropic-version': '2023-06-01',
          'x-api-key': 'secret-key',
        }),
      }),
    );
  });

  it('verifies Gemini with token counting instead of a billable generation', async () => {
    const performFetch = jest.fn().mockResolvedValue(makeResponse(200, { totalTokens: 2 }));

    await expect(
      testProviderConnection(
        makeProvider({
          name: 'Gemini',
          providerFamily: 'gemini',
          baseUrl: 'https://aiplatform.googleapis.com/v1',
          model: 'gemini-3.1-pro-preview',
        }),
        { performFetch },
      ),
    ).resolves.toEqual({ outcome: 'success' });

    expect(performFetch).toHaveBeenCalledWith(
      'https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-3.1-pro-preview:countTokens',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-goog-api-key': 'secret-key' }),
        body: expect.stringContaining('connection test'),
      }),
    );
  });

  it.each([
    [401, 'authentication'],
    [403, 'authentication'],
    [402, 'billing'],
    [408, 'timeout'],
    [429, 'rate-limited'],
    [404, 'unsupported'],
    [405, 'unsupported'],
    [400, 'rejected'],
    [503, 'server'],
  ] as const)('maps HTTP %i to a safe %s failure', async (status, reason) => {
    const response = makeResponse(status, { error: { message: 'private provider detail' } });
    const performFetch = jest.fn().mockResolvedValue(response);

    await expect(testProviderConnection(makeProvider(), { performFetch })).resolves.toEqual({
      outcome: 'failure',
      reason,
      httpStatus: status,
    });
    expect(response.json).not.toHaveBeenCalled();
  });

  it('rejects a successful response with an incompatible payload', async () => {
    const performFetch = jest.fn().mockResolvedValue(makeResponse(200, '<html>sign in</html>'));

    await expect(testProviderConnection(makeProvider(), { performFetch })).resolves.toEqual({
      outcome: 'failure',
      reason: 'unsupported',
    });
  });

  it('returns a safe failure instead of throwing for an invalid endpoint', async () => {
    const performFetch = jest.fn();

    await expect(
      testProviderConnection(makeProvider({ baseUrl: 'not a URL' }), { performFetch }),
    ).resolves.toEqual({ outcome: 'failure', reason: 'network' });
    expect(performFetch).not.toHaveBeenCalled();
  });

  it.each([
    [Object.assign(new Error('cancelled'), { name: 'AbortError' }), 'timeout'],
    [new Error('socket exposed a secret'), 'network'],
  ] as const)('sanitizes transport failures', async (error, reason) => {
    const performFetch = jest.fn().mockRejectedValue(error);

    await expect(testProviderConnection(makeProvider(), { performFetch })).resolves.toEqual({
      outcome: 'failure',
      reason,
    });
  });

  it('does not attempt an HTTP probe for on-device providers', async () => {
    const performFetch = jest.fn();

    await expect(
      testProviderConnection(
        makeProvider({
          kind: 'on-device',
          name: 'On-device models',
          baseUrl: '',
          apiKey: '',
        }),
        { performFetch },
      ),
    ).resolves.toEqual({ outcome: 'failure', reason: 'unsupported' });
    expect(performFetch).not.toHaveBeenCalled();
  });
});
