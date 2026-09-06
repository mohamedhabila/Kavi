import {
  PROVIDER_EMBEDDING_MINIMUM_CALL_INTERVAL_MS,
  resetProviderEmbeddingRateLimiterForTests,
  throttledProviderEmbeddingCall,
} from '../../../src/services/memory/providerEmbeddingRateLimiter';

beforeEach(() => {
  resetProviderEmbeddingRateLimiterForTests();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('throttledProviderEmbeddingCall', () => {
  it('runs the first call immediately without waiting', async () => {
    const fn = jest.fn(async () => 'first');
    const promise = throttledProviderEmbeddingCall(fn);
    await jest.advanceTimersByTimeAsync(0);
    await expect(promise).resolves.toBe('first');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('delays a second call until the minimum interval has elapsed', async () => {
    const fn = jest.fn(async () => 'value');
    await throttledProviderEmbeddingCall(fn);

    const secondPromise = throttledProviderEmbeddingCall(fn);
    let secondSettled = false;
    secondPromise.then(() => {
      secondSettled = true;
    });

    await jest.advanceTimersByTimeAsync(PROVIDER_EMBEDDING_MINIMUM_CALL_INTERVAL_MS - 1);
    expect(secondSettled).toBe(false);

    await jest.advanceTimersByTimeAsync(1);
    await secondPromise;
    expect(secondSettled).toBe(true);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not wait again once the interval has already elapsed on its own', async () => {
    const fn = jest.fn(async () => 'value');
    await throttledProviderEmbeddingCall(fn);

    await jest.advanceTimersByTimeAsync(PROVIDER_EMBEDDING_MINIMUM_CALL_INTERVAL_MS * 2);

    const startedAt = Date.now();
    const promise = throttledProviderEmbeddingCall(fn);
    await jest.advanceTimersByTimeAsync(0);
    await promise;
    expect(Date.now() - startedAt).toBe(0);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('propagates a rejection from the wrapped call without disrupting future pacing', async () => {
    const failing = jest.fn(async () => {
      throw new Error('provider_embedding_call_failed');
    });
    await expect(throttledProviderEmbeddingCall(failing)).rejects.toThrow(
      'provider_embedding_call_failed',
    );

    const succeeding = jest.fn(async () => 'recovered');
    const promise = throttledProviderEmbeddingCall(succeeding);
    await jest.advanceTimersByTimeAsync(PROVIDER_EMBEDDING_MINIMUM_CALL_INTERVAL_MS);
    await expect(promise).resolves.toBe('recovered');
  });

  it('resets pacing state for test isolation', async () => {
    const fn = jest.fn(async () => 'value');
    await throttledProviderEmbeddingCall(fn);
    resetProviderEmbeddingRateLimiterForTests();

    const startedAt = Date.now();
    const promise = throttledProviderEmbeddingCall(fn);
    await jest.advanceTimersByTimeAsync(0);
    await promise;
    expect(Date.now() - startedAt).toBe(0);
  });
});
