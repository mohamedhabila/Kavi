import {
  resetSchedulerOperationLockForTests,
  tryWithSchedulerExecutionSlot,
  withSchedulerRecoveryBarrier,
} from '../../src/services/scheduler/operationLock';

describe('scheduler execution coordinator', () => {
  beforeEach(() => resetSchedulerOperationLockForTests());

  it('allows bounded independent work and rejects excess capacity without queueing', async () => {
    const releases: Array<() => void> = [];
    const hold = () =>
      new Promise<string>((resolve) => {
        releases.push(() => resolve('done'));
      });

    const first = tryWithSchedulerExecutionSlot(hold);
    const second = tryWithSchedulerExecutionSlot(hold);
    await Promise.resolve();

    await expect(tryWithSchedulerExecutionSlot(async () => 'third')).resolves.toEqual({
      acquired: false,
      reason: 'capacity',
    });
    releases.forEach((release) => release());
    await expect(Promise.all([first, second])).resolves.toEqual([
      { acquired: true, value: 'done' },
      { acquired: true, value: 'done' },
    ]);
  });

  it('blocks new work and waits for active work before foreground recovery', async () => {
    let releaseExecution!: () => void;
    const execution = tryWithSchedulerExecutionSlot(
      () =>
        new Promise<string>((resolve) => {
          releaseExecution = () => resolve('complete');
        }),
    );
    const recovery = jest.fn().mockResolvedValue(undefined);
    const barrier = withSchedulerRecoveryBarrier(recovery);

    await expect(tryWithSchedulerExecutionSlot(async () => 'late')).resolves.toEqual({
      acquired: false,
      reason: 'recovery',
    });
    expect(recovery).not.toHaveBeenCalled();
    releaseExecution();
    await execution;
    await barrier;
    expect(recovery).toHaveBeenCalledTimes(1);
  });
});
