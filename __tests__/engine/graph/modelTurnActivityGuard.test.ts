import {
  createModelTurnActivityGuard,
  FOREGROUND_MODEL_TURN_INACTIVITY_TIMEOUT_MS,
  MODEL_TURN_INACTIVITY_TIMEOUT_MS,
  normalizeModelTurnActivityError,
} from '../../../src/engine/graph/modelTurnActivityGuard';

describe('model turn activity guard', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('defaults to the 15-minute background/delegated-worker inactivity window', () => {
    const guard = createModelTurnActivityGuard();
    expect(guard.timeoutMs).toBe(MODEL_TURN_INACTIVITY_TIMEOUT_MS);
    guard.dispose();
  });

  it('does not abort a background-window guard before 15 minutes of inactivity', () => {
    jest.useFakeTimers();
    const guard = createModelTurnActivityGuard();
    jest.advanceTimersByTime(MODEL_TURN_INACTIVITY_TIMEOUT_MS - 1);
    expect(guard.signal.aborted).toBe(false);
    expect(guard.didTimeOut()).toBe(false);
    guard.dispose();
  });

  it('aborts a background-window guard after 15 minutes of inactivity', () => {
    jest.useFakeTimers();
    const guard = createModelTurnActivityGuard();
    jest.advanceTimersByTime(MODEL_TURN_INACTIVITY_TIMEOUT_MS);
    expect(guard.signal.aborted).toBe(true);
    expect(guard.didTimeOut()).toBe(true);
    guard.dispose();
  });

  it('honors a foreground 60-second inactivity window instead of the 15-minute default', () => {
    jest.useFakeTimers();
    const guard = createModelTurnActivityGuard(
      undefined,
      FOREGROUND_MODEL_TURN_INACTIVITY_TIMEOUT_MS,
    );
    expect(guard.timeoutMs).toBe(FOREGROUND_MODEL_TURN_INACTIVITY_TIMEOUT_MS);

    jest.advanceTimersByTime(FOREGROUND_MODEL_TURN_INACTIVITY_TIMEOUT_MS - 1);
    expect(guard.signal.aborted).toBe(false);

    jest.advanceTimersByTime(1);
    expect(guard.signal.aborted).toBe(true);
    expect(guard.didTimeOut()).toBe(true);
    guard.dispose();
  });

  it('does not fire a foreground guard at the 15-minute default deadline', () => {
    jest.useFakeTimers();
    const guard = createModelTurnActivityGuard(
      undefined,
      FOREGROUND_MODEL_TURN_INACTIVITY_TIMEOUT_MS,
    );
    // A guard using the shorter foreground window must have already aborted
    // long before the background-run default would have fired.
    jest.advanceTimersByTime(FOREGROUND_MODEL_TURN_INACTIVITY_TIMEOUT_MS);
    expect(guard.signal.aborted).toBe(true);
    guard.dispose();
  });

  it('resets the foreground deadline on markActivity using the foreground window, not the default', () => {
    jest.useFakeTimers();
    const guard = createModelTurnActivityGuard(
      undefined,
      FOREGROUND_MODEL_TURN_INACTIVITY_TIMEOUT_MS,
    );
    jest.advanceTimersByTime(FOREGROUND_MODEL_TURN_INACTIVITY_TIMEOUT_MS - 1);
    guard.markActivity();
    jest.advanceTimersByTime(FOREGROUND_MODEL_TURN_INACTIVITY_TIMEOUT_MS - 1);
    expect(guard.signal.aborted).toBe(false);

    jest.advanceTimersByTime(1);
    expect(guard.signal.aborted).toBe(true);
    guard.dispose();
  });

  it('reports the actual configured window in the normalized timeout error', () => {
    jest.useFakeTimers();
    const guard = createModelTurnActivityGuard(
      undefined,
      FOREGROUND_MODEL_TURN_INACTIVITY_TIMEOUT_MS,
    );
    jest.advanceTimersByTime(FOREGROUND_MODEL_TURN_INACTIVITY_TIMEOUT_MS);
    const normalized = normalizeModelTurnActivityError(new Error('stream ended'), guard);
    expect(normalized.name).toBe('ModelTurnInactivityTimeoutError');
    expect(normalized.message).toContain(`${FOREGROUND_MODEL_TURN_INACTIVITY_TIMEOUT_MS}ms`);
    guard.dispose();
  });

  it('falls back to the default window for a non-finite or non-positive timeoutMs', () => {
    const guardZero = createModelTurnActivityGuard(undefined, 0);
    expect(guardZero.timeoutMs).toBe(MODEL_TURN_INACTIVITY_TIMEOUT_MS);
    guardZero.dispose();

    const guardNaN = createModelTurnActivityGuard(undefined, Number.NaN);
    expect(guardNaN.timeoutMs).toBe(MODEL_TURN_INACTIVITY_TIMEOUT_MS);
    guardNaN.dispose();
  });

  it('aborts immediately when the parent signal is already aborted, independent of timeoutMs', () => {
    const controller = new AbortController();
    controller.abort();
    const guard = createModelTurnActivityGuard(
      controller.signal,
      FOREGROUND_MODEL_TURN_INACTIVITY_TIMEOUT_MS,
    );
    expect(guard.signal.aborted).toBe(true);
    expect(guard.didTimeOut()).toBe(false);
    guard.dispose();
  });
});
