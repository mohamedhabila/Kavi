import { fetch as expoFetch } from 'expo/fetch';

export type LlmPerformFetch = (
  url: string,
  init: RequestInit,
  preferStreaming?: boolean,
) => Promise<Response>;

function createAbortError(): Error {
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
    throw createAbortError();
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
      reject(createAbortError());
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
