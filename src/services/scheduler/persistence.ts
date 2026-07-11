import AsyncStorage from '@react-native-async-storage/async-storage';
import type { StateStorage } from 'zustand/middleware';

export const SCHEDULER_STORE_KEY = 'kavi-scheduler';

let mutationTail: Promise<void> = Promise.resolve();
let latestMutationError: unknown;

function enqueueMutation(mutation: () => Promise<void>): Promise<void> {
  const running = mutationTail.then(async () => {
    try {
      await mutation();
    } catch (error) {
      latestMutationError = error;
    }
  });
  mutationTail = running;
  return running;
}

export const schedulerStateStorage: StateStorage = {
  getItem: async (key) => {
    await mutationTail;
    return AsyncStorage.getItem(key);
  },
  setItem: (key, value) => enqueueMutation(() => AsyncStorage.setItem(key, value)),
  removeItem: (key) => enqueueMutation(() => AsyncStorage.removeItem(key)),
};

export async function flushSchedulerStorePersistenceNow(): Promise<void> {
  while (true) {
    const observedTail = mutationTail;
    await observedTail;
    if (observedTail === mutationTail) break;
  }
  if (latestMutationError !== undefined) {
    const error = latestMutationError;
    latestMutationError = undefined;
    throw error;
  }
}

export function resetSchedulerPersistenceForTests(): void {
  mutationTail = Promise.resolve();
  latestMutationError = undefined;
}
