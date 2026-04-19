import { unrefTimerIfSupported } from '../utils/timers';

export type PersistHydratableStore = {
  persist?: {
    hasHydrated?: () => boolean;
    onFinishHydration?: (listener: () => void) => () => void;
  };
};

export function isStoreHydrated(store: PersistHydratableStore): boolean {
  const persistApi = store.persist;
  if (!persistApi?.hasHydrated) {
    return true;
  }

  return persistApi.hasHydrated();
}

export function subscribeToStoreHydration(
  store: PersistHydratableStore,
  listener: () => void,
): () => void {
  if (isStoreHydrated(store)) {
    listener();
    return () => {};
  }

  return store.persist?.onFinishHydration?.(listener) ?? (() => {});
}

export async function waitForStoreHydration(
  store: PersistHydratableStore,
  timeoutMs = 3000,
): Promise<void> {
  if (isStoreHydrated(store)) {
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    let unsubscribe: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = () => {
      if (settled) {
        return;
      }

      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      unsubscribe?.();
      resolve();
    };

    unsubscribe = subscribeToStoreHydration(store, finish);
    timer = setTimeout(finish, timeoutMs);
    unrefTimerIfSupported(timer);
  });
}
