import { unrefTimerIfSupported } from '../utils/timers';

export type PersistHydratableStore = {
  persist?: {
    hasHydrated?: () => boolean;
    onFinishHydration?: (listener: () => void) => () => void;
    rehydrate?: () => Promise<void> | void;
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
  timeoutMs: number | null = 3000,
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
    if (timeoutMs !== null) {
      timer = setTimeout(finish, timeoutMs);
      unrefTimerIfSupported(timer);
    }
  });
}

export async function waitForRequiredStoreHydration(
  store: PersistHydratableStore,
  options: { name: string; timeoutMs: number },
): Promise<void> {
  await waitForStoreHydration(store, options.timeoutMs);
  if (isStoreHydrated(store)) return;

  try {
    const rehydrate = store.persist?.rehydrate;
    if (rehydrate) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`rehydration timed out after ${options.timeoutMs}ms`)),
          options.timeoutMs,
        );
        unrefTimerIfSupported(timer);
        Promise.resolve()
          .then(() => rehydrate())
          .then(
            () => {
              clearTimeout(timer);
              resolve();
            },
            (error) => {
              clearTimeout(timer);
              reject(error);
            },
          );
      });
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to hydrate ${options.name}: ${detail}`);
  }
  await waitForStoreHydration(store, options.timeoutMs);
  if (!isStoreHydrated(store)) {
    throw new Error(`${options.name} did not hydrate within ${options.timeoutMs * 2}ms.`);
  }
}
