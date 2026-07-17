afterEach(() => {
  const modulePath = require.resolve('../../src/store/throttledStorage');
  const loadedModule = require.cache[modulePath] as
    | { exports?: { _resetThrottledStorageStateForTests?: () => void } }
    | undefined;
  loadedModule?.exports?._resetThrottledStorageStateForTests?.();
});
