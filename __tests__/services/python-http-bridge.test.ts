import {
  MAX_PYTHON_HTTP_RESPONSE_BYTES,
  performPythonHttpRequest,
} from '../../src/services/python/httpBridge';

type HeaderBag = {
  get: (name: string) => string | null;
  forEach: (callback: (value: string, key: string) => void) => void;
};

function createHeaderBag(entries: Record<string, string> = {}): HeaderBag {
  const normalized = Object.fromEntries(
    Object.entries(entries).map(([key, value]) => [key.toLowerCase(), value]),
  );

  return {
    get: (name: string) => normalized[name.toLowerCase()] ?? null,
    forEach: (callback) => {
      Object.entries(normalized).forEach(([key, value]) => callback(value, key));
    },
  };
}

function createMockResponse(
  body: string,
  init?: {
    status?: number;
    statusText?: string;
    headers?: Record<string, string>;
    url?: string;
    redirected?: boolean;
  },
): Response {
  const bytes = new TextEncoder().encode(body);
  return {
    status: init?.status ?? 200,
    statusText: init?.statusText ?? 'OK',
    headers: createHeaderBag(init?.headers) as unknown as Headers,
    url: init?.url ?? '',
    redirected: init?.redirected ?? false,
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as unknown as Response;
}

describe('python http bridge', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    jest.useRealTimers();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('blocks disallowed URLs before issuing fetch', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await performPythonHttpRequest({
      type: 'python-http-request',
      runtimeId: 'rt-1',
      requestId: 'req-1',
      url: 'http://localhost:8000/secret',
      method: 'GET',
    });

    expect(result.error).toContain('blocked by security policy');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('serializes successful responses back to base64 payloads', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      createMockResponse('hello from bridge', {
        status: 202,
        statusText: 'Accepted',
        headers: { 'content-type': 'text/plain' },
        url: 'https://example.com/final',
        redirected: true,
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await performPythonHttpRequest({
      type: 'python-http-request',
      runtimeId: 'rt-1',
      requestId: 'req-1',
      url: 'https://example.com/data',
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      bodyBase64: Buffer.from('payload', 'utf8').toString('base64'),
      timeoutMs: 250,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/data',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        credentials: 'omit',
        redirect: 'follow',
      }),
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new TextDecoder().decode(new Uint8Array(init.body as ArrayBuffer))).toBe('payload');
    expect(result.status).toBe(202);
    expect(result.statusText).toBe('Accepted');
    expect(result.headers).toEqual({ 'content-type': 'text/plain' });
    expect(result.url).toBe('https://example.com/final');
    expect(result.redirected).toBe(true);
    expect(Buffer.from(String(result.bodyBase64 || ''), 'base64').toString('utf8')).toBe(
      'hello from bridge',
    );
  });

  it('returns a timeout error when the native fetch stalls', async () => {
    jest.useRealTimers();
    const fetchMock = jest.fn().mockImplementation(
      (_, init?: RequestInit) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => {
              const error = new Error('aborted');
              error.name = 'AbortError';
              reject(error);
            },
            { once: true },
          );
        }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const resultPromise = performPythonHttpRequest({
      type: 'python-http-request',
      runtimeId: 'rt-1',
      requestId: 'req-1',
      url: 'https://example.com/data',
      method: 'GET',
      timeoutMs: 25,
    });

    const result = await resultPromise;
    expect(result.error).toContain('timed out after 250ms');
  });

  it('rejects responses that exceed the bridge size limit', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      createMockResponse('tiny body', {
        headers: { 'content-length': String(MAX_PYTHON_HTTP_RESPONSE_BYTES + 1) },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await performPythonHttpRequest({
      type: 'python-http-request',
      runtimeId: 'rt-1',
      requestId: 'req-1',
      url: 'https://example.com/data',
      method: 'GET',
    });

    expect(result.error).toContain(`exceeded ${MAX_PYTHON_HTTP_RESPONSE_BYTES} bytes`);
  });
});
