// ---------------------------------------------------------------------------
// Tests — Anthropic live model discovery (GET /v1/models, paginated)
// ---------------------------------------------------------------------------

import { fetchProviderModels } from '../../../../src/services/llm/catalog/modelDiscovery';
import { clearProviderContextWindowsForTests } from '../../../../src/services/context/providerContextWindows';

const createTimeoutSignal = (_ms: number) => new AbortController().signal;

function baseProvider(overrides: Record<string, any> = {}) {
  return {
    id: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKey: 'sk-ant-test',
    model: 'claude-opus-5',
    enabled: true,
    ...overrides,
  };
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  };
}

describe('fetchProviderModels — Anthropic live discovery', () => {
  beforeEach(() => {
    clearProviderContextWindowsForTests();
  });

  it('fetches a single page and maps max_input_tokens and capabilities', async () => {
    const performFetch = jest.fn().mockResolvedValueOnce(
      jsonResponse({
        data: [
          {
            id: 'claude-opus-5',
            display_name: 'Claude Opus 5',
            created_at: '2026-01-01T00:00:00Z',
            max_input_tokens: 1000000,
            max_tokens: 128000,
            capabilities: ['vision', 'tool_use'],
          },
          {
            id: 'claude-haiku-4-5',
            display_name: 'Claude Haiku 4.5',
            created_at: '2025-01-01T00:00:00Z',
            max_input_tokens: 200000,
            max_tokens: 64000,
            capabilities: { vision: true, tool_use: false, file_input: true },
          },
        ],
        has_more: false,
      }),
    );

    const result = await fetchProviderModels({
      provider: baseProvider(),
      baseUrl: 'https://api.anthropic.com/v1',
      headers: { 'x-api-key': 'sk-ant-test', 'anthropic-version': '2023-06-01' },
      transport: 'anthropic',
      createTimeoutSignal,
      performFetch,
    });

    expect(result.models).toEqual(['claude-haiku-4-5', 'claude-opus-5']);
    expect(result.capabilities['claude-opus-5']).toEqual({
      vision: true,
      tools: true,
      fileInput: false,
    });
    expect(result.capabilities['claude-haiku-4-5']).toEqual({
      vision: true,
      tools: false,
      fileInput: true,
    });
    expect(result.contextWindows['claude-opus-5']).toBe(1000000);
    expect(result.contextWindows['claude-haiku-4-5']).toBe(200000);

    // The request hit /v1/models on the configured base URL.
    expect(performFetch).toHaveBeenCalledWith(
      expect.stringContaining('/models'),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('follows has_more/last_id pagination across multiple pages', async () => {
    const performFetch = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: 'claude-opus-5', max_input_tokens: 1000000 }],
          has_more: true,
          last_id: 'claude-opus-5',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: 'claude-sonnet-5', max_input_tokens: 1000000 }],
          has_more: true,
          last_id: 'claude-sonnet-5',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: 'claude-haiku-4-5', max_input_tokens: 200000 }],
          has_more: false,
        }),
      );

    const result = await fetchProviderModels({
      provider: baseProvider(),
      baseUrl: 'https://api.anthropic.com/v1',
      headers: {},
      transport: 'anthropic',
      createTimeoutSignal,
      performFetch,
    });

    expect(performFetch).toHaveBeenCalledTimes(3);
    expect(result.models.sort()).toEqual(
      ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'].sort(),
    );

    // Second and third calls carry the previous page's last_id as after_id.
    const secondCallUrl = performFetch.mock.calls[1][0] as string;
    const thirdCallUrl = performFetch.mock.calls[2][0] as string;
    expect(secondCallUrl).toContain('after_id=claude-opus-5');
    expect(thirdCallUrl).toContain('after_id=claude-sonnet-5');
  });

  it('falls back to the static catalog when every request fails', async () => {
    const performFetch = jest.fn().mockRejectedValue(new Error('network down'));

    const result = await fetchProviderModels({
      provider: baseProvider(),
      baseUrl: 'https://api.anthropic.com/v1',
      headers: {},
      transport: 'anthropic',
      createTimeoutSignal,
      performFetch,
    });

    expect(result.models).toEqual(
      expect.arrayContaining([
        'claude-opus-5',
        'claude-fable-5-1',
        'claude-sonnet-5',
        'claude-opus-4-8',
        'claude-opus-4-7',
        'claude-sonnet-4-6',
        'claude-haiku-4-5',
      ]),
    );
    expect(result.models).toHaveLength(7);
    for (const model of result.models) {
      expect(result.capabilities[model]).toEqual({ vision: true, tools: true, fileInput: true });
    }
  });

  it('falls back to the static catalog on a non-ok HTTP status', async () => {
    const performFetch = jest.fn().mockResolvedValue(jsonResponse({}, false, 401));

    const result = await fetchProviderModels({
      provider: baseProvider(),
      baseUrl: 'https://api.anthropic.com/v1',
      headers: {},
      transport: 'anthropic',
      createTimeoutSignal,
      performFetch,
    });

    expect(result.models).toContain('claude-opus-5');
    expect(result.models).toHaveLength(7);
  });

  it('falls back to the static catalog when the response has no models at all', async () => {
    const performFetch = jest.fn().mockResolvedValue(jsonResponse({ data: [], has_more: false }));

    const result = await fetchProviderModels({
      provider: baseProvider(),
      baseUrl: 'https://api.anthropic.com/v1',
      headers: {},
      transport: 'anthropic',
      createTimeoutSignal,
      performFetch,
    });

    expect(result.models).toHaveLength(7);
    expect(result.models).toContain('claude-haiku-4-5');
  });

  it('ignores malformed entries (missing id) without throwing', async () => {
    const performFetch = jest.fn().mockResolvedValueOnce(
      jsonResponse({
        data: [{ display_name: 'no id here' }, { id: 'claude-opus-5', max_input_tokens: 1000000 }],
        has_more: false,
      }),
    );

    const result = await fetchProviderModels({
      provider: baseProvider(),
      baseUrl: 'https://api.anthropic.com/v1',
      headers: {},
      transport: 'anthropic',
      createTimeoutSignal,
      performFetch,
    });

    expect(result.models).toEqual(['claude-opus-5']);
  });
});
