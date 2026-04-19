// ---------------------------------------------------------------------------
// Tests — Throttled File-Backed Storage
// ---------------------------------------------------------------------------

let mockStorageData: Record<string, string> = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockStorageData[key] ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockStorageData[key] = value;
  }),
  removeItem: jest.fn(async (key: string) => {
    delete mockStorageData[key];
  }),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { File } from 'expo-file-system';
import {
  createThrottledJSONStorage,
  throttledAsyncStorage,
  flushPendingStorageWrites,
  schedulePendingStorageFlush,
  _getPendingWriteCount,
  _resetThrottledStorageStateForTests,
  _getStorageFileUris,
} from '../../src/store/throttledStorage';

const expoFileSystemMock = jest.requireMock('expo-file-system') as {
  __resetStore: () => void;
  __getStore: () => Record<string, string | Uint8Array>;
};

function writePrimaryValue(key: string, value: string): void {
  const { primary } = _getStorageFileUris(key);
  new File(primary).write(value);
}

function writeBackupValue(key: string, value: string): void {
  const { backup } = _getStorageFileUris(key);
  new File(backup).write(value);
}

function readPrimaryValue(key: string): string | Uint8Array | undefined {
  const { primary } = _getStorageFileUris(key);
  return expoFileSystemMock.__getStore()[primary];
}

function readBackupValue(key: string): string | Uint8Array | undefined {
  const { backup } = _getStorageFileUris(key);
  return expoFileSystemMock.__getStore()[backup];
}

beforeEach(async () => {
  await flushPendingStorageWrites();
  _resetThrottledStorageStateForTests();
  jest.useFakeTimers();
  mockStorageData = {};
  expoFileSystemMock.__resetStore();
  (AsyncStorage.getItem as jest.Mock).mockClear();
  (AsyncStorage.setItem as jest.Mock).mockClear();
  (AsyncStorage.removeItem as jest.Mock).mockClear();
});

afterEach(async () => {
  await flushPendingStorageWrites();
  _resetThrottledStorageStateForTests();
  jest.useRealTimers();
});

