const mockUnrefTimerIfSupported = jest.fn();

jest.mock('../../src/utils/timers', () => ({
  unrefTimerIfSupported: (...args: any[]) => mockUnrefTimerIfSupported(...args),
}));

import {
  isStoreHydrated,
  subscribeToStoreHydration,
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
});
