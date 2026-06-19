import { STORAGE_KEYS } from '../constants/storage';
import { flushPendingStorageWrites, schedulePendingStorageFlush } from './throttledStorage';

export const CHAT_STORE_CHECKPOINT_DELAY_MS = 750;

export function requestChatStorePersistenceCheckpoint(
  delayMs = CHAT_STORE_CHECKPOINT_DELAY_MS,
): void {
  schedulePendingStorageFlush(STORAGE_KEYS.CONVERSATIONS, delayMs);
}

export async function flushChatStorePersistenceNow(): Promise<void> {
  await flushPendingStorageWrites(STORAGE_KEYS.CONVERSATIONS);
}
