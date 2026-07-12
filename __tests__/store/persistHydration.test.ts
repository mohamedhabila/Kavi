const mockUnrefTimerIfSupported = jest.fn();

jest.mock('../../src/utils/timers', () => ({
  unrefTimerIfSupported: (...args: any[]) => mockUnrefTimerIfSupported(...args),
}));

import {
  isStoreHydrated,
  subscribeToStoreHydration,
  waitForRequiredStoreHydration,
  waitForStoreHydration,
} from '../../src/store/persistHydration';

describe('persistHydration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it('treats stores without persist metadata as already hydrated', () => {
    expect(isStoreHydrated({})).toBe(true);
  });

  it('delegates hydration state to the persist API when available', () => {
    expect(isStoreHydrated({ persist: { hasHydrated: () => false } })).toBe(false);
    expect(isStoreHydrated({ persist: { hasHydrated: () => true } })).toBe(true);
  });

  it('immediately invokes the listener when the store is already hydrated', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeToStoreHydration(
      {
        persist: {
          hasHydrated: () => true,
          onFinishHydration: jest.fn(),
        },
      },
      listener,
    );

    expect(listener).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toEqual(expect.any(Function));
  });

  it('subscribes to hydration completion when the store is still hydrating', () => {
    const listener = jest.fn();
    const unsubscribeInner = jest.fn();
    const onFinishHydration = jest.fn().mockReturnValue(unsubscribeInner);

    const unsubscribe = subscribeToStoreHydration(
      {
        persist: {
          hasHydrated: () => false,
          onFinishHydration,
        },
      },
      listener,
    );

    expect(listener).not.toHaveBeenCalled();
    expect(onFinishHydration).toHaveBeenCalledWith(listener);

    unsubscribe();
    expect(unsubscribeInner).toHaveBeenCalledTimes(1);
  });

  it('waits for hydration completion before the timeout elapses', async () => {
    jest.useFakeTimers();

    let hydrationListener: (() => void) | undefined;
    const unsubscribe = jest.fn();
    const hydrationPromise = waitForStoreHydration(
      {
        persist: {
          hasHydrated: () => false,
          onFinishHydration: (listener) => {
            hydrationListener = listener;
            return unsubscribe;
          },
        },
      },
      50,
    );

    expect(mockUnrefTimerIfSupported).toHaveBeenCalledTimes(1);

    hydrationListener?.();
    await expect(hydrationPromise).resolves.toBeUndefined();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('resolves after the timeout when hydration never finishes', async () => {
    jest.useFakeTimers();

    const unsubscribe = jest.fn();
    const hydrationPromise = waitForStoreHydration(
      {
        persist: {
          hasHydrated: () => false,
          onFinishHydration: () => unsubscribe,
        },
      },
      50,
    );

    await jest.advanceTimersByTimeAsync(50);
    await expect(hydrationPromise).resolves.toBeUndefined();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('waits without a timeout when noncritical work requires persisted state', async () => {
    jest.useFakeTimers();
    let hydrationListener: (() => void) | undefined;
    let resolved = false;
    const hydrationPromise = waitForStoreHydration(
      {
        persist: {
          hasHydrated: () => false,
          onFinishHydration: (listener) => {
            hydrationListener = listener;
            return jest.fn();
          },
        },
      },
      null,
    ).then(() => {
      resolved = true;
    });

    await jest.advanceTimersByTimeAsync(60_000);
    expect(resolved).toBe(false);
    expect(mockUnrefTimerIfSupported).not.toHaveBeenCalled();

    hydrationListener?.();
    await hydrationPromise;
    expect(resolved).toBe(true);
  });

  it('retries hydration explicitly before allowing required persisted state', async () => {
    jest.useFakeTimers();
    let hydrated = false;
    const rehydrate = jest.fn(async () => {
      hydrated = true;
    });
    const hydrationPromise = waitForRequiredStoreHydration(
      {
        persist: {
          hasHydrated: () => hydrated,
          onFinishHydration: () => jest.fn(),
          rehydrate,
        },
      },
      { name: 'test store', timeoutMs: 50 },
    );

    await jest.advanceTimersByTimeAsync(50);

    await expect(hydrationPromise).resolves.toBeUndefined();
    expect(rehydrate).toHaveBeenCalledTimes(1);
  });

  it('fails boundedly when required rehydration never settles', async () => {
    jest.useFakeTimers();
    const hydrationPromise = waitForRequiredStoreHydration(
      {
        persist: {
          hasHydrated: () => false,
          onFinishHydration: () => jest.fn(),
          rehydrate: () => new Promise<void>(() => undefined),
        },
      },
      { name: 'stuck store', timeoutMs: 50 },
    );
    const rejection = expect(hydrationPromise).rejects.toThrow(
      'Failed to hydrate stuck store: rehydration timed out after 50ms',
    );

    await jest.advanceTimersByTimeAsync(50);
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(50);

    await rejection;
  });
});
