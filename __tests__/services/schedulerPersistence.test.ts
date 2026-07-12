import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  flushSchedulerStorePersistenceNow,
  resetSchedulerPersistenceForTests,
  schedulerStateStorage,
} from '../../src/services/scheduler/persistence';

describe('scheduler persistence fence', () => {
  beforeEach(() => {
    resetSchedulerPersistenceForTests();
    jest.clearAllMocks();
  });

  it('serializes writes and waits for the observed tail', async () => {
    let releaseFirst!: () => void;
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    (AsyncStorage.setItem as jest.Mock)
      .mockImplementationOnce(() => firstWrite)
      .mockResolvedValueOnce(undefined);

    void schedulerStateStorage.setItem('kavi-scheduler', 'first');
    void schedulerStateStorage.setItem('kavi-scheduler', 'second');
    await Promise.resolve();
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);

    releaseFirst();
    await flushSchedulerStorePersistenceNow();
    expect(AsyncStorage.setItem.mock.calls).toEqual([
      ['kavi-scheduler', 'first'],
      ['kavi-scheduler', 'second'],
    ]);
  });

  it('reports a queued write failure to every waiter until a later write succeeds', async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk unavailable'));
    await schedulerStateStorage.setItem('kavi-scheduler', 'value');

    const firstFence = flushSchedulerStorePersistenceNow();
    const secondFence = flushSchedulerStorePersistenceNow();
    await expect(firstFence).rejects.toThrow('disk unavailable');
    await expect(secondFence).rejects.toThrow('disk unavailable');

    (AsyncStorage.setItem as jest.Mock).mockResolvedValueOnce(undefined);
    await schedulerStateStorage.setItem('kavi-scheduler', 'newer-value');
    await expect(flushSchedulerStorePersistenceNow()).resolves.toBeUndefined();
  });

  it('reports a rejection without a reason as a failed write', async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(undefined);
    await schedulerStateStorage.setItem('kavi-scheduler', 'value');

    await expect(flushSchedulerStorePersistenceNow()).rejects.toBeUndefined();
  });

  it('does not hydrate stale scheduler state after the latest write failed', async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk unavailable'));
    await schedulerStateStorage.setItem('kavi-scheduler', 'new state');

    await expect(schedulerStateStorage.getItem('kavi-scheduler')).rejects.toThrow(
      'disk unavailable',
    );
    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  });

  it('does not attribute a later concurrent write failure to an earlier fence', async () => {
    let releaseFirst!: () => void;
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    (AsyncStorage.setItem as jest.Mock)
      .mockImplementationOnce(() => firstWrite)
      .mockRejectedValueOnce(new Error('later write failed'));

    void schedulerStateStorage.setItem('kavi-scheduler', 'first');
    const firstFence = flushSchedulerStorePersistenceNow();
    void schedulerStateStorage.setItem('kavi-scheduler', 'second');
    const secondFence = flushSchedulerStorePersistenceNow();

    releaseFirst();
    await expect(firstFence).resolves.toBeUndefined();
    await expect(secondFence).rejects.toThrow('later write failed');
  });
});
