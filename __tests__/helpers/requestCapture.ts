import fs from 'fs';
import path from 'path';

/** Header names that carry credentials; they are never written. */
const SECRET_HEADER = /authorization|api-key|x-goog-api-key|cookie/iu;

function headersOf(init?: RequestInit): Record<string, string> {
  const entries =
    init?.headers instanceof Headers
      ? [...init.headers.entries()]
      : Array.isArray(init?.headers)
        ? init.headers
        : Object.entries(init?.headers ?? {});
  return Object.fromEntries(
    entries
      .filter(([name]) => !SECRET_HEADER.test(name))
      .map(([name, value]) => [name, String(value)]),
  );
}

/**
 * Writes every model request (a POST whose JSON body has `messages`) to
 * `<dir>/<prefix>-<n>.json` with its URL and headers, credentials removed, until the
 * returned function restores fetch. For replaying a live run's exact requests offline.
 */
export function installRequestCapture(dir: string, prefix: string): () => void {
  fs.mkdirSync(dir, { recursive: true });
  const realFetch = global.fetch;
  let count = 0;
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST' && typeof init.body === 'string') {
      try {
        const body: unknown = JSON.parse(init.body);
        if (body && typeof body === 'object' && 'messages' in body) {
          count += 1;
          fs.writeFileSync(
            path.join(dir, `${prefix}-${String(count).padStart(3, '0')}.json`),
            JSON.stringify({ url: String(input), headers: headersOf(init), body }),
          );
        }
      } catch {
        // Not a JSON body, so not a model request.
      }
    }
    return realFetch(input, init);
  }) as typeof fetch;
  return () => {
    global.fetch = realFetch;
  };
}
