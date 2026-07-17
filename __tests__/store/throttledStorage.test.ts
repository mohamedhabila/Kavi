// ---------------------------------------------------------------------------
// Tests — Throttled Checksummed File-Generation Storage
// ---------------------------------------------------------------------------

import { File } from 'expo-file-system';
import { sha256HexUtf8Async } from '../../src/utils/sha256Async';
import {
  _getPendingWriteCount,
  _getStorageFileUris,
  _resetThrottledStorageStateForTests,
  createThrottledJSONStorage,
  flushPendingStorageWrites,
  schedulePendingStorageFlush,
  throttledAsyncStorage,
} from '../../src/store/throttledStorage';
import {
  _setPersistedGenerationBoundaryHookForTests,
  type PersistedGenerationBoundaryEvent,
} from '../../src/store/persistedFileGenerations';

const expoFileSystemMock = jest.requireMock('expo-file-system') as {
  __resetStore: () => void;
  __getStore: () => Record<string, string | Uint8Array>;
};

interface TestEnvelope {
  format: 'kavi.persisted-file-generation';
  version: 2;
  generation: number;
  kind: 'value' | 'tombstone';
  checksum: string;
  payload: string | null;
}

function rawFile(uri: string): string | undefined {
  const value = expoFileSystemMock.__getStore()[uri];
  return typeof value === 'string' ? value : undefined;
}

function readEnvelope(uri: string): TestEnvelope | undefined {
  const raw = rawFile(uri);
  return raw ? (JSON.parse(raw) as TestEnvelope) : undefined;
}

function readSlotPayload(key: string, slot: 'primary' | 'backup' | 'temp'): string | undefined {
  const envelope = readEnvelope(_getStorageFileUris(key)[slot]);
  return envelope?.kind === 'value' ? (envelope.payload as string) : undefined;
}

async function persistImmediately(key: string, value: string): Promise<void> {
  await throttledAsyncStorage.setItem(key, value);
  await flushPendingStorageWrites(key);
}

async function buildEnvelope(
  generation: number,
  payload: string | null,
  kind: TestEnvelope['kind'] = 'value',
): Promise<string> {
  const checksum = await sha256HexUtf8Async(`${generation}\u0000${kind}\u0000${payload ?? ''}`);
  return JSON.stringify({
    format: 'kavi.persisted-file-generation',
    version: 2,
    generation,
    kind,
    checksum,
    payload,
  } satisfies TestEnvelope);
}

function simulateRestart(): void {
  _setPersistedGenerationBoundaryHookForTests(null);
  _resetThrottledStorageStateForTests();
}

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

function pauseNextTempValidation(key: string): {
  entered: Promise<void>;
  release: () => void;
  restore: () => void;
} {
  const entered = deferred<void>();
  const released = deferred<void>();
  const tempUri = _getStorageFileUris(key).temp;
  const originalText = File.prototype.text;
  let paused = false;
  const spy = jest.spyOn(File.prototype, 'text').mockImplementation(async function (this: File) {
    if (!paused && this.uri === tempUri) {
      paused = true;
      entered.resolve();
      await released.promise;
    }
    return originalText.call(this);
  });
  return {
    entered: entered.promise,
    release: () => released.resolve(),
    restore: () => spy.mockRestore(),
  };
}

beforeEach(() => {
  _setPersistedGenerationBoundaryHookForTests(null);
  _resetThrottledStorageStateForTests();
  expoFileSystemMock.__resetStore();
  jest.useFakeTimers();
});

afterEach(() => {
  _setPersistedGenerationBoundaryHookForTests(null);
  _resetThrottledStorageStateForTests();
  jest.useRealTimers();
});

