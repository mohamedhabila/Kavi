const mockExpoFetch = jest.fn();

jest.mock('expo/fetch', () => ({
  fetch: (...args: unknown[]) => mockExpoFetch(...args),
}));

import { performLlmFetch } from '../../../../src/services/llm/core/fetchTransport';
import { createTimeoutSignal } from '../../../../src/utils/runtime';
import { classifyNativeTransportErrorIdentity } from '../../../../src/services/llm/support/providerErrorClassification';

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

  it('classifies a user cancellation as aborted, not timeout, from the real transport helpers', async () => {
    const abortController = new AbortController();
    mockExpoFetch.mockReturnValue(new Promise<Response>(() => {}));

    const pendingFetch = performLlmFetch(
      'https://example.test/stream',
      { signal: abortController.signal },
      true,
    );
    abortController.abort();

    const rejection = await pendingFetch.catch((error: unknown) => error);
    expect(classifyNativeTransportErrorIdentity(rejection)).toBe('aborted');
  });

  it('rejects with a TimeoutError identity — not a generic AbortError — when createTimeoutSignal expires', async () => {
    const originalAbortSignal = globalThis.AbortSignal;
    jest.useFakeTimers();
    try {
      // Force createTimeoutSignal's manual fallback path (no native
      // AbortSignal.timeout) so a fake-timer advance deterministically
      // triggers the same abort machinery real environments without it use.
      Object.defineProperty(globalThis, 'AbortSignal', {
        configurable: true,
        value: undefined,
      });

      mockExpoFetch.mockReturnValue(new Promise<Response>(() => {}));
      const timeoutSignal = createTimeoutSignal(50);

      const pendingFetch = performLlmFetch(
        'https://example.test/stream',
        { signal: timeoutSignal },
        true,
      );
      const rejectionAssertion = pendingFetch.catch((error: unknown) => error);
      jest.advanceTimersByTime(50);
      const rejection = await rejectionAssertion;

      expect(rejection).toMatchObject({ name: 'TimeoutError' });
      expect(classifyNativeTransportErrorIdentity(rejection)).toBe('timeout');

      // The signal is now already aborted — this exercises the
      // `signal.aborted` fast path in `raceFetchWithAbort` (a request
      // started with an already-expired timeout signal) and confirms it
      // preserves the same TimeoutError identity as the racing-abort path.
      mockExpoFetch.mockReturnValue(new Promise<Response>(() => {}));
      const alreadyAbortedRejection = await performLlmFetch(
        'https://example.test/stream',
        { signal: timeoutSignal },
        true,
      ).catch((error: unknown) => error);
      expect(classifyNativeTransportErrorIdentity(alreadyAbortedRejection)).toBe('timeout');
    } finally {
      Object.defineProperty(globalThis, 'AbortSignal', {
        configurable: true,
        value: originalAbortSignal,
      });
      jest.useRealTimers();
    }
  });
});
