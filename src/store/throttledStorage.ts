// ---------------------------------------------------------------------------
// Kavi — Throttled File-Backed Persist Storage
// ---------------------------------------------------------------------------
// The persisted conversation store is large enough that AsyncStorage's SQLite
// backend becomes a liability on long agentic runs. Keep throttling separate
// from the checksummed file-generation transaction used for durable writes.

import { Directory, File, Paths } from 'expo-file-system';
import type { PersistStorage, StateStorage, StorageValue } from 'zustand/middleware';
import { unrefTimerIfSupported } from '../utils/timers';
import {
  commitPersistedGeneration,
  commitPersistedTombstone,
  readLatestPersistedGeneration,
  type PersistedGenerationFileUris,
} from './persistedFileGenerations';

const WRITE_THROTTLE_MS = 1500;
const BACKUP_SUFFIX = '__backup';
const TEMP_SUFFIX = '__temp';
const FILE_EXTENSION = '.json';
const PERSIST_DIRECTORY_NAME = 'persist-state';

type PendingSerializedValue = string | (() => string);

interface PendingWrite {
  value: PendingSerializedValue;
  timer: ReturnType<typeof setTimeout> | null;
  revision: number;
  flushingRevision: number | null;
}

const pendingWrites = new Map<string, PendingWrite>();
const scheduledFlushes = new Map<string, ReturnType<typeof setTimeout>>();
const inFlightMutations = new Map<string, Promise<void>>();
let persistDirectory: Directory | null = null;
let nextWriteRevision = 1;

function getPersistDirectory(): Directory {
  if (!persistDirectory) {
    persistDirectory = new Directory(Paths.document, PERSIST_DIRECTORY_NAME);
    persistDirectory.create({ idempotent: true, intermediates: true });
  }

  return persistDirectory;
}

function getSafeFileKey(key: string): string {
  return encodeURIComponent(key);
}

function getPrimaryFile(key: string): File {
  return new File(getPersistDirectory(), `${getSafeFileKey(key)}${FILE_EXTENSION}`);
}

function getBackupFile(key: string): File {
  return new File(getPersistDirectory(), `${getSafeFileKey(key)}${BACKUP_SUFFIX}${FILE_EXTENSION}`);
}

function getTempFile(key: string): File {
  return new File(getPersistDirectory(), `${getSafeFileKey(key)}${TEMP_SUFFIX}${FILE_EXTENSION}`);
}

function getGenerationFileUris(key: string): PersistedGenerationFileUris {
  return {
    primary: getPrimaryFile(key).uri,
    backup: getBackupFile(key).uri,
    temp: getTempFile(key).uri,
  };
}

function scheduleWriteTimer(key: string, pending: PendingWrite): void {
  if (pending.timer !== null) return;
  pending.timer = setTimeout(() => {
    if (pendingWrites.get(key) === pending) {
      pending.timer = null;
    }
    void flushWrite(key).catch((error: unknown) => {
      console.warn('[storage] Failed to flush persisted state:', error);
    });
  }, WRITE_THROTTLE_MS);
  unrefTimerIfSupported(pending.timer);
}

function queueWrite(key: string, value: PendingSerializedValue): void {
  let pending = pendingWrites.get(key);
  if (pending) {
    pending.value = value;
    pending.revision = nextWriteRevision++;
  } else {
    pending = {
      value,
      timer: null,
      revision: nextWriteRevision++,
      flushingRevision: null,
    };
    pendingWrites.set(key, pending);
  }
  scheduleWriteTimer(key, pending);
}

function clearScheduledFlush(key: string): void {
  const timer = scheduledFlushes.get(key);
  if (!timer) {
    return;
  }

  clearTimeout(timer);
  scheduledFlushes.delete(key);
}

function resolvePendingValue(value: PendingSerializedValue): string {
  return typeof value === 'function' ? value() : value;
}

export const throttledAsyncStorage: StateStorage = {
  async getItem(key: string): Promise<string | null> {
    const latest = await readLatestPersistedGeneration(getGenerationFileUris(key));
    if (latest?.kind === 'value') {
      return latest.payload;
    }
    if (latest?.kind === 'tombstone') {
      return null;
    }

    return null;
  },

  async setItem(key: string, value: string): Promise<void> {
    queueWrite(key, value);
  },

  async removeItem(key: string): Promise<void> {
    const existing = pendingWrites.get(key);
    if (existing) {
      if (existing.timer !== null) clearTimeout(existing.timer);
      pendingWrites.delete(key);
    }

    clearScheduledFlush(key);
    await enqueueStorageMutation(key, async () => {
      await commitPersistedTombstone(getGenerationFileUris(key));
    });
  },
};

