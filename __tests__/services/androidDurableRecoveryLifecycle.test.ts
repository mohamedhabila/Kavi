import {
  scheduleAndroidDurableRecoveryRepair,
  scheduleAndroidDurableRecoveryRunImmediately,
} from '../../src/services/executionJournal/androidDurableRecoveryLifecycle';

describe('Android durable recovery lifecycle', () => {
  it('immediately schedules a just-persisted Android generation', async () => {
    const scheduleRun = jest.fn(async (runId: string) => ({
      kind: 'scheduled' as const,
      runId,
    }));
    await expect(
      scheduleAndroidDurableRecoveryRunImmediately('run-1', {
        platform: 'android',
        scheduleRun,
      }),
    ).resolves.toEqual({ kind: 'scheduled', runId: 'run-1' });
    expect(scheduleRun).toHaveBeenCalledWith('run-1');
  });

  it('does not load or invoke Android scheduling on another platform', async () => {
    const scheduleRun = jest.fn();
    await expect(
      scheduleAndroidDurableRecoveryRunImmediately('run-1', {
        platform: 'ios',
        scheduleRun,
      }),
    ).resolves.toEqual({ kind: 'not_android', runId: 'run-1' });
    expect(scheduleRun).not.toHaveBeenCalled();
  });

  it('runs only on Android and surfaces attention outcomes', async () => {
    const scheduleSlice = jest.fn().mockResolvedValue({
      outcomes: [
        { kind: 'scheduled', runId: 'run-1' },
        { kind: 'deferred', runId: 'run-2', reason: 'journal_unavailable' },
      ],
      nextAfter: null,
    });
    const continueAfterYield = jest.fn();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      scheduleAndroidDurableRecoveryRepair('foreground', {
        platform: 'ios',
        scheduleSlice,
        continueAfterYield,
      });
      expect(scheduleSlice).not.toHaveBeenCalled();

      scheduleAndroidDurableRecoveryRepair('startup', {
        platform: 'android',
        scheduleSlice,
        continueAfterYield,
      });
      await Promise.resolve();
      expect(scheduleSlice).toHaveBeenCalledWith({ limit: 25 });
      expect(continueAfterYield).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        '[startup] Android durable recovery startup scan needs attention',
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('cooperatively continues past one hundred candidates without a total cap', async () => {
    const scheduled = (count: number, offset: number) =>
      Array.from({ length: count }, (_, index) => ({
        kind: 'scheduled' as const,
        runId: `run-${offset + index}`,
      }));
    const scheduleSlice = jest
      .fn()
      .mockResolvedValueOnce({ outcomes: scheduled(25, 0), nextAfter: 'cursor-1' })
      .mockResolvedValueOnce({ outcomes: scheduled(25, 25), nextAfter: 'cursor-2' })
      .mockResolvedValueOnce({ outcomes: scheduled(25, 50), nextAfter: 'cursor-3' })
      .mockResolvedValueOnce({ outcomes: scheduled(25, 75), nextAfter: 'cursor-4' })
      .mockResolvedValueOnce({ outcomes: scheduled(1, 100), nextAfter: null });
    const continuations: Array<() => void> = [];
    const continueAfterYield = jest.fn((continuation: () => void) => {
      continuations.push(continuation);
    });

    scheduleAndroidDurableRecoveryRepair('startup', {
      platform: 'android',
      scheduleSlice,
      continueAfterYield,
    });
    await Promise.resolve();
    for (let index = 0; index < 4; index += 1) {
      expect(continuations).toHaveLength(1);
      continuations.shift()!();
      await Promise.resolve();
    }

    expect(scheduleSlice).toHaveBeenCalledTimes(5);
    expect(scheduleSlice).toHaveBeenNthCalledWith(1, { limit: 25 });
    expect(scheduleSlice).toHaveBeenNthCalledWith(5, { limit: 25, after: 'cursor-4' });
    expect(continueAfterYield).toHaveBeenCalledTimes(4);
  });

  it('stops and reports an injected stalled lifecycle cursor', async () => {
    const scheduleSlice = jest
      .fn()
      .mockResolvedValueOnce({ outcomes: [], nextAfter: 'cursor-1' })
      .mockResolvedValueOnce({ outcomes: [], nextAfter: 'cursor-1' });
    const continuations: Array<() => void> = [];
    const continueAfterYield = jest.fn((continuation: () => void) => {
      continuations.push(continuation);
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      scheduleAndroidDurableRecoveryRepair('foreground', {
        platform: 'android',
        scheduleSlice,
        continueAfterYield,
      });
      await Promise.resolve();
      continuations.shift()!();
      await Promise.resolve();
      await Promise.resolve();

      expect(scheduleSlice).toHaveBeenCalledTimes(2);
      expect(continueAfterYield).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        '[startup] Android durable recovery foreground scan failed:',
        expect.objectContaining({ message: 'android-durable-scan-cursor-stalled' }),
      );
    } finally {
      warn.mockRestore();
    }
  });
});
