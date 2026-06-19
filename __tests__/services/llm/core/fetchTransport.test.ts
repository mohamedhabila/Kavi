const mockExpoFetch = jest.fn();

jest.mock('expo/fetch', () => ({
  fetch: (...args: unknown[]) => mockExpoFetch(...args),
}));

import { performLlmFetch } from '../../../../src/services/llm/core/fetchTransport';

describe('performLlmFetch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects on abort even when the streaming fetch never settles', async () => {
    const abortController = new AbortController();
    mockExpoFetch.mockReturnValue(new Promise<Response>(() => {}));

    const pendingFetch = performLlmFetch(
      'https://example.test/stream',
      { signal: abortController.signal },
      true,
    );

    abortController.abort();

    await expect(pendingFetch).rejects.toMatchObject({ name: 'AbortError' });
    expect(mockExpoFetch).toHaveBeenCalledWith(
      'https://example.test/stream',
      expect.objectContaining({
        credentials: 'omit',
        signal: abortController.signal,
      }),
    );
  });
});
