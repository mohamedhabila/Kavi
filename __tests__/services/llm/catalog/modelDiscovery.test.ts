// ---------------------------------------------------------------------------
// Tests — Anthropic live model discovery (GET /v1/models, paginated)
// ---------------------------------------------------------------------------

import { ANTHROPIC_PRESET_MODELS } from '../../../../src/constants/api';
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

/**
 * A key bound to one workspace: the API refuses it the organization's workspace list, so
 * discovery names no workspace and `models` sees only the model requests.
 */
function boundKey(models: jest.Mock) {
  return (url: string, init: RequestInit) =>
    url.includes('/organizations/workspaces')
      ? Promise.resolve(jsonResponse({ error: { type: 'permission_error' } }, false, 403))
      : models(url, init);
}

describe('fetchProviderModels — Anthropic live discovery', () => {
  beforeEach(() => {
    clearProviderContextWindowsForTests();
  });

  it('fetches a single page and maps max_input_tokens and the declared capabilities', async () => {
    const performFetch = jest.fn().mockResolvedValueOnce(
      jsonResponse({
        data: [
          {
            id: 'claude-opus-5',
            display_name: 'Claude Opus 5',
            created_at: '2026-01-01T00:00:00Z',
            max_input_tokens: 1000000,
            max_tokens: 128000,
            capabilities: {
              image_input: { supported: true },
              pdf_input: { supported: false },
              thinking: {
                supported: true,
                types: {
                  enabled: { supported: false },
                  adaptive: { supported: true },
                  disabled: { supported: true },
                },
              },
              effort: {
                supported: true,
                low: { supported: true },
                medium: { supported: true },
                high: { supported: true },
                xhigh: { supported: true },
                max: { supported: true },
              },
            },
          },
          {
            id: 'claude-haiku-4-5',
            display_name: 'Claude Haiku 4.5',
            created_at: '2025-01-01T00:00:00Z',
            max_input_tokens: 200000,
            max_tokens: 64000,
            capabilities: {
              image_input: { supported: true },
              pdf_input: { supported: true },
              thinking: {
                supported: true,
                types: {
                  enabled: { supported: true },
                  adaptive: { supported: false },
                  disabled: { supported: true },
                },
              },
              effort: { supported: false, low: { supported: false } },
            },
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
      performFetch: boundKey(performFetch),
    });

    expect(result.models).toEqual(['claude-haiku-4-5', 'claude-opus-5']);
    expect(result.capabilities['claude-opus-5']).toEqual({
      vision: true,
      tools: true,
      fileInput: false,
      reasoning: {
        mandatory: false,
        supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
        thinkingModes: ['adaptive', 'disabled'],
      },
    });
    expect(result.capabilities['claude-haiku-4-5']).toEqual({
      vision: true,
      tools: true,
      fileInput: true,
      reasoning: { mandatory: false, supportedEfforts: [], thinkingModes: ['enabled', 'disabled'] },
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
      performFetch: boundKey(performFetch),
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
      performFetch: boundKey(performFetch),
    });

    // The static catalog is the Anthropic preset's lineup, current generation first.
    expect(result.models).toEqual(ANTHROPIC_PRESET_MODELS);
    expect(result.models[0]).toBe('claude-opus-5-5');
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
      performFetch: boundKey(performFetch),
    });

    expect(result.models).toEqual(ANTHROPIC_PRESET_MODELS);
  });

  it('falls back to the static catalog when the response has no models at all', async () => {
    const performFetch = jest.fn().mockResolvedValue(jsonResponse({ data: [], has_more: false }));

    const result = await fetchProviderModels({
      provider: baseProvider(),
      baseUrl: 'https://api.anthropic.com/v1',
      headers: {},
      transport: 'anthropic',
      createTimeoutSignal,
      performFetch: boundKey(performFetch),
    });

    expect(result.models).toEqual(ANTHROPIC_PRESET_MODELS);
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
      performFetch: boundKey(performFetch),
    });

    expect(result.models).toEqual(['claude-opus-5']);
  });
});
