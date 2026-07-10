import {
  decodeAndroidDurableCandidateHeadlessPayload,
  registerAndroidDurableCandidateHeadlessTask,
  runAndroidDurableCandidateHeadlessTask,
} from '../../src/services/executionJournal/androidDurableCandidateHeadlessTask';

describe('Android durable candidate headless task', () => {
  it('decodes only the exact native continuation payload', () => {
    expect(decodeAndroidDurableCandidateHeadlessPayload(payload())).toEqual(payload());
    expect(() =>
      decodeAndroidDurableCandidateHeadlessPayload({ ...payload(), unexpected: true }),
    ).toThrow('android-durable-candidate-payload-invalid');
    expect(() =>
      decodeAndroidDurableCandidateHeadlessPayload({
        ...payload(),
        wakeWorkId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
      }),
    ).toThrow('android-durable-candidate-payload-invalid');
  });

  it('acknowledges successful scheduling and terminal no-work outcomes', async () => {
    const dependencies = harness({ kind: 'scheduled', runId: 'run-1' });

    await runAndroidDurableCandidateHeadlessTask(payload(), dependencies);

    expect(dependencies.continueRun).toHaveBeenCalledWith(
      'run-1',
      '00000000-0000-4000-8000-000000000072',
    );
    expect(dependencies.acknowledge).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000071',
      '00000000-0000-4000-8000-000000000072',
      'run-1',
      'completed',
    );
  });

  it('requests a bounded WorkManager retry for transient or thrown scheduling failures', async () => {
    const deferred = harness({
      kind: 'deferred',
      runId: 'run-1',
      reason: 'native_store_unavailable',
    });
    await runAndroidDurableCandidateHeadlessTask(payload(), deferred);
    expect(deferred.acknowledge).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000071',
      '00000000-0000-4000-8000-000000000072',
      'run-1',
      'retry',
    );

    const thrown = harness({ kind: 'scheduled', runId: 'run-1' });
    thrown.continueRun.mockRejectedValue(new Error('journal unavailable'));
    await runAndroidDurableCandidateHeadlessTask(payload(), thrown);
    expect(thrown.acknowledge).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000071',
      '00000000-0000-4000-8000-000000000072',
      'run-1',
      'retry',
    );
  });

  it('registers under the exact candidate task key', () => {
    const registerHeadlessTask = jest.fn();
    jest.isolateModules(() => {
      jest.doMock('react-native', () => ({
        AppRegistry: { registerHeadlessTask },
        Platform: { OS: 'android' },
      }));
      registerAndroidDurableCandidateHeadlessTask();
    });

    expect(registerHeadlessTask).toHaveBeenCalledWith(
      'KaviDurableCandidateSchedule',
      expect.any(Function),
    );
    jest.unmock('react-native');
  });

  function harness(outcome: Record<string, unknown>) {
    return {
      continueRun: jest.fn().mockResolvedValue(outcome),
      acknowledge: jest.fn().mockResolvedValue(undefined),
    };
  }

  function payload() {
    return {
      schema: 1 as const,
      wakeWorkId: '00000000-0000-4000-8000-000000000071',
      predecessorWorkId: '00000000-0000-4000-8000-000000000072',
      runId: 'run-1',
    };
  }
});
