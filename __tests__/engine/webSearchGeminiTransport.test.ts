import { resolveGeminiSearchTransport } from '../../src/engine/tools/webSearchGeminiTransport';
import { resolveToolProviderContext } from '../../src/engine/tools/toolProviderContext';

jest.mock('../../src/engine/tools/toolProviderContext', () => ({
  resolveToolProviderContext: jest.fn(),
}));

const mockResolveToolProviderContext =
  resolveToolProviderContext as jest.MockedFunction<typeof resolveToolProviderContext>;

describe('resolveGeminiSearchTransport', () => {
  beforeEach(() => {
    mockResolveToolProviderContext.mockReset();
  });

  it('prefers the provider-configured gemini model over the active chat model', async () => {
    mockResolveToolProviderContext.mockResolvedValue({
      model: 'gemini-3.5-flash',
      provider: {
        id: 'gemini-primary',
        enabled: true,
        providerFamily: 'gemini',
        baseUrl: 'https://aiplatform.googleapis.com/v1',
        apiKey: 'provider-key',
        model: 'gemini-2.5-pro',
      } as any,
      allProviders: [],
    });

    await expect(resolveGeminiSearchTransport({})).resolves.toMatchObject({
      apiKey: 'provider-key',
      model: 'gemini-2.5-pro',
    });
  });

  it('falls back to the active chat model when no provider-configured gemini model exists', async () => {
    mockResolveToolProviderContext.mockResolvedValue({
      model: 'gemini-3.5-flash',
      provider: {
        id: 'gemini-primary',
        enabled: true,
        providerFamily: 'gemini',
        baseUrl: 'https://aiplatform.googleapis.com/v1',
        apiKey: 'provider-key',
        model: '',
      } as any,
      allProviders: [],
    });

    await expect(resolveGeminiSearchTransport({})).resolves.toMatchObject({
      apiKey: 'provider-key',
      model: 'gemini-3.5-flash',
    });
  });
});
