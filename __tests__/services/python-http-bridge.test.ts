import {
  MAX_PYTHON_HTTP_REDIRECTS,
  MAX_PYTHON_HTTP_RESPONSE_BYTES,
  performPythonHttpRequest,
} from '../../src/services/python/httpBridge';

const mockExpoFetch = jest.fn();

jest.mock('expo/fetch', () => ({
  fetch: (...args: unknown[]) => mockExpoFetch(...args),
}));

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
  beforeEach(() => {
    mockExpoFetch.mockReset();
    jest.useRealTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('blocks disallowed URLs before issuing fetch', async () => {
    const result = await performPythonHttpRequest({
      type: 'python-http-request',
      runtimeId: 'rt-1',
      requestId: 'req-1',
      url: 'http://localhost:8000/secret',
      method: 'GET',
    });

    expect(result.error).toContain('blocked by security policy');
    expect(mockExpoFetch).not.toHaveBeenCalled();
  });

  it('serializes successful responses back to base64 payloads', async () => {
    mockExpoFetch.mockResolvedValue(
      createMockResponse('hello from bridge', {
        status: 202,
        statusText: 'Accepted',
        headers: { 'content-type': 'text/plain' },
        url: 'https://example.com/data',
      }),
    );

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

    expect(mockExpoFetch).toHaveBeenCalledWith(
      'https://example.com/data',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        credentials: 'omit',
        redirect: 'manual',
      }),
    );
    const init = mockExpoFetch.mock.calls[0]?.[1] as RequestInit;
    expect(new TextDecoder().decode(new Uint8Array(init.body as ArrayBuffer))).toBe('payload');
    expect(result.status).toBe(202);
    expect(result.statusText).toBe('Accepted');
    expect(result.headers).toEqual({ 'content-type': 'text/plain' });
    expect(result.url).toBe('https://example.com/data');
    expect(result.redirected).toBe(false);
    expect(Buffer.from(String(result.bodyBase64 || ''), 'base64').toString('utf8')).toBe(
      'hello from bridge',
    );
  });

  it('rejects a redirect to a blocked URL before issuing the redirected request', async () => {
    mockExpoFetch.mockResolvedValueOnce(
      createMockResponse('', {
        status: 302,
        statusText: 'Found',
        headers: { location: 'http://169.254.169.254/latest/meta-data/' },
        url: 'https://example.com/redirect',
      }),
    );

    const result = await performPythonHttpRequest({
      type: 'python-http-request',
      runtimeId: 'rt-1',
      requestId: 'req-1',
      url: 'https://example.com/redirect',
      method: 'GET',
    });

    expect(result.error).toContain('redirect blocked by security policy');
    expect(mockExpoFetch).toHaveBeenCalledTimes(1);
  });

  it('follows bounded allowed redirects and strips credentials across origins', async () => {
    mockExpoFetch
      .mockResolvedValueOnce(
        createMockResponse('', {
          status: 302,
          statusText: 'Found',
          headers: { location: 'https://cdn.example.org/final' },
          url: 'https://example.com/start',
        }),
      )
      .mockResolvedValueOnce(
        createMockResponse('done', {
          url: 'https://cdn.example.org/final',
        }),
      );

    const result = await performPythonHttpRequest({
      type: 'python-http-request',
      runtimeId: 'rt-1',
      requestId: 'req-1',
      url: 'https://example.com/start',
      method: 'POST',
      headers: {
        authorization: 'Bearer secret',
        'content-type': 'text/plain',
        'x-request-id': 'safe',
      },
      bodyBase64: Buffer.from('payload', 'utf8').toString('base64'),
    });

    expect(mockExpoFetch).toHaveBeenCalledTimes(2);
    expect(mockExpoFetch.mock.calls[1]).toEqual([
      'https://cdn.example.org/final',
      expect.objectContaining({
        method: 'GET',
        headers: { 'x-request-id': 'safe' },
        redirect: 'manual',
      }),
    ]);
    expect(result.redirected).toBe(true);
    expect(result.status).toBe(200);
  });

  it('stops an allowed redirect loop at the configured bound', async () => {
    for (let index = 0; index <= MAX_PYTHON_HTTP_REDIRECTS; index += 1) {
      mockExpoFetch.mockResolvedValueOnce(
        createMockResponse('', {
          status: 307,
          statusText: 'Temporary Redirect',
          headers: { location: `/redirect-${index + 1}` },
          url: `https://example.com/redirect-${index}`,
        }),
      );
    }

    const result = await performPythonHttpRequest({
      type: 'python-http-request',
      runtimeId: 'rt-1',
      requestId: 'req-1',
      url: 'https://example.com/redirect-0',
      method: 'GET',
    });

    expect(result.error).toContain(`exceeded ${MAX_PYTHON_HTTP_REDIRECTS} redirects`);
    expect(mockExpoFetch).toHaveBeenCalledTimes(MAX_PYTHON_HTTP_REDIRECTS + 1);
  });

  it('returns a timeout error when the native fetch stalls', async () => {
    jest.useRealTimers();
    mockExpoFetch.mockImplementation(
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
    mockExpoFetch.mockResolvedValue(
      createMockResponse('tiny body', {
        headers: { 'content-length': String(MAX_PYTHON_HTTP_RESPONSE_BYTES + 1) },
      }),
    );
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
