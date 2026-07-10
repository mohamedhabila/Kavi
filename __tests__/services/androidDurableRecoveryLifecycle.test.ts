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
    const scheduleCandidates = jest
      .fn()
      .mockResolvedValue([{ kind: 'scheduled' }, { kind: 'deferred' }]);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      scheduleAndroidDurableRecoveryRepair('foreground', {
        platform: 'ios',
        scheduleCandidates,
      });
      expect(scheduleCandidates).not.toHaveBeenCalled();

      scheduleAndroidDurableRecoveryRepair('startup', {
        platform: 'android',
        scheduleCandidates,
      });
      await Promise.resolve();
      expect(scheduleCandidates).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        '[startup] Android durable recovery startup scan needs attention',
      );
    } finally {
      warn.mockRestore();
    }
  });
});
