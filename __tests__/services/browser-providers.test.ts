import { probeBrowserProvider } from '../../src/services/browser/providers/probe';
import { getBrowserProviderReadiness } from '../../src/services/browser/providers/readiness';

const mockGetSecure = jest.fn();

jest.mock('../../src/services/storage/SecureStorage', () => ({
  getSecure: (...args: any[]) => mockGetSecure(...args),
}));

describe('browser providers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSecure.mockResolvedValue('bb_test_key');
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as any;
  });

  it('marks Browserbase providers as setup-required until a project id is configured', () => {
    expect(
      getBrowserProviderReadiness({
        id: 'browser-1',
        name: 'Browserbase',
        provider: 'browserbase',
        baseUrl: 'https://api.browserbase.com',
        authMode: 'api-key-header',
        apiKeyRef: 'browser_provider_api_key_browser-1',
        enabled: true,
      }),
    ).toEqual({
      launchable: false,
      reason: 'missing-project-id',
    });
  });

  it('probes Browserbase using the documented API key header and project endpoint', async () => {
    const result = await probeBrowserProvider({
      id: 'browser-1',
      name: 'Browserbase',
      provider: 'browserbase',
      baseUrl: 'https://api.browserbase.com',
      authMode: 'api-key-header',
      apiKeyRef: 'browser_provider_api_key_browser-1',
      projectId: 'proj_123',
      enabled: true,
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.browserbase.com/v1/projects/proj_123',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Accept: 'application/json',
          'X-BB-API-Key': 'bb_test_key',
        }),
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
  });
});
