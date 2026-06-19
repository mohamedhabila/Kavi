export function parseSseEventBlock(block: string): string | null {
  const dataLines: string[] = [];

  for (const line of block.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;

    let value = line.slice(5);
    if (value.startsWith(' ')) {
      value = value.slice(1);
    }
    dataLines.push(value);
  }

  if (dataLines.length === 0) {
    return null;
  }

  return dataLines.join('\n');
}

function* emitCompleteSseBlocks(
  source: string,
  flush: boolean,
): Generator<{ remaining: string; data: string }> {
  const pattern = /\r?\n\r?\n/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source)) !== null) {
    const block = source.slice(lastIndex, match.index);
    lastIndex = match.index + match[0].length;
    const data = parseSseEventBlock(block);
    if (data !== null) {
      yield { remaining: '', data };
    }
  }

  const remaining = source.slice(lastIndex);
  if (flush && remaining.trim().length > 0) {
    const data = parseSseEventBlock(remaining);
    if (data !== null) {
      yield { remaining: '', data };
    }
    return;
  }

  yield { remaining, data: '' };
}

function createAbortError(): Error {
  const error = new Error('Request cancelled');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

async function withAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  onAbort?: () => void,
): Promise<T> {
  if (!signal) {
    return promise;
  }
  throwIfAborted(signal);
  let abortHandler: (() => void) | undefined;
  const abortPromise = new Promise<never>((_resolve, reject) => {
    abortHandler = () => {
      try {
        onAbort?.();
      } catch {
        // Cancellation cleanup is best-effort; the abort error remains authoritative.
      }
      reject(createAbortError());
    };
    signal.addEventListener('abort', abortHandler, { once: true });
  });

  try {
    return await Promise.race([promise, abortPromise]);
  } finally {
    if (abortHandler) {
      signal.removeEventListener('abort', abortHandler);
    }
  }
}

export async function* iterateSseData(
  response: Response,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  throwIfAborted(signal);
  const streamableResponse = response as Response & { body?: ReadableStream<Uint8Array> | null };
  const readableBody = streamableResponse.body as
    | { getReader?: () => ReadableStreamDefaultReader<Uint8Array> }
    | null
    | undefined;
  if (readableBody && typeof readableBody.getReader === 'function') {
    const reader = readableBody.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await withAbort(reader.read(), signal, () => {
          void reader.cancel().catch(() => {});
        });
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        let nextBuffer = buffer;
        for (const part of emitCompleteSseBlocks(buffer, false)) {
          nextBuffer = part.remaining;
          if (part.data) {
            yield part.data;
          }
        }
        buffer = nextBuffer;
      }

      buffer += decoder.decode();
      for (const part of emitCompleteSseBlocks(buffer, true)) {
        if (part.data) {
          yield part.data;
        }
      }
    } finally {
      reader.releaseLock();
    }

    return;
  }

  if (typeof response.text !== 'function') {
    throw new TypeError(
      'Streaming response body is not readable via getReader() and response.text() is unavailable.',
    );
  }

  const rawText = await withAbort(response.text(), signal);
  for (const part of emitCompleteSseBlocks(rawText, true)) {
    if (part.data) {
      yield part.data;
    }
  }
}
