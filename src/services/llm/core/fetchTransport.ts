import { fetch as expoFetch } from 'expo/fetch';

export type LlmPerformFetch = (
  url: string,
  init: RequestInit,
  preferStreaming?: boolean,
) => Promise<Response>;

/** Reauthorize every remote request at the final transport boundary, including adapter retries. */
export function bindLlmPerformFetchDispatchGuard(
  performFetch: LlmPerformFetch,
  requestDispatchGuard: (() => void) | undefined,
): LlmPerformFetch {
  return (url, init, preferStreaming) => {
    requestDispatchGuard?.();
    return performFetch(url, init, preferStreaming);
  };
}

function isTimeoutAbortReason(reason: unknown): boolean {
  return (
    Boolean(reason) &&
    typeof reason === 'object' &&
    (reason as { name?: unknown }).name === 'TimeoutError'
  );
}

/**
 * Builds the error thrown when a request is aborted. `signal.reason` — set
 * by `AbortSignal.timeout()` natively, or by our own fallback in
 * `createTimeoutSignal` (src/utils/runtime.ts) — is the only thing that may
 * distinguish a timeout from a caller-initiated cancellation; never guess
 * from message text. `signal.reason` is not guaranteed to be a real
 * `Error`/`DOMException` across engines (a caller's own bare
 * `controller.abort()`, a custom reason object, ...), so its `name` is read
 * defensively rather than rethrowing the reason itself or relying on
 * `instanceof`.
 */
function createAbortError(reason?: unknown): Error {
  if (isTimeoutAbortReason(reason)) {
    const message =
      reason instanceof Error && reason.message ? reason.message : 'The operation timed out';
    const error = new Error(message);
    error.name = 'TimeoutError';
    return error;
  }

  const error = new Error('Request cancelled');
  error.name = 'AbortError';
  return error;
}

async function raceFetchWithAbort(
  requestPromise: Promise<Response>,
  signal: AbortSignal | null | undefined,
): Promise<Response> {
  if (!signal) {
    return requestPromise;
  }
  if (signal.aborted) {
    throw createAbortError(signal.reason);
  }

  let settled = false;
  let abortHandler: (() => void) | undefined;
  const guardedRequest = requestPromise.finally(() => {
    settled = true;
    if (abortHandler) {
      signal.removeEventListener('abort', abortHandler);
    }
  });
  const abortPromise = new Promise<never>((_resolve, reject) => {
    abortHandler = () => {
      if (!settled) {
        requestPromise.catch(() => undefined);
      }
      reject(createAbortError(signal.reason));
    };
    signal.addEventListener('abort', abortHandler, { once: true });
  });

  return Promise.race([guardedRequest, abortPromise]);
}

export async function performLlmFetch(
  url: string,
  init: RequestInit,
  preferStreaming = false,
): Promise<Response> {
  const request = preferStreaming ? expoFetch : fetch;
  return raceFetchWithAbort(
    request(url, {
      ...init,
      credentials: init.credentials ?? 'omit',
    }),
    init.signal,
  );
}