describe('throttledAsyncStorage generations', () => {
  it('returns null on a clean startup', async () => {
    await expect(throttledAsyncStorage.getItem('missing-key')).resolves.toBeNull();
  });

  it('reads a clean primary generation after process restart', async () => {
    const value = JSON.stringify({ hello: 'world' });
    await persistImmediately('test-key', value);

    simulateRestart();

    await expect(throttledAsyncStorage.getItem('test-key')).resolves.toBe(value);
    expect(readEnvelope(_getStorageFileUris('test-key').primary)?.generation).toBe(1);
  });

  it('recovers the newest valid generation by generation number, not slot name', async () => {
    const oldValue = JSON.stringify({ value: 'old' });
    const newValue = JSON.stringify({ value: 'new' });
    await persistImmediately('k', oldValue);
    await persistImmediately('k', newValue);

    const { primary, backup } = _getStorageFileUris('k');
    const primaryRaw = rawFile(primary)!;
    const backupRaw = rawFile(backup)!;
    expoFileSystemMock.__getStore()[primary] = backupRaw;
    expoFileSystemMock.__getStore()[backup] = primaryRaw;

    simulateRestart();

    await expect(throttledAsyncStorage.getItem('k')).resolves.toBe(newValue);
    expect(readSlotPayload('k', 'primary')).toBe(newValue);
    expect(readSlotPayload('k', 'backup')).toBe(oldValue);
  });

  it('returns the newest validated generation when canonical startup repair fails', async () => {
    const oldValue = JSON.stringify({ value: 'old' });
    const newValue = JSON.stringify({ value: 'new' });
    await persistImmediately('k', oldValue);
    await persistImmediately('k', newValue);

    const { primary, backup } = _getStorageFileUris('k');
    const primaryRaw = rawFile(primary)!;
    expoFileSystemMock.__getStore()[primary] = rawFile(backup)!;
    expoFileSystemMock.__getStore()[backup] = primaryRaw;
    _resetThrottledStorageStateForTests();
    _setPersistedGenerationBoundaryHookForTests((event) => {
      if (event.boundary === 'temp_write' && event.phase === 'before') {
        throw new Error('injected:startup-repair');
      }
    });

    await expect(throttledAsyncStorage.getItem('k')).resolves.toBe(newValue);
  });

  it('recovers a valid backup when primary is corrupt', async () => {
    const oldValue = JSON.stringify({ value: 'old' });
    await persistImmediately('k', oldValue);
    await persistImmediately('k', JSON.stringify({ value: 'new' }));
    new File(_getStorageFileUris('k').primary).write('{truncated');

    simulateRestart();

    await expect(throttledAsyncStorage.getItem('k')).resolves.toBe(oldValue);
    expect(readSlotPayload('k', 'primary')).toBe(oldValue);
  });

  it('ignores and removes a corrupt stranded temp while retaining primary', async () => {
    const value = JSON.stringify({ value: 'current' });
    await persistImmediately('k', value);
    new File(_getStorageFileUris('k').temp).write('{partial');

    simulateRestart();

    await expect(throttledAsyncStorage.getItem('k')).resolves.toBe(value);
    expect(rawFile(_getStorageFileUris('k').temp)).toBeUndefined();
  });

  it('rejects unversioned raw JSON instead of applying a compatibility fallback', async () => {
    const value = JSON.stringify({ legacy: true });
    new File(_getStorageFileUris('k').primary).write(value);

    await expect(throttledAsyncStorage.getItem('k')).rejects.toThrow(
      'persist_generation_no_valid_state',
    );
  });

  it('fails closed and blocks overwrite on different valid payloads with the same generation', async () => {
    const { primary, backup } = _getStorageFileUris('k');
    const left = await buildEnvelope(7, JSON.stringify({ value: 'left' }));
    const right = await buildEnvelope(7, JSON.stringify({ value: 'right' }));
    new File(primary).write(left);
    new File(backup).write(right);

    await expect(throttledAsyncStorage.getItem('k')).rejects.toThrow(
      'persist_generation_collision',
    );
    await throttledAsyncStorage.setItem('k', JSON.stringify({ value: 'overwrite' }));
    await expect(flushPendingStorageWrites('k')).rejects.toThrow('persist_generation_collision');
    expect(rawFile(primary)).toBe(left);
    expect(rawFile(backup)).toBe(right);
  });

  it('propagates transient read errors and blocks writes until state is readable', async () => {
    const current = JSON.stringify({ value: 'current' });
    await persistImmediately('k', current);
    const primary = _getStorageFileUris('k').primary;
    const original = rawFile(primary);

    const readFailure = jest
      .spyOn(File.prototype, 'text')
      .mockRejectedValueOnce(new Error('transient read failure'));
    await expect(throttledAsyncStorage.getItem('k')).rejects.toThrow(
      'persist_generation_read_failed:primary',
    );
    readFailure.mockRestore();

    await throttledAsyncStorage.setItem('k', JSON.stringify({ value: 'replacement' }));
    const writeReadFailure = jest
      .spyOn(File.prototype, 'text')
      .mockRejectedValueOnce(new Error('transient read failure'));
    await expect(flushPendingStorageWrites('k')).rejects.toThrow(
      'persist_generation_read_failed:primary',
    );
    writeReadFailure.mockRestore();
    expect(rawFile(primary)).toBe(original);
  });

  it('distinguishes all-invalid existing files from an absent store and blocks overwrite', async () => {
    const files = _getStorageFileUris('k');
    new File(files.primary).write('{invalid-primary');
    new File(files.backup).write('{invalid-backup');

    await expect(throttledAsyncStorage.getItem('k')).rejects.toThrow(
      'persist_generation_no_valid_state',
    );
    await throttledAsyncStorage.setItem('k', JSON.stringify({ value: 'replacement' }));
    await expect(flushPendingStorageWrites('k')).rejects.toThrow(
      'persist_generation_no_valid_state',
    );
    expect(rawFile(files.primary)).toBe('{invalid-primary');
    expect(rawFile(files.backup)).toBe('{invalid-backup');
  });

  it('does not write immediately and flushes after the throttle interval', async () => {
    const value = JSON.stringify({ v: 1 });
    await throttledAsyncStorage.setItem('k', value);

    expect(readSlotPayload('k', 'primary')).toBeUndefined();
    expect(_getPendingWriteCount()).toBe(1);

    jest.advanceTimersByTime(1500);
    await jest.advanceTimersByTimeAsync(0);

    expect(readSlotPayload('k', 'primary')).toBe(value);
  });

  it('coalesces rapid writes into one newest generation', async () => {
    await throttledAsyncStorage.setItem('k', JSON.stringify({ v: 1 }));
    await throttledAsyncStorage.setItem('k', JSON.stringify({ v: 2 }));
    const newest = JSON.stringify({ v: 3 });
    await throttledAsyncStorage.setItem('k', newest);

    jest.advanceTimersByTime(1500);
    await jest.advanceTimersByTimeAsync(0);

    expect(readSlotPayload('k', 'primary')).toBe(newest);
    expect(readEnvelope(_getStorageFileUris('k').primary)?.generation).toBe(1);
  });

  it('serializes overlapping flushes for the same key without generation collisions', async () => {
    const first = JSON.stringify({ value: 'first' });
    const second = JSON.stringify({ value: 'second' });
    await throttledAsyncStorage.setItem('k', first);
    const firstFlush = flushPendingStorageWrites('k');
    await throttledAsyncStorage.setItem('k', second);
    const secondFlush = flushPendingStorageWrites('k');

    await Promise.all([firstFlush, secondFlush]);

    expect(readSlotPayload('k', 'primary')).toBe(second);
    expect(readSlotPayload('k', 'backup')).toBe(first);
    expect(readEnvelope(_getStorageFileUris('k').primary)?.generation).toBe(2);
  });

  it('waits for a timer-started commit before resolving an explicit flush barrier', async () => {
    const value = JSON.stringify({ value: 'durable-before-journal-activation' });
    const pause = pauseNextTempValidation('k');
    await throttledAsyncStorage.setItem('k', value);

    jest.advanceTimersByTime(1500);
    await pause.entered;

    let barrierResolved = false;
    const barrier = flushPendingStorageWrites('k').then(() => {
      barrierResolved = true;
    });
    await Promise.resolve();
    expect(barrierResolved).toBe(false);

    pause.release();
    await barrier;
    pause.restore();
    expect(readSlotPayload('k', 'primary')).toBe(value);
  });

  it('retains the prior generation even when both payloads exceed 256 KiB', async () => {
    const oldValue = JSON.stringify({ value: 'o'.repeat(300_000) });
    const newValue = JSON.stringify({ value: 'n'.repeat(300_000) });

    await persistImmediately('k', oldValue);
    await persistImmediately('k', newValue);

    expect(readSlotPayload('k', 'primary')).toBe(newValue);
    expect(readSlotPayload('k', 'backup')).toBe(oldValue);
    expect(rawFile(_getStorageFileUris('k').backup)!.length).toBeGreaterThan(256_000);

    simulateRestart();
    await expect(throttledAsyncStorage.getItem('k')).resolves.toBe(newValue);
  });

  it('does not create another generation for an unchanged payload', async () => {
    const value = JSON.stringify({ stable: true });
    await persistImmediately('k', value);
    await persistImmediately('k', value);

    expect(readEnvelope(_getStorageFileUris('k').primary)?.generation).toBe(1);
    expect(readSlotPayload('k', 'backup')).toBeUndefined();
  });
});

