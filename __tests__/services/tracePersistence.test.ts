import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  EXECUTION_TRACE_STORE_KEY,
  executionTraceStateStorage,
  flushExecutionTraceStorePersistenceNow,
  resetExecutionTracePersistenceForTests,
} from '../../src/services/scheduler/tracePersistence';

describe('execution trace persistence fence', () => {
  beforeEach(() => {
    resetExecutionTracePersistenceForTests();
    jest.clearAllMocks();
  });

  it('serializes writes and waits for the observed target', async () => {
    let releaseFirst!: () => void;
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    (AsyncStorage.setItem as jest.Mock)
      .mockImplementationOnce(() => firstWrite)
      .mockResolvedValueOnce(undefined);

    void executionTraceStateStorage.setItem(EXECUTION_TRACE_STORE_KEY, 'first');
    void executionTraceStateStorage.setItem(EXECUTION_TRACE_STORE_KEY, 'second');
    await Promise.resolve();
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);

    releaseFirst();
    await flushExecutionTraceStorePersistenceNow();
    expect(AsyncStorage.setItem.mock.calls).toEqual([
      [EXECUTION_TRACE_STORE_KEY, 'first'],
      [EXECUTION_TRACE_STORE_KEY, 'second'],
    ]);
  });

  it('reports a failed target to every fence until a later write succeeds', async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk unavailable'));
    await executionTraceStateStorage.setItem(EXECUTION_TRACE_STORE_KEY, 'value');

    const firstFence = flushExecutionTraceStorePersistenceNow();
    const secondFence = flushExecutionTraceStorePersistenceNow();
    await expect(firstFence).rejects.toThrow('disk unavailable');
    await expect(secondFence).rejects.toThrow('disk unavailable');

    (AsyncStorage.setItem as jest.Mock).mockResolvedValueOnce(undefined);
    await executionTraceStateStorage.setItem(EXECUTION_TRACE_STORE_KEY, 'newer-value');
    await expect(flushExecutionTraceStorePersistenceNow()).resolves.toBeUndefined();
  });

  it('reports a rejection without a reason as a failed target', async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(undefined);
    await executionTraceStateStorage.setItem(EXECUTION_TRACE_STORE_KEY, 'value');

    await expect(flushExecutionTraceStorePersistenceNow()).rejects.toBeUndefined();
  });

  it('does not read stale traces after the latest write failed', async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk unavailable'));
    await executionTraceStateStorage.setItem(EXECUTION_TRACE_STORE_KEY, 'new state');

    await expect(executionTraceStateStorage.getItem(EXECUTION_TRACE_STORE_KEY)).rejects.toThrow(
      'disk unavailable',
    );
    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
  });

  it('does not attribute a later concurrent failure to an earlier fence target', async () => {
    let releaseFirst!: () => void;
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    (AsyncStorage.setItem as jest.Mock)
      .mockImplementationOnce(() => firstWrite)
      .mockRejectedValueOnce(new Error('later write failed'));

    void executionTraceStateStorage.setItem(EXECUTION_TRACE_STORE_KEY, 'first');
    const firstFence = flushExecutionTraceStorePersistenceNow();
    void executionTraceStateStorage.setItem(EXECUTION_TRACE_STORE_KEY, 'second');
    const secondFence = flushExecutionTraceStorePersistenceNow();

    releaseFirst();
    await expect(firstFence).resolves.toBeUndefined();
    await expect(secondFence).rejects.toThrow('later write failed');
  });
});
