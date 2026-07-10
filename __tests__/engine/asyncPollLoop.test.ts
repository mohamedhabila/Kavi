import { runAsyncPollLoop } from '../../src/engine/asyncTracking/pollLoop';

describe('runAsyncPollLoop', () => {
  it('backs off within the declared cap and stops after a terminal observation', async () => {
    let now = 0;
    const sleeps: number[] = [];
    const poll = jest
      .fn<Promise<string>, []>()
      .mockResolvedValueOnce('running')
      .mockResolvedValueOnce('running')
      .mockResolvedValueOnce('completed');

    const result = await runAsyncPollLoop({
      initialValue: 'running',
      shouldContinue: (value) => value === 'running',
      poll,
      pollIntervalMs: 100,
      maxPollIntervalMs: 225,
      backoffFactor: 1.5,
      deadlineMs: 1_000,
      now: () => now,
      sleep: async (delayMs) => {
        sleeps.push(delayMs);
        now += delayMs;
      },
    });

    expect(result).toBe('completed');
    expect(sleeps).toEqual([100, 150, 225]);
    expect(poll).toHaveBeenCalledTimes(3);
  });

  it('does not sleep past or poll at the deadline', async () => {
    let now = 900;
    const sleep = jest.fn(async (delayMs: number) => {
      now += delayMs;
    });
    const poll = jest.fn(async () => 'completed');

    const result = await runAsyncPollLoop({
      initialValue: 'running',
      shouldContinue: (value) => value === 'running',
      poll,
      pollIntervalMs: 250,
      maxPollIntervalMs: 1_000,
      backoffFactor: 2,
      deadlineMs: 1_000,
      now: () => now,
      sleep,
    });

    expect(result).toBe('running');
    expect(sleep).toHaveBeenCalledWith(100);
    expect(poll).not.toHaveBeenCalled();
  });

  it.each([
    [{ pollIntervalMs: 0 }, 'async_poll_interval_invalid'],
    [{ pollIntervalMs: 100, maxPollIntervalMs: 99 }, 'async_poll_max_interval_invalid'],
    [{ pollIntervalMs: 100, backoffFactor: 0.9 }, 'async_poll_backoff_factor_invalid'],
    [{ pollIntervalMs: 100, deadlineMs: Number.NaN }, 'async_poll_deadline_invalid'],
  ])('rejects malformed timing contracts %#', async (overrides, expected) => {
    await expect(
      runAsyncPollLoop({
        initialValue: 'running',
        shouldContinue: () => true,
        poll: async () => 'running',
        pollIntervalMs: 100,
        deadlineMs: 1_000,
        ...overrides,
      }),
    ).rejects.toThrow(expected);
  });
});
