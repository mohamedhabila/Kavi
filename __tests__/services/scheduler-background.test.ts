// ---------------------------------------------------------------------------
// Tests for Background Fetch scheduler module
// ---------------------------------------------------------------------------

const mockEvaluateJobsOnce = jest.fn();

jest.mock('../../src/services/scheduler/engine', () => ({
  evaluateJobsOnce: mockEvaluateJobsOnce,
}));

// We don't mock the expo modules here — background.ts lazy-imports them.
// Instead, we test the public API behavior only.

import {
  registerBackgroundFetch,
  unregisterBackgroundFetch,
  isBackgroundFetchRegistered,
} from '../../src/services/scheduler/background';

beforeEach(async () => {
  jest.clearAllMocks();
  // Reset state
  if (isBackgroundFetchRegistered()) {
    await unregisterBackgroundFetch();
  }
});

describe('Background Fetch', () => {
  it('isBackgroundFetchRegistered returns false initially', () => {
    expect(isBackgroundFetchRegistered()).toBe(false);
  });

  it('registerBackgroundFetch handles missing modules gracefully', async () => {
    // expo-task-manager and expo-background-fetch are not installed in test env,
    // so the try-catch in registerBackgroundFetch should catch and return silently
    await expect(registerBackgroundFetch()).resolves.toBeUndefined();
    // Still not registered since module loading failed
    expect(isBackgroundFetchRegistered()).toBe(false);
  });

  it('unregisterBackgroundFetch is no-op when not registered', async () => {
    await expect(unregisterBackgroundFetch()).resolves.toBeUndefined();
    expect(isBackgroundFetchRegistered()).toBe(false);
  });

  it('exports the expected interface', () => {
    expect(typeof registerBackgroundFetch).toBe('function');
    expect(typeof unregisterBackgroundFetch).toBe('function');
    expect(typeof isBackgroundFetchRegistered).toBe('function');
  });
});