describe('operation-boundary recovery', () => {
  const cases: Array<{
    boundary: PersistedGenerationBoundaryEvent['boundary'];
    phase: PersistedGenerationBoundaryEvent['phase'];
    expected: 'old' | 'new';
  }> = [
    { boundary: 'temp_write', phase: 'before', expected: 'old' },
    { boundary: 'temp_write', phase: 'after', expected: 'new' },
    { boundary: 'current_to_backup_move', phase: 'before', expected: 'new' },
    { boundary: 'current_to_backup_move', phase: 'after', expected: 'new' },
    { boundary: 'temp_to_primary_move', phase: 'before', expected: 'new' },
    { boundary: 'temp_to_primary_move', phase: 'after', expected: 'new' },
  ];

  it.each(cases)(
    'recovers after $phase failure at $boundary',
    async ({ boundary, phase, expected }) => {
      const oldValue = JSON.stringify({ value: 'old' });
      const newValue = JSON.stringify({ value: 'new' });
      await persistImmediately('k', oldValue);

      _setPersistedGenerationBoundaryHookForTests((event) => {
        if (event.boundary === boundary && event.phase === phase) {
          throw new Error(`injected:${boundary}:${phase}`);
        }
      });

      await throttledAsyncStorage.setItem('k', newValue);
      await expect(flushPendingStorageWrites('k')).rejects.toThrow(`injected:${boundary}:${phase}`);

      simulateRestart();
      const expectedValue = expected === 'new' ? newValue : oldValue;
      await expect(throttledAsyncStorage.getItem('k')).resolves.toBe(expectedValue);
      expect(readSlotPayload('k', 'primary')).toBe(expectedValue);
      if (expected === 'new') {
        expect(readSlotPayload('k', 'backup')).toBe(oldValue);
      }
    },
  );
});

