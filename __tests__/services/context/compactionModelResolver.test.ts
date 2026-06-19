import { resolveCompactionSummarizerConfig } from '../../../src/services/context/compactionModelResolver';
import { useSettingsStore } from '../../../src/store/useSettingsStore';
import { finalizeProviderConfig } from '../../../src/constants/api';

jest.mock('../../../src/services/storage/SecureStorage', () => ({
  getProviderApiKey: jest.fn().mockResolvedValue('sk-test'),
}));

describe('compactionModelResolver', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      providers: [
        finalizeProviderConfig({
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-test',
          model: 'gpt-5.4',
          enabled: true,
        }),
      ],
      compactionProvider: null,
      compactionModel: null,
    });
  });

  it('returns null when compaction provider is unset', async () => {
    await expect(resolveCompactionSummarizerConfig()).resolves.toBeNull();
  });

  it('resolves configured provider and model override', async () => {
    useSettingsStore.setState({
      compactionProvider: 'openai',
      compactionModel: 'gpt-5-mini',
    });

    const config = await resolveCompactionSummarizerConfig();
    expect(config?.provider.id).toBe('openai');
    expect(config?.model).toBe('gpt-5-mini');
  });
});