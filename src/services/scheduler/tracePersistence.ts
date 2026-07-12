import AsyncStorage from '@react-native-async-storage/async-storage';
import type { StateStorage } from 'zustand/middleware';

export const EXECUTION_TRACE_STORE_KEY = 'kavi-execution-traces';

type MutationOutcome = { ok: true } | { ok: false; error: unknown };

let mutationTail: Promise<MutationOutcome> = Promise.resolve({ ok: true });

function enqueueMutation(mutation: () => Promise<void>): Promise<void> {
  const running = mutationTail.then(async () => {
    try {
      await mutation();
      return { ok: true } as const;
    } catch (error) {
      return { ok: false, error } as const;
    }
  });
  mutationTail = running;
  return running.then(() => undefined);
}

export const executionTraceStateStorage: StateStorage = {
  getItem: async (key) => {
    const outcome = await mutationTail;
    if (!outcome.ok) throw outcome.error;
    return AsyncStorage.getItem(key);
  },
  setItem: (key, value) => enqueueMutation(() => AsyncStorage.setItem(key, value)),
  removeItem: (key) => enqueueMutation(() => AsyncStorage.removeItem(key)),
};

export async function flushExecutionTraceStorePersistenceNow(): Promise<void> {
  const targetMutation = mutationTail;
  const outcome = await targetMutation;
  if (!outcome.ok) throw outcome.error;
}

export function resetExecutionTracePersistenceForTests(): void {
  mutationTail = Promise.resolve({ ok: true });
}