describe('tombstone removal recovery', () => {
  const cases: Array<{
    boundary: PersistedGenerationBoundaryEvent['boundary'];
    phase: PersistedGenerationBoundaryEvent['phase'];
    deletionBegan: boolean;
  }> = [
    { boundary: 'temp_write', phase: 'before', deletionBegan: false },
    { boundary: 'temp_write', phase: 'after', deletionBegan: true },
    { boundary: 'current_to_backup_move', phase: 'before', deletionBegan: true },
    { boundary: 'current_to_backup_move', phase: 'after', deletionBegan: true },
    { boundary: 'temp_to_primary_move', phase: 'before', deletionBegan: true },
    { boundary: 'temp_to_primary_move', phase: 'after', deletionBegan: true },
    { boundary: 'tombstone_backup_delete', phase: 'before', deletionBegan: true },
    { boundary: 'tombstone_backup_delete', phase: 'after', deletionBegan: true },
  ];

  it.each(cases)(
    'recovers deletion after $phase failure at $boundary',
    async ({ boundary, phase, deletionBegan }) => {
      const oldValue = JSON.stringify({ value: 'private' });
      await persistImmediately('k', oldValue);
      _setPersistedGenerationBoundaryHookForTests((event) => {
        if (event.boundary === boundary && event.phase === phase) {
          throw new Error(`injected:remove:${boundary}:${phase}`);
        }
      });

      await expect(throttledAsyncStorage.removeItem('k')).rejects.toThrow(
        `injected:remove:${boundary}:${phase}`,
      );

      simulateRestart();
      if (!deletionBegan) {
        // No filesystem operation accepted the tombstone, so removeItem
        // truthfully failed before a durable deletion intent existed.
        await expect(throttledAsyncStorage.getItem('k')).resolves.toBe(oldValue);
        return;
      }
      await expect(throttledAsyncStorage.getItem('k')).resolves.toBeNull();
      expect(readEnvelope(_getStorageFileUris('k').primary)?.kind).toBe('tombstone');
      expect(rawFile(_getStorageFileUris('k').backup)).toBeUndefined();
    },
  );

  it('keeps a newer tombstone authoritative over stale valid temp and backup payloads', async () => {
    const value = JSON.stringify({ value: 'private' });
    await persistImmediately('k', value);
    const files = _getStorageFileUris('k');
    const staleValueGeneration = rawFile(files.primary)!;
    await throttledAsyncStorage.removeItem('k');
    expoFileSystemMock.__getStore()[files.backup] = staleValueGeneration;
    expoFileSystemMock.__getStore()[files.temp] = staleValueGeneration;

    simulateRestart();

    await expect(throttledAsyncStorage.getItem('k')).resolves.toBeNull();
    expect(readEnvelope(files.primary)?.kind).toBe('tombstone');
    expect(rawFile(files.backup)).toBeUndefined();
    expect(rawFile(files.temp)).toBeUndefined();
  });

  it('allows a later explicit write only as a newer generation than the tombstone', async () => {
    await persistImmediately('k', JSON.stringify({ value: 'old' }));
    await throttledAsyncStorage.removeItem('k');
    const replacement = JSON.stringify({ value: 'replacement' });

    await persistImmediately('k', replacement);

    expect(readEnvelope(_getStorageFileUris('k').primary)).toEqual(
      expect.objectContaining({ generation: 3, kind: 'value', payload: replacement }),
    );
    expect(readEnvelope(_getStorageFileUris('k').backup)?.kind).toBe('tombstone');
    simulateRestart();
    await expect(throttledAsyncStorage.getItem('k')).resolves.toBe(replacement);
  });

  it('deletes a payload larger than 300 KiB without retaining it as readable state', async () => {
    const largeValue = JSON.stringify({ value: 'private'.repeat(50_000) });
    expect(largeValue.length).toBeGreaterThan(300_000);
    await persistImmediately('k', largeValue);

    await throttledAsyncStorage.removeItem('k');

    const files = _getStorageFileUris('k');
    expect(readEnvelope(files.primary)?.kind).toBe('tombstone');
    expect(rawFile(files.backup)).toBeUndefined();
    simulateRestart();
    await expect(throttledAsyncStorage.getItem('k')).resolves.toBeNull();
  });
});

