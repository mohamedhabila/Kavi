import { scheduleAndroidDurableRecoveryRepair } from '../../src/services/executionJournal/androidDurableRecoveryLifecycle';

describe('Android durable recovery lifecycle', () => {
  it('runs only on Android and surfaces attention outcomes', async () => {
    const scheduleCandidates = jest.fn().mockResolvedValue([
      { kind: 'scheduled' },
      { kind: 'deferred' },
    ]);
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