describe('throttledAsyncStorage', () => {
  describe('getItem', () => {
    it('returns valid JSON from primary storage', async () => {
      writePrimaryValue('test-key', JSON.stringify({ hello: 'world' }));

      const result = await throttledAsyncStorage.getItem('test-key');
      expect(result).toBe(JSON.stringify({ hello: 'world' }));
    });

    it('returns null when key does not exist', async () => {
      const result = await throttledAsyncStorage.getItem('missing-key');
      expect(result).toBeNull();
    });

    it('falls back to backup when primary is corrupted', async () => {
      writePrimaryValue('test-key', '{invalid json!!!');
      writeBackupValue('test-key', JSON.stringify({ recovered: true }));

      const result = await throttledAsyncStorage.getItem('test-key');
      expect(result).toBe(JSON.stringify({ recovered: true }));
      expect(readPrimaryValue('test-key')).toBe(JSON.stringify({ recovered: true }));
    });

    it('migrates valid legacy AsyncStorage content into file-backed storage', async () => {
      mockStorageData['test-key'] = JSON.stringify({ migrated: true });

      const result = await throttledAsyncStorage.getItem('test-key');
      expect(result).toBe(JSON.stringify({ migrated: true }));
      expect(readPrimaryValue('test-key')).toBe(JSON.stringify({ migrated: true }));
      expect(AsyncStorage.removeItem).toHaveBeenCalledWith('test-key');
      expect(AsyncStorage.removeItem).toHaveBeenCalledWith('test-key__backup');
    });

    it('returns null when both primary and backup are corrupted', async () => {
      writePrimaryValue('test-key', '{broken');
      writeBackupValue('test-key', '{also broken');

      const result = await throttledAsyncStorage.getItem('test-key');
      expect(result).toBeNull();
    });

    it('returns null when primary is missing and backup is corrupted', async () => {
      writeBackupValue('test-key', 'not json');

      const result = await throttledAsyncStorage.getItem('test-key');
      expect(result).toBeNull();
    });
  });

  describe('setItem', () => {
    it('does not write immediately — schedules a throttled flush', async () => {
      await throttledAsyncStorage.setItem('k', JSON.stringify({ v: 1 }));

      expect(readPrimaryValue('k')).toBeUndefined();
      expect(_getPendingWriteCount()).toBe(1);
    });

    it('flushes after the throttle interval', async () => {
      await throttledAsyncStorage.setItem('k', JSON.stringify({ v: 1 }));

      jest.advanceTimersByTime(1500);
      await Promise.resolve(); // let microtasks settle
      await jest.advanceTimersByTimeAsync(0);

      expect(readPrimaryValue('k')).toBe(JSON.stringify({ v: 1 }));
    });

    it('coalesces rapid writes — only the latest value is persisted', async () => {
      await throttledAsyncStorage.setItem('k', JSON.stringify({ v: 1 }));
      await throttledAsyncStorage.setItem('k', JSON.stringify({ v: 2 }));
      await throttledAsyncStorage.setItem('k', JSON.stringify({ v: 3 }));

      jest.advanceTimersByTime(1500);
      await jest.advanceTimersByTimeAsync(0);

      expect(readPrimaryValue('k')).toBe(JSON.stringify({ v: 3 }));
    });

    it('does not flush early when rapid updates happen before the timer fires', async () => {
      await throttledAsyncStorage.setItem('k', JSON.stringify({ v: 1 }));
      await throttledAsyncStorage.setItem('k', JSON.stringify({ v: 2 }));

      expect(readPrimaryValue('k')).toBeUndefined();

      jest.advanceTimersByTime(1499);
      await jest.advanceTimersByTimeAsync(0);

      expect(readPrimaryValue('k')).toBeUndefined();

      jest.advanceTimersByTime(1);
      await jest.advanceTimersByTimeAsync(0);

      expect(readPrimaryValue('k')).toBe(JSON.stringify({ v: 2 }));
    });

    it('saves a backup of the previous value before writing primary', async () => {
      writePrimaryValue('k', JSON.stringify({ v: 'old' }));

      await throttledAsyncStorage.setItem('k', JSON.stringify({ v: 'new' }));
      jest.advanceTimersByTime(1500);
      await jest.advanceTimersByTimeAsync(0);

      expect(readBackupValue('k')).toBe(JSON.stringify({ v: 'old' }));
      expect(readPrimaryValue('k')).toBe(JSON.stringify({ v: 'new' }));
    });

    it('skips storing oversized backup snapshots', async () => {
      writePrimaryValue('k', JSON.stringify({ value: 'x'.repeat(300_000) }));

      await throttledAsyncStorage.setItem('k', JSON.stringify({ value: 'new' }));
      jest.advanceTimersByTime(1500);
      await jest.advanceTimersByTimeAsync(0);

      expect(readBackupValue('k')).toBeUndefined();
    });
  });

  describe('removeItem', () => {
    it('removes both primary and backup', async () => {
      writePrimaryValue('k', 'val');
      writeBackupValue('k', 'backup-val');

      await throttledAsyncStorage.removeItem('k');

      expect(readPrimaryValue('k')).toBeUndefined();
      expect(readBackupValue('k')).toBeUndefined();
      expect(AsyncStorage.removeItem).toHaveBeenCalledWith('k');
      expect(AsyncStorage.removeItem).toHaveBeenCalledWith('k__backup');
    });

    it('cancels any pending write for the key', async () => {
      await throttledAsyncStorage.setItem('k', JSON.stringify({ pending: true }));
      expect(_getPendingWriteCount()).toBe(1);

      await throttledAsyncStorage.removeItem('k');
      expect(_getPendingWriteCount()).toBe(0);

      // Advancing timers should not trigger a write
      jest.advanceTimersByTime(2000);
      await jest.advanceTimersByTimeAsync(0);

      expect(readPrimaryValue('k')).toBeUndefined();
    });
  });

  describe('flushPendingStorageWrites', () => {
    it('force-flushes a specific key', async () => {
      await throttledAsyncStorage.setItem('k1', JSON.stringify({ a: 1 }));
      await throttledAsyncStorage.setItem('k2', JSON.stringify({ b: 2 }));

      await flushPendingStorageWrites('k1');

      expect(readPrimaryValue('k1')).toBe(JSON.stringify({ a: 1 }));
      expect(readPrimaryValue('k2')).toBeUndefined();
    });

    it('force-flushes all pending writes when no key specified', async () => {
      await throttledAsyncStorage.setItem('k1', JSON.stringify({ a: 1 }));
      await throttledAsyncStorage.setItem('k2', JSON.stringify({ b: 2 }));

      await flushPendingStorageWrites();

      expect(readPrimaryValue('k1')).toBe(JSON.stringify({ a: 1 }));
      expect(readPrimaryValue('k2')).toBe(JSON.stringify({ b: 2 }));
      expect(_getPendingWriteCount()).toBe(0);
    });

    it('is a no-op when there are no pending writes', async () => {
      await flushPendingStorageWrites();
      expect(_getPendingWriteCount()).toBe(0);
    });
  });

  describe('schedulePendingStorageFlush', () => {
    it('expedites a queued write before the normal throttle window', async () => {
      await throttledAsyncStorage.setItem('k', JSON.stringify({ v: 1 }));

      schedulePendingStorageFlush('k', 100);

      jest.advanceTimersByTime(99);
      await jest.advanceTimersByTimeAsync(0);
      expect(readPrimaryValue('k')).toBeUndefined();

      jest.advanceTimersByTime(1);
      await jest.advanceTimersByTimeAsync(0);
      expect(readPrimaryValue('k')).toBe(JSON.stringify({ v: 1 }));
    });
  });
});

describe('createThrottledJSONStorage', () => {
  it('defers JSON serialization until the throttled flush', async () => {
    const jsonSpy = jest.spyOn(JSON, 'stringify');
    const storage = createThrottledJSONStorage<{ count: number }>();

    await storage.setItem('persisted', {
      state: { count: 1 },
      version: 4,
    });

    expect(jsonSpy).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1500);
    await jest.advanceTimersByTimeAsync(0);

    expect(jsonSpy).toHaveBeenCalledTimes(1);
    expect(readPrimaryValue('persisted')).toBe(
      JSON.stringify({
        state: { count: 1 },
        version: 4,
      }),
    );

    jsonSpy.mockRestore();
  });

  it('rehydrates parsed persisted state', async () => {
    const storage = createThrottledJSONStorage<{ count: number }>();
    writePrimaryValue(
      'persisted',
      JSON.stringify({
        state: { count: 2 },
        version: 4,
      }),
    );

    await expect(storage.getItem('persisted')).resolves.toEqual({
      state: { count: 2 },
      version: 4,
    });
  });
});
