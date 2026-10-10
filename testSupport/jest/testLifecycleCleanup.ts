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

// The transcript archive keeps one SQLite connection per process. Tests that reset the
// expo-sqlite shim close it underneath; release it so the next test opens a fresh one.
afterEach(() => {
  const loadedModule = require.cache[
    require.resolve('../../src/services/transcriptArchive/database')
  ] as { exports?: { closeTranscriptArchiveDb?: () => void } } | undefined;
  try {
    loadedModule?.exports?.closeTranscriptArchiveDb?.();
  } catch {
    // A connection the shim already closed has nothing left to release.
  }
  const archiveModule = require.cache[
    require.resolve('../../src/services/transcriptArchive/transcriptArchive')
  ] as { exports?: { _resetTranscriptArchiveStateForTests?: () => void } } | undefined;
  archiveModule?.exports?._resetTranscriptArchiveStateForTests?.();
});
