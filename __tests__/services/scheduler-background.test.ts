// ---------------------------------------------------------------------------
// Tests for Background Fetch scheduler module
// ---------------------------------------------------------------------------

const mockEvaluateJobsOnce = jest.fn();
let definedTaskHandler: (() => Promise<number>) | undefined;
const mockDefineTask = jest.fn((_: string, handler: () => Promise<number>) => {
  definedTaskHandler = handler;
});
const mockRegisterTaskAsync = jest.fn().mockResolvedValue(undefined);
const mockUnregisterTaskAsync = jest.fn().mockResolvedValue(undefined);

jest.mock('../../src/services/scheduler/engine', () => ({
  evaluateJobsOnce: mockEvaluateJobsOnce,
}));

jest.mock('expo-task-manager', () => ({
  defineTask: (...args: any[]) => mockDefineTask(...args),
}));

jest.mock('expo-background-task', () => ({
  BackgroundTaskResult: {
    Success: 1,
    Failed: 2,
  },
  registerTaskAsync: (...args: any[]) => mockRegisterTaskAsync(...args),
  unregisterTaskAsync: (...args: any[]) => mockUnregisterTaskAsync(...args),
}));

import {
  registerBackgroundFetch,
  unregisterBackgroundFetch,
  isBackgroundFetchRegistered,
} from '../../src/services/scheduler/background';

beforeEach(async () => {
  // Reset state
  if (isBackgroundFetchRegistered()) {
    await unregisterBackgroundFetch();
  }
  mockRegisterTaskAsync.mockReset();
  mockRegisterTaskAsync.mockResolvedValue(undefined);
  mockUnregisterTaskAsync.mockReset();
  mockUnregisterTaskAsync.mockResolvedValue(undefined);
  mockEvaluateJobsOnce.mockReset();
  mockEvaluateJobsOnce.mockResolvedValue(undefined);
});

describe('Background Fetch', () => {
  it('isBackgroundFetchRegistered returns false initially', () => {
    expect(isBackgroundFetchRegistered()).toBe(false);
  });

  it('defines the cron task at module load and registers it with Expo BackgroundTask', async () => {
    await expect(registerBackgroundFetch()).resolves.toBeUndefined();

    expect(mockDefineTask).toHaveBeenCalledWith('KAVI_CRON_BACKGROUND_FETCH', expect.any(Function));
    expect(mockRegisterTaskAsync).toHaveBeenCalledWith('KAVI_CRON_BACKGROUND_FETCH', {
      minimumInterval: 15,
    });
    expect(isBackgroundFetchRegistered()).toBe(true);
  });

  it('registered task evaluates due jobs and reports success', async () => {
    await registerBackgroundFetch();

    expect(definedTaskHandler).toBeDefined();
    await expect(definedTaskHandler?.()).resolves.toBe(1);
    expect(mockEvaluateJobsOnce).toHaveBeenCalledWith({
      trigger: 'background-fetch',
      timeBudgetMs: 25_000,
    });
  });

  it('registered task reports failure when job evaluation throws', async () => {
    mockEvaluateJobsOnce.mockRejectedValueOnce(new Error('scheduler down'));
    await registerBackgroundFetch();

    expect(definedTaskHandler).toBeDefined();
    await expect(definedTaskHandler?.()).resolves.toBe(2);
  });

  it('registerBackgroundFetch handles unavailable background modules gracefully', async () => {
    mockRegisterTaskAsync.mockRejectedValueOnce(new Error('module unavailable'));

    await expect(registerBackgroundFetch()).resolves.toBeUndefined();
    expect(isBackgroundFetchRegistered()).toBe(false);
  });

  it('unregisterBackgroundFetch is no-op when not registered', async () => {
    await expect(unregisterBackgroundFetch()).resolves.toBeUndefined();
    expect(isBackgroundFetchRegistered()).toBe(false);
  });

  it('unregisterBackgroundFetch unregisters an active background task', async () => {
    await registerBackgroundFetch();
    await unregisterBackgroundFetch();

    expect(mockUnregisterTaskAsync).toHaveBeenCalledWith('KAVI_CRON_BACKGROUND_FETCH');
    expect(isBackgroundFetchRegistered()).toBe(false);
  });

  it('exports the expected interface', () => {
    expect(typeof registerBackgroundFetch).toBe('function');
    expect(typeof unregisterBackgroundFetch).toBe('function');
    expect(typeof isBackgroundFetchRegistered).toBe('function');
  });
});
