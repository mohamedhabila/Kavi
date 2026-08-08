import { detectSearchProvider } from '../../../src/services/browser/core/providerDispatch';

jest.mock('../../../src/services/browser/core/providerDispatch', () => ({
  detectSearchProvider: jest.fn(),
}));

const mockedDetect = detectSearchProvider as jest.MockedFunction<typeof detectSearchProvider>;

// Observed on-device: `web_search` was offered and failed on runs with no provider
// configured — the wasted round-trip this gate exists to prevent. The snapshot started
// optimistic, and its catch left the previous value standing, so a probe that errored
// advertised the tool for the life of the process.
function loadFresh(): typeof import('../../../src/services/browser/core/searchProviderReadiness') {
  let mod!: typeof import('../../../src/services/browser/core/searchProviderReadiness');
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('../../../src/services/browser/core/searchProviderReadiness');
  });
  return mod;
}

beforeEach(() => {
  mockedDetect.mockReset();
});

describe('a search tool is advertised only once a provider is known to exist', () => {
  it('reports unavailable before any probe has settled', async () => {
    mockedDetect.mockReturnValue(new Promise(() => {}));
    const mod = loadFresh();

    expect(mod.isSearchProviderConfiguredSnapshot()).toBe(false);
  });

  it('reports available once the probe finds a provider', async () => {
    mockedDetect.mockResolvedValue({ provider: 'brave', apiKey: 'k' } as never);
    const mod = loadFresh();
    await mod.refreshSearchProviderReadiness();

    expect(mod.isSearchProviderConfiguredSnapshot()).toBe(true);
  });

  it('reports unavailable when the probe finds none', async () => {
    mockedDetect.mockResolvedValue(null);
    const mod = loadFresh();
    await mod.refreshSearchProviderReadiness();

    expect(mod.isSearchProviderConfiguredSnapshot()).toBe(false);
  });

  it('never treats a probe error as evidence that a provider exists', async () => {
    mockedDetect.mockRejectedValue(new Error('secure storage unavailable'));
    const mod = loadFresh();
    await mod.refreshSearchProviderReadiness();

    expect(mod.isSearchProviderConfiguredSnapshot()).toBe(false);
  });

  it('keeps a settled positive snapshot across a later probe error', async () => {
    mockedDetect.mockResolvedValue({ provider: 'brave', apiKey: 'k' } as never);
    const mod = loadFresh();
    await mod.refreshSearchProviderReadiness();
    expect(mod.isSearchProviderConfiguredSnapshot()).toBe(true);

    mockedDetect.mockRejectedValue(new Error('transient'));
    await mod.refreshSearchProviderReadiness();

    expect(mod.isSearchProviderConfiguredSnapshot()).toBe(true);
  });

  it('recovers without a restart when a key is added', async () => {
    mockedDetect.mockResolvedValue(null);
    const mod = loadFresh();
    await mod.refreshSearchProviderReadiness();
    expect(mod.isSearchProviderConfiguredSnapshot()).toBe(false);

    mockedDetect.mockResolvedValue({ provider: 'brave', apiKey: 'k' } as never);
    await mod.refreshSearchProviderReadiness();

    expect(mod.isSearchProviderConfiguredSnapshot()).toBe(true);
  });
});