function enqueueStorageMutation(key: string, mutation: () => Promise<void>): Promise<void> {
  const predecessor = inFlightMutations.get(key) ?? Promise.resolve();
  const running = predecessor.catch(() => undefined).then(mutation);
  inFlightMutations.set(key, running);
  const release = () => {
    if (inFlightMutations.get(key) === running) inFlightMutations.delete(key);
  };
  void running.then(release, release);
  return running;
}

async function flushWrite(key: string): Promise<void> {
  const pending = pendingWrites.get(key);
  if (!pending) {
    await inFlightMutations.get(key);
    return;
  }
  if (pending.flushingRevision === pending.revision) {
    await inFlightMutations.get(key);
    return;
  }

  if (pending.timer !== null) clearTimeout(pending.timer);
  pending.timer = null;
  const revision = pending.revision;
  const value = pending.value;
  pending.flushingRevision = revision;
  try {
    await enqueueStorageMutation(key, async () => {
      const serializedValue = resolvePendingValue(value);
      await commitPersistedGeneration(getGenerationFileUris(key), serializedValue);
    });
    if (pendingWrites.get(key) === pending && pending.revision === revision) {
      pendingWrites.delete(key);
    }
  } catch (error) {
    if (pendingWrites.get(key) === pending && pending.revision === revision) {
      scheduleWriteTimer(key, pending);
    }
    throw error;
  } finally {
    if (pending.flushingRevision === revision) pending.flushingRevision = null;
  }
}

async function drainStorageKey(key: string): Promise<void> {
  while (pendingWrites.has(key) || inFlightMutations.has(key)) {
    const pending = pendingWrites.get(key);
    if (pending?.timer !== null && pending?.timer !== undefined) {
      clearTimeout(pending.timer);
      pending.timer = null;
    }
    await flushWrite(key);
  }
}

export function createThrottledJSONStorage<T>(): PersistStorage<T> {
  return {
    async getItem(key: string): Promise<StorageValue<T> | null> {
      const serialized = await throttledAsyncStorage.getItem(key);
      if (!serialized) {
        return null;
      }

      return JSON.parse(serialized) as StorageValue<T>;
    },

    async setItem(key: string, value: StorageValue<T>): Promise<void> {
      queueWrite(key, () => JSON.stringify(value));
    },

    async removeItem(key: string): Promise<void> {
      await throttledAsyncStorage.removeItem(key);
    },
  };
}

export function schedulePendingStorageFlush(key: string, delayMs = 0): void {
  clearScheduledFlush(key);

  const runFlush = () => {
    clearScheduledFlush(key);
    void flushPendingStorageWrites(key).catch((error: unknown) => {
      console.warn('[storage] Failed to expedite persisted state flush:', error);
    });
  };

  if (delayMs <= 0) {
    runFlush();
    return;
  }

  const timer = setTimeout(runFlush, delayMs);
  unrefTimerIfSupported(timer);
  scheduledFlushes.set(key, timer);
}

/**
 * Force-flush any pending throttled writes for the given key.
 * Used during app backgrounding or explicit save points.
 */
export async function flushPendingStorageWrites(key?: string): Promise<void> {
  if (key) {
    clearScheduledFlush(key);
    await drainStorageKey(key);
    return;
  }

  for (const scheduledKey of Array.from(scheduledFlushes.keys())) {
    clearScheduledFlush(scheduledKey);
  }

  while (pendingWrites.size > 0 || inFlightMutations.size > 0) {
    const keys = Array.from(new Set([...pendingWrites.keys(), ...inFlightMutations.keys()]));
    await Promise.all(keys.map((pendingKey) => drainStorageKey(pendingKey)));
  }
}

/** Visible for testing only. */
export function _getPendingWriteCount(): number {
  return pendingWrites.size;
}

/** Visible for testing only. */
export function _resetThrottledStorageStateForTests(): void {
  for (const pending of pendingWrites.values()) {
    if (pending.timer !== null) clearTimeout(pending.timer);
  }
  pendingWrites.clear();

  for (const timer of scheduledFlushes.values()) {
    clearTimeout(timer);
  }
  scheduledFlushes.clear();
  inFlightMutations.clear();
  nextWriteRevision = 1;

  persistDirectory = null;
}

/** Visible for testing only. */
export function _getStorageFileUris(key: string): PersistedGenerationFileUris {
  return getGenerationFileUris(key);
}
