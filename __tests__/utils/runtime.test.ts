import { createTimeoutSignal, isJestRuntime } from '../../src/utils/runtime';

const originalAbortSignal = globalThis.AbortSignal;
const runtimeGlobal = globalThis as typeof globalThis & { jest?: unknown };
const originalJest = runtimeGlobal.jest;
const originalJestWorkerId = process.env.JEST_WORKER_ID;

describe('runtime utils', () => {
  afterEach(() => {
    jest.useRealTimers();
    Object.defineProperty(globalThis, 'AbortSignal', {
      configurable: true,
      value: originalAbortSignal,
    });
    runtimeGlobal.jest = originalJest;
    if (originalJestWorkerId === undefined) {
      delete process.env.JEST_WORKER_ID;
    } else {
      process.env.JEST_WORKER_ID = originalJestWorkerId;
    }
  });

  it('uses AbortSignal.timeout when the runtime provides it', () => {
    const timeoutSignal = new AbortController().signal;
    const timeout = jest.fn().mockReturnValue(timeoutSignal);

    Object.defineProperty(globalThis, 'AbortSignal', {
      configurable: true,
      value: { timeout },
    });

    expect(createTimeoutSignal(123)).toBe(timeoutSignal);
    expect(timeout).toHaveBeenCalledWith(123);
  });

  it('falls back to AbortController when AbortSignal.timeout is unavailable', () => {
    jest.useFakeTimers();

    Object.defineProperty(globalThis, 'AbortSignal', {
      configurable: true,
      value: undefined,
    });

    const signal = createTimeoutSignal(100);
    expect(signal.aborted).toBe(false);

    jest.advanceTimersByTime(100);

    expect(signal.aborted).toBe(true);
  });

  it('detects whether the current runtime is Jest', () => {
    runtimeGlobal.jest = undefined;
    delete process.env.JEST_WORKER_ID;
    expect(isJestRuntime()).toBe(false);

    runtimeGlobal.jest = {};
    expect(isJestRuntime()).toBe(true);

    runtimeGlobal.jest = undefined;
    process.env.JEST_WORKER_ID = '1';
    expect(isJestRuntime()).toBe(true);
  });
});
