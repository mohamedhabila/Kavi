import { AppRegistry, AppState, Platform } from 'react-native';

const mockCalls: string[] = [];
const mockInitializeServices = jest.fn(() => mockCalls.push('initializeServices'));
const mockI18nInit = jest.fn(async () => {
  mockCalls.push('i18n.init');
});
const mockFlushPendingStorageWrites = jest.fn(async () => {
  mockCalls.push('flush');
});
const mockEvaluateJobsOnce = jest.fn();

jest.mock('../../src/services/startup', () => ({
  initializeServices: () => mockInitializeServices(),
}));
jest.mock('../../src/i18n/manager', () => ({ i18n: { init: () => mockI18nInit() } }));
jest.mock('../../src/store/throttledStorage', () => ({
  flushPendingStorageWrites: () => mockFlushPendingStorageWrites(),
}));
jest.mock('../../src/services/scheduler/engine', () => ({
  evaluateJobsOnce: (...args: unknown[]) => mockEvaluateJobsOnce(...args),
}));

import {
  HEADLESS_NEW_TASK_BUDGET_MS,
  SCHEDULED_JOBS_HEADLESS_TASK,
  registerScheduledJobsHeadlessTask,
  runDueScheduledJobsHeadless,
} from '../../src/services/scheduler/headlessRun';
import {
  isHeadlessSchedulerHostActive,
  isSchedulerHostActive,
} from '../../src/services/scheduler/headlessHost';

describe('headless scheduled run', () => {
  beforeEach(() => {
    mockCalls.length = 0;
    jest.clearAllMocks();
    (AppState as { currentState: string }).currentState = 'background';
    mockEvaluateJobsOnce.mockImplementation(async () => {
      mockCalls.push(`evaluate hosted=${isHeadlessSchedulerHostActive()}`);
    });
  });

  it('brings services up, runs due tasks while hosted, then persists', async () => {
    await runDueScheduledJobsHeadless();

    expect(mockCalls).toEqual(['i18n.init', 'initializeServices', 'evaluate hosted=true', 'flush']);
    expect(mockEvaluateJobsOnce).toHaveBeenCalledWith({
      trigger: 'background-wake',
      timeBudgetMs: HEADLESS_NEW_TASK_BUDGET_MS,
    });
    expect(isHeadlessSchedulerHostActive()).toBe(false);
    expect(isSchedulerHostActive()).toBe(false);
  });

  it('persists and releases the host when a run fails', async () => {
    mockEvaluateJobsOnce.mockRejectedValueOnce(new Error('store unavailable'));

    await expect(runDueScheduledJobsHeadless()).rejects.toThrow('store unavailable');

    expect(mockFlushPendingStorageWrites).toHaveBeenCalledTimes(1);
    expect(isHeadlessSchedulerHostActive()).toBe(false);
  });

  it('registers the task the native worker starts, on Android only', () => {
    const register = jest.spyOn(AppRegistry, 'registerHeadlessTask').mockImplementation(() => {});
    const originalOS = Platform.OS;
    try {
      Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'ios' });
      registerScheduledJobsHeadlessTask();
      expect(register).not.toHaveBeenCalled();

      Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
      registerScheduledJobsHeadlessTask();
      expect(register).toHaveBeenCalledWith(SCHEDULED_JOBS_HEADLESS_TASK, expect.any(Function));
      expect(register.mock.calls[0]?.[1]()).toBe(runDueScheduledJobsHeadless);
    } finally {
      Object.defineProperty(Platform, 'OS', { configurable: true, get: () => originalOS });
      register.mockRestore();
    }
  });
});
