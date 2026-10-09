// ---------------------------------------------------------------------------
// Tests — declared reasoning capability from an OpenAI-compatible models API
// ---------------------------------------------------------------------------

import { fetchProviderModels } from '../../../../src/services/llm/catalog/modelDiscovery';
import { clearProviderContextWindowsForTests } from '../../../../src/services/context/providerContextWindows';

const createTimeoutSignal = (_ms: number) => new AbortController().signal;

const provider = {
  id: 'openrouter',
  name: 'OpenRouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKey: 'or-key',
  model: 'z-ai/glm-5.3-flash',
  enabled: true,
};

async function discover(entries: unknown[]) {
  const performFetch = jest.fn().mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ data: entries }),
  });
  return fetchProviderModels({
    provider,
    baseUrl: provider.baseUrl,
    headers: { Authorization: 'Bearer or-key' },
    transport: 'compatible',
    createTimeoutSignal,
    performFetch,
  });
}

describe('fetchProviderModels — declared reasoning capability', () => {
  beforeEach(() => {
    clearProviderContextWindowsForTests();
  });

  it('records whether reasoning is mandatory and which efforts the model accepts', async () => {
    const result = await discover([
      {
        id: 'z-ai/glm-5.3-flash',
        architecture: { input_modalities: ['text', 'image'] },
        supported_parameters: ['tools', 'reasoning'],
        reasoning: {
          mandatory: true,
          default_enabled: true,
          supported_efforts: ['max', 'high', 'low'],
          default_effort: 'max',
        },
      },
    ]);

    expect(result.capabilities['z-ai/glm-5.3-flash']).toEqual({
      vision: true,
      tools: true,
      fileInput: false,
      reasoning: { mandatory: true, supportedEfforts: ['max', 'high', 'low'] },
    });
  });

  it('leaves the capability undeclared when the entry says nothing about reasoning', async () => {
    const result = await discover([
      { id: 'meta/llama', architecture: { input_modalities: ['text'] }, supported_parameters: [] },
    ]);

    expect(result.capabilities['meta/llama']).not.toHaveProperty('reasoning');
  });

  it.each([
    ['a missing mandatory flag', { supported_efforts: ['low'] }],
    ['no supported efforts', { mandatory: true, supported_efforts: [] }],
    ['non-string efforts', { mandatory: false, supported_efforts: ['low', 3] }],
    ['a non-object value', 'mandatory'],
  ])('treats %s as undeclared rather than guessing', async (_label, reasoning) => {
    const result = await discover([
      { id: 'vendor/model', architecture: { input_modalities: ['text'] }, reasoning },
    ]);

    expect(result.capabilities['vendor/model']).not.toHaveProperty('reasoning');
  });
});
