// ---------------------------------------------------------------------------
// Kavi — Throttled File-Backed Persist Storage
// ---------------------------------------------------------------------------
// The persisted conversation store is large enough that AsyncStorage's SQLite
// backend becomes a liability on long agentic runs. Keep the same throttling
// and backup semantics, but store the serialized state in app files instead.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import type { PersistStorage, StateStorage, StorageValue } from 'zustand/middleware';
import { unrefTimerIfSupported } from '../utils/timers';

const WRITE_THROTTLE_MS = 1500;
const BACKUP_SUFFIX = '__backup';
const FILE_EXTENSION = '.json';
const PERSIST_DIRECTORY_NAME = 'persist-state';
const MAX_BACKUP_VALUE_CHARS = 256_000;

type PendingSerializedValue = string | (() => string);

interface PendingWrite {
  value: PendingSerializedValue;
  timer: ReturnType<typeof setTimeout>;
}

const pendingWrites = new Map<string, PendingWrite>();
const scheduledFlushes = new Map<string, ReturnType<typeof setTimeout>>();
const lastKnownValues = new Map<string, string | null>();
let persistDirectory: Directory | null = null;

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

async function readFileText(file: File): Promise<string | null> {
  if (!file.exists) {
    return null;
  }

  try {
    return await file.text();
  } catch {
    return null;
  }
}

function writeFileText(file: File, value: string): void {
  file.write(value);
}

function deleteFileIfExists(file: File): void {
  if (!file.exists) {
    return;
  }

  try {
    file.delete();
  } catch {
    // Best-effort cleanup.
  }
}

async function readLegacyValue(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

async function clearLegacyKeys(key: string): Promise<void> {
  try {
    await Promise.all([
      AsyncStorage.removeItem(key),
      AsyncStorage.removeItem(`${key}${BACKUP_SUFFIX}`),
    ]);
  } catch {
    // Best-effort cleanup.
  }
}

function isValidJson(value: string | null): value is string {
  if (!value) return false;
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

function queueWrite(key: string, value: PendingSerializedValue): void {
  const existing = pendingWrites.get(key);
  if (existing) {
    existing.value = value;
    return;
  }

  const pending: PendingWrite = {
    value,
    timer: setTimeout(() => {
      void flushWrite(key).catch((error: unknown) => {
        console.warn('[storage] Failed to flush persisted state:', error);
      });
    }, WRITE_THROTTLE_MS),
  };
  unrefTimerIfSupported(pending.timer);
  pendingWrites.set(key, pending);
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

function shouldWriteBackup(currentPrimary: string | null, nextValue: string): boolean {
  if (!currentPrimary || !isValidJson(currentPrimary)) {
    return false;
  }

  return (
    currentPrimary.length <= MAX_BACKUP_VALUE_CHARS && nextValue.length <= MAX_BACKUP_VALUE_CHARS
  );
}

export const throttledAsyncStorage: StateStorage = {
  async getItem(key: string): Promise<string | null> {
    const primaryFile = getPrimaryFile(key);
    const backupFile = getBackupFile(key);

    let primary = await readFileText(primaryFile);
    let primarySource: 'file' | 'legacy' = 'file';

    if (!primary) {
      primary = await readLegacyValue(key);
      primarySource = 'legacy';
    }

    if (isValidJson(primary)) {
      lastKnownValues.set(key, primary);
      if (primarySource === 'legacy') {
        writeFileText(primaryFile, primary);
        await clearLegacyKeys(key);
      }
      return primary;
    }

    let backup = await readFileText(backupFile);
    let backupSource: 'file' | 'legacy' = 'file';

    if (!backup) {
      backup = await readLegacyValue(`${key}${BACKUP_SUFFIX}`);
      backupSource = 'legacy';
    }

    if (isValidJson(backup)) {
      lastKnownValues.set(key, backup);
      try {
        writeFileText(primaryFile, backup);
        if (backupSource === 'legacy') {
          await clearLegacyKeys(key);
        }
      } catch {
        // Best-effort restore.
      }
      return backup;
    }

    lastKnownValues.delete(key);

    return null;
  },

  async setItem(key: string, value: string): Promise<void> {
    queueWrite(key, value);
  },

  async removeItem(key: string): Promise<void> {
    const existing = pendingWrites.get(key);
    if (existing) {
      clearTimeout(existing.timer);
      pendingWrites.delete(key);
    }

    clearScheduledFlush(key);
    lastKnownValues.delete(key);

    deleteFileIfExists(getPrimaryFile(key));
    deleteFileIfExists(getBackupFile(key));
    await clearLegacyKeys(key);
  },
};

async function flushWrite(key: string): Promise<void> {
  const pending = pendingWrites.get(key);
  if (!pending) return;

  const serializedValue = resolvePendingValue(pending.value);
  pendingWrites.delete(key);

  const primaryFile = getPrimaryFile(key);
  const backupFile = getBackupFile(key);
  const currentPrimary = lastKnownValues.has(key)
    ? (lastKnownValues.get(key) ?? null)
    : ((await readFileText(primaryFile)) ?? (await readLegacyValue(key)));

  if (currentPrimary === serializedValue) {
    lastKnownValues.set(key, serializedValue);
    await clearLegacyKeys(key);
    return;
  }

  if (shouldWriteBackup(currentPrimary, serializedValue)) {
    try {
      writeFileText(backupFile, currentPrimary as string);
    } catch {
      // Best-effort backup — don't block the primary write.
    }
  } else {
    deleteFileIfExists(backupFile);
  }

  writeFileText(primaryFile, serializedValue);
  lastKnownValues.set(key, serializedValue);
  await clearLegacyKeys(key);
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
    const pending = pendingWrites.get(key);
    if (pending) {
      clearTimeout(pending.timer);
      await flushWrite(key);
    }
    return;
  }

  for (const scheduledKey of Array.from(scheduledFlushes.keys())) {
    clearScheduledFlush(scheduledKey);
  }

  const keys = Array.from(pendingWrites.keys());
  for (const pendingKey of keys) {
    const pending = pendingWrites.get(pendingKey);
    if (pending) {
      clearTimeout(pending.timer);
    }
  }
  await Promise.all(keys.map((pendingKey) => flushWrite(pendingKey)));
}

/** Visible for testing only. */
export function _getPendingWriteCount(): number {
  return pendingWrites.size;
}

/** Visible for testing only. */
export function _resetThrottledStorageStateForTests(): void {
  for (const pending of pendingWrites.values()) {
    clearTimeout(pending.timer);
  }
  pendingWrites.clear();

  for (const timer of scheduledFlushes.values()) {
    clearTimeout(timer);
  }
  scheduledFlushes.clear();

  lastKnownValues.clear();
  persistDirectory = null;
}

/** Visible for testing only. */
export function _getStorageFileUris(key: string): { primary: string; backup: string } {
  return {
    primary: getPrimaryFile(key).uri,
    backup: getBackupFile(key).uri,
  };
}
