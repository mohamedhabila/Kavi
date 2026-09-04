type AbortSignalWithTimeout = typeof AbortSignal & {
  timeout?: (ms: number) => AbortSignal;
};

/**
 * A structured, environment-portable stand-in for the DOMException the spec
 * requires `AbortSignal.timeout()` to set as `signal.reason` — used only by
 * the manual fallback below, for runtimes with no native
 * `AbortSignal.timeout` (older Hermes/React Native). Callers downstream
 * (`classifyNativeTransportErrorIdentity`) must be able to tell "the request
 * timed out" apart from "the caller cancelled it" from this identity alone
 * (`name === 'TimeoutError'`), never by parsing message text.
 */
function createTimeoutAbortReason(): unknown {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('The operation timed out', 'TimeoutError');
  }
  return Object.assign(new Error('The operation timed out'), { name: 'TimeoutError' });
}

export function createTimeoutSignal(ms: number): AbortSignal {
  const abortSignalCtor = globalThis.AbortSignal as AbortSignalWithTimeout | undefined;
  if (abortSignalCtor && typeof abortSignalCtor.timeout === 'function') {
    // The native implementation already sets `signal.reason` to a
    // TimeoutError DOMException per spec — nothing to add here.
    return abortSignalCtor.timeout(ms);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(createTimeoutAbortReason());
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