describe('throttled storage control', () => {
  it('commits an authoritative tombstone before cleaning prior payload generations', async () => {
    await persistImmediately('k', JSON.stringify({ value: 'old' }));
    await persistImmediately('k', JSON.stringify({ value: 'new' }));
    const files = _getStorageFileUris('k');
    new File(files.temp).write('{partial');

    await throttledAsyncStorage.removeItem('k');

    expect(readEnvelope(files.primary)).toEqual(
      expect.objectContaining({ generation: 3, kind: 'tombstone', payload: null }),
    );
    expect(rawFile(files.backup)).toBeUndefined();
    expect(rawFile(files.temp)).toBeUndefined();
    simulateRestart();
    await expect(throttledAsyncStorage.getItem('k')).resolves.toBeNull();
  });

  it('cancels a pending write when removing a key', async () => {
    await throttledAsyncStorage.setItem('k', JSON.stringify({ pending: true }));
    await throttledAsyncStorage.removeItem('k');

    jest.advanceTimersByTime(2000);
    await jest.advanceTimersByTimeAsync(0);

    expect(_getPendingWriteCount()).toBe(0);
    expect(readEnvelope(_getStorageFileUris('k').primary)?.kind).toBe('tombstone');
    await expect(throttledAsyncStorage.getItem('k')).resolves.toBeNull();
  });

  it('orders removal after an in-flight flush so committed data cannot reappear', async () => {
    await throttledAsyncStorage.setItem('k', JSON.stringify({ pending: true }));
    const inFlightFlush = flushPendingStorageWrites('k');
    const removal = throttledAsyncStorage.removeItem('k');

    await Promise.all([inFlightFlush, removal]);

    const files = _getStorageFileUris('k');
    expect(readEnvelope(files.primary)?.kind).toBe('tombstone');
    expect(rawFile(files.backup)).toBeUndefined();
    expect(rawFile(files.temp)).toBeUndefined();
    await expect(throttledAsyncStorage.getItem('k')).resolves.toBeNull();
  });

  it('orders a tombstone after a timer-started commit before removal resolves', async () => {
    await persistImmediately('k', JSON.stringify({ value: 'old' }));
    const pause = pauseNextTempValidation('k');
    await throttledAsyncStorage.setItem('k', JSON.stringify({ value: 'in-flight' }));
    jest.advanceTimersByTime(1500);
    await pause.entered;

    let removalResolved = false;
    const removal = throttledAsyncStorage.removeItem('k').then(() => {
      removalResolved = true;
    });
    await Promise.resolve();
    expect(removalResolved).toBe(false);

    pause.release();
    await removal;
    pause.restore();
    expect(readEnvelope(_getStorageFileUris('k').primary)?.kind).toBe('tombstone');
    await expect(throttledAsyncStorage.getItem('k')).resolves.toBeNull();
  });

  it('force-flushes only the requested key', async () => {
    const first = JSON.stringify({ a: 1 });
    await throttledAsyncStorage.setItem('k1', first);
    await throttledAsyncStorage.setItem('k2', JSON.stringify({ b: 2 }));

    await flushPendingStorageWrites('k1');

    expect(readSlotPayload('k1', 'primary')).toBe(first);
    expect(readSlotPayload('k2', 'primary')).toBeUndefined();
  });

  it('force-flushes every pending key', async () => {
    await throttledAsyncStorage.setItem('k1', JSON.stringify({ a: 1 }));
    await throttledAsyncStorage.setItem('k2', JSON.stringify({ b: 2 }));

    await flushPendingStorageWrites();

    expect(readSlotPayload('k1', 'primary')).toBe(JSON.stringify({ a: 1 }));
    expect(readSlotPayload('k2', 'primary')).toBe(JSON.stringify({ b: 2 }));
    expect(_getPendingWriteCount()).toBe(0);
  });

  it('expedites a queued write before the normal throttle window', async () => {
    const value = JSON.stringify({ v: 1 });
    await throttledAsyncStorage.setItem('k', value);
    schedulePendingStorageFlush('k', 100);

    jest.advanceTimersByTime(99);
    await jest.advanceTimersByTimeAsync(0);
    expect(readSlotPayload('k', 'primary')).toBeUndefined();

    jest.advanceTimersByTime(1);
    await jest.advanceTimersByTimeAsync(0);
    expect(readSlotPayload('k', 'primary')).toBe(value);
  });
});

describe('createThrottledJSONStorage', () => {
  it('defers JSON serialization until the throttled flush', async () => {
    const jsonSpy = jest.spyOn(JSON, 'stringify');
    const storage = createThrottledJSONStorage<{ count: number }>();
    const storedValue = { state: { count: 1 }, version: 4 };

    await storage.setItem('persisted', storedValue);
    expect(jsonSpy).not.toHaveBeenCalled();

    await flushPendingStorageWrites('persisted');

    expect(jsonSpy).toHaveBeenCalledWith(storedValue);
    expect(readSlotPayload('persisted', 'primary')).toBe(JSON.stringify(storedValue));
    jsonSpy.mockRestore();
  });

  it('rehydrates parsed persisted state after restart', async () => {
    const storage = createThrottledJSONStorage<{ count: number }>();
    await storage.setItem('persisted', { state: { count: 2 }, version: 4 });
    await flushPendingStorageWrites('persisted');

    simulateRestart();

    await expect(storage.getItem('persisted')).resolves.toEqual({
      state: { count: 2 },
      version: 4,
    });
  });
});
