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

  it('reports a queued write failure through the explicit fence exactly once', async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk unavailable'));
    await schedulerStateStorage.setItem('kavi-scheduler', 'value');

    await expect(flushSchedulerStorePersistenceNow()).rejects.toThrow('disk unavailable');
    await expect(flushSchedulerStorePersistenceNow()).resolves.toBeUndefined();
  });
});
