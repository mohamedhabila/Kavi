type AbortSignalWithTimeout = typeof AbortSignal & {
  timeout?: (ms: number) => AbortSignal;
};

export function createTimeoutSignal(ms: number): AbortSignal {
  const abortSignalCtor = globalThis.AbortSignal as AbortSignalWithTimeout | undefined;
  if (abortSignalCtor && typeof abortSignalCtor.timeout === 'function') {
    return abortSignalCtor.timeout(ms);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, ms);
  (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
  controller.signal.addEventListener(
    'abort',
    () => {
      clearTimeout(timer);
    },
    { once: true },
  );
  return controller.signal;
}

export function isJestRuntime(): boolean {
  const runtime = globalThis as typeof globalThis & {
    jest?: unknown;
    process?: {
      env?: Record<string, string | undefined>;
    };
  };

  return (
    typeof runtime.jest !== 'undefined' || typeof runtime.process?.env?.JEST_WORKER_ID === 'string'
  );
}
