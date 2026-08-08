afterEach(() => {
  const modulePath = require.resolve('../../src/store/throttledStorage');
  const loadedModule = require.cache[modulePath] as
    | { exports?: { _resetThrottledStorageStateForTests?: () => void } }
    | undefined;
  loadedModule?.exports?._resetThrottledStorageStateForTests?.();
});

// A configured web search provider is the default precondition for the suite.
//
// Availability is probed from secure storage, which no unit test provides, and the
// snapshot is fail-closed: unknown means unavailable, so `web_search` is withheld. That
// is right in production — advertising a tool that cannot work costs a guaranteed failed
// call — but it silently changed the subject of every test that asserts tool filtering,
// authorization or sandboxing while merely assuming search exists. Declaring the
// precondition here keeps those tests about what they mean to test. A test that is about
// the gate itself isolates the module and sets its own value.
beforeEach(() => {
  const modulePath = require.resolve('../../src/services/browser/core/searchProviderReadiness');
  const loadedModule = require.cache[modulePath] as
    | { exports?: { setSearchProviderReadinessSnapshot?: (configured: boolean) => void } }
    | undefined;
  loadedModule?.exports?.setSearchProviderReadinessSnapshot?.(true);
});
