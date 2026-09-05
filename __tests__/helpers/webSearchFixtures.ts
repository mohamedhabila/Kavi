// Shared fixtures for the executeWebSearch test suites. Extracted when the original
// single web-search.test.ts file crossed the repository's 700-line maintainability
// limit; duplicating this setup per file would have been the worse answer.
//
// jest.mock(...) calls themselves cannot live here — mocks do not carry across
// imports, so each test file that needs the SecureStorage mock declares its own
// `mockGetSecure`/`mockGetProviderApiKey` jest.fn()s and its own jest.mock(...) call.
// What's shared below is the plain runtime setup that sits around those mocks.

import { clearWebSearchCaches } from '../../src/engine/tools/web-search';
import { useSettingsStore } from '../../src/store/useSettingsStore';

let webSearchQueryCounter = 0;

/**
 * Generates a query string that is unique per call, so cache-key collisions
 * between unrelated tests (or repeated test runs) can't produce false passes.
 */
export function uniqueWebSearchQuery(prefix: string): string {
  webSearchQueryCounter += 1;
  return `${prefix}-${webSearchQueryCounter}-${Date.now()}`;
}

export interface WebSearchTestMocks {
  mockFetch: jest.Mock;
  mockGetSecure: jest.Mock;
  mockGetProviderApiKey: jest.Mock;
}

/**
 * Resets the fetch/SecureStorage mocks and the settings store to the same
 * no-provider-configured baseline every executeWebSearch test starts from.
 */
export function resetWebSearchTestState({
  mockFetch,
  mockGetSecure,
  mockGetProviderApiKey,
}: WebSearchTestMocks): void {
  jest.clearAllMocks();
  mockFetch.mockReset();
  mockGetSecure.mockReset();
  mockGetProviderApiKey.mockReset();
  global.fetch = mockFetch;
  mockGetSecure.mockResolvedValue(null);
  mockGetProviderApiKey.mockResolvedValue(null);
  clearWebSearchCaches();
  useSettingsStore.setState({
    activeProviderId: null,
    activeModel: null,
    providers: [],
    webSearchProvider: 'auto',
  } as any);
}

/**
 * Makes `getSecure` resolve `value` only for `keyName` and null otherwise,
 * matching how the real SecureStorage lookup is keyed.
 */
export function mockSecureKey(mockGetSecure: jest.Mock, keyName: string, value: string): void {
  mockGetSecure.mockImplementation((key: string) =>
    key === keyName ? Promise.resolve(value) : Promise.resolve(null),
  );
}
