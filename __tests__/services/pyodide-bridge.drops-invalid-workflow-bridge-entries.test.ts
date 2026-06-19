import { executePython, handlePyodideMessage, registerPyodideWebView, unregisterPyodideWebView } from '../../src/services/python/pyodideBridge';

describe('pyodideBridge', () => {
  let mockInjectJavaScript: jest.Mock;
  let mockPostMessage: jest.Mock;
  let mockReload: jest.Mock;
  let originalFetch: typeof fetch;
  function getPostedPayload(callIndex = 0): Record<string, unknown> {
    return JSON.parse(String(mockPostMessage.mock.calls[callIndex]?.[0] || '{}'));
  }
  async function flushAsyncWork(turns = 4): Promise<void> {
    for (let index = 0; index < turns; index += 1) {
      await Promise.resolve();
    }
  }
  function bootRuntime(runtimeId = 'rt-1', error?: string): void {
    handlePyodideMessage(JSON.stringify({ type: 'bridge-ready', runtimeId }));
    handlePyodideMessage(
      JSON.stringify({ type: 'pyodide-ready', runtimeId, ...(error ? { error } : {}) }),
    );
  }
  beforeEach(() => {
    jest.useRealTimers();
    originalFetch = global.fetch;
    mockInjectJavaScript = jest.fn();
    mockPostMessage = jest.fn();
    mockReload = jest.fn();
    registerPyodideWebView({
      injectJavaScript: mockInjectJavaScript,
      postMessage: mockPostMessage,
      reload: mockReload,
    });
  });
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
    unregisterPyodideWebView();
    jest.useRealTimers();
  });
  function createHeaders(entries: Record<string, string> = {}): Headers {
    return {
      get: (name: string) => entries[name.toLowerCase()] ?? entries[name] ?? null,
      forEach: (callback: (value: string, key: string) => void) => {
        Object.entries(entries).forEach(([key, value]) => callback(value, key));
      },
    } as unknown as Headers;
  }
  function createMockResponse(
    body: string,
    init?: { status?: number; statusText?: string; headers?: Record<string, string> },
  ): Response {
    const bytes = new TextEncoder().encode(body);
    return {
      status: init?.status ?? 200,
      statusText: init?.statusText ?? 'OK',
      headers: createHeaders(init?.headers),
      url: 'https://example.com/final',
      redirected: false,
      arrayBuffer: async () =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    } as unknown as Response;
  }
  it('drops invalid workflow bridge entries and strips unsafe artifact paths', async () => {
    bootRuntime();

    const resultPromise = executePython({
      code: 'print("workflow")',
      workflowBridge: {
        evidence: [
          {
            kind: 'fact',
            status: 'verified',
            title: 'Valid evidence',
            content: 'Retain this entry.',
          },
          {
            kind: 'bogus',
            content: 'Discard this entry.',
          },
        ],
      },
      timeoutMs: 200,
    });
    await flushAsyncWork();

    const sent = getPostedPayload();
    expect(sent.workflowBridge).toEqual({
      evidence: [
        expect.objectContaining({
          kind: 'fact',
          status: 'verified',
          title: 'Valid evidence',
          content: 'Retain this entry.',
        }),
      ],
    });

    handlePyodideMessage(
      JSON.stringify({
        type: 'python-result',
        runtimeId: 'rt-1',
        id: sent.id,
        output: 'workflow\n',
        workflowBridge: {
          emittedEvidence: [
            {
              kind: 'summary',
              title: 'Python verification',
              content: 'Validated the current workspace snapshot.',
              artifactWorkspacePath: '../escape.txt',
            },
            {
              kind: 'bogus',
              title: 'Invalid evidence',
              content: 'Should be dropped.',
            },
          ],
        },
      }),
    );

    const result = await resultPromise;
    expect(result.workflowBridge?.emittedEvidence).toEqual([
      expect.objectContaining({
        kind: 'summary',
        title: 'Python verification',
        content: 'Validated the current workspace snapshot.',
      }),
    ]);
    expect(result.workflowBridge?.emittedEvidence?.[0]?.artifactWorkspacePath).toBeUndefined();
  });
  it('handles error results from Python execution', async () => {
    bootRuntime();

    const resultPromise = executePython({ code: '1/0', timeoutMs: 200 });
    await flushAsyncWork();

    const sent = getPostedPayload();
    handlePyodideMessage(
      JSON.stringify({
        type: 'python-result',
        runtimeId: 'rt-1',
        id: sent.id,
        error: 'ZeroDivisionError: division by zero',
        durationMs: 5,
      }),
    );

    const result = await resultPromise;
    expect(result.success).toBe(false);
    expect(result.error).toContain('ZeroDivisionError');
  });
  it('routes python-http-request messages through native fetch and returns python-http-response', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      createMockResponse('native bridge body', {
        status: 206,
        statusText: 'Partial Content',
        headers: { 'content-type': 'text/plain' },
      }),
    ) as unknown as typeof fetch;
    bootRuntime();

    handlePyodideMessage(
      JSON.stringify({
        type: 'python-http-request',
        runtimeId: 'rt-1',
        requestId: 'req-1',
        url: 'https://example.com/data',
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        bodyBase64: Buffer.from('payload', 'utf8').toString('base64'),
        timeoutMs: 250,
      }),
    );
    await flushAsyncWork(6);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://example.com/data',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(mockPostMessage).toHaveBeenCalledTimes(1);
    const sent = getPostedPayload();
    expect(sent.type).toBe('python-http-response');
    expect(sent.requestId).toBe('req-1');
    expect(sent.status).toBe(206);
    expect(Buffer.from(String(sent.bodyBase64 || ''), 'base64').toString('utf8')).toBe(
      'native bridge body',
    );
  });
  it('aborts in-flight native HTTP requests when python-http-abort is received', async () => {
    global.fetch = jest.fn().mockImplementation(
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
    ) as unknown as typeof fetch;
    bootRuntime();

    handlePyodideMessage(
      JSON.stringify({
        type: 'python-http-request',
        runtimeId: 'rt-1',
        requestId: 'req-1',
        url: 'https://example.com/data',
        method: 'GET',
        timeoutMs: 250,
      }),
    );
    handlePyodideMessage(
      JSON.stringify({
        type: 'python-http-abort',
        runtimeId: 'rt-1',
        requestId: 'req-1',
      }),
    );
    await flushAsyncWork(6);

    expect(mockPostMessage).not.toHaveBeenCalled();
  });
  it('ignores stale runtime messages after the bridge instance changes', async () => {
    bootRuntime('rt-1');

    const resultPromise = executePython({ code: 'print("active")', timeoutMs: 200 });
    await flushAsyncWork();

    const sent = getPostedPayload();
    handlePyodideMessage(JSON.stringify({ type: 'bridge-ready', runtimeId: 'rt-2' }));
    handlePyodideMessage(JSON.stringify({ type: 'pyodide-ready', runtimeId: 'rt-2' }));
    handlePyodideMessage(
      JSON.stringify({
        type: 'python-result',
        runtimeId: 'rt-1',
        id: sent.id,
        output: 'stale\n',
      }),
    );

    await flushAsyncWork();
    expect(mockPostMessage).toHaveBeenCalledTimes(1);

    handlePyodideMessage(
      JSON.stringify({
        type: 'python-result',
        runtimeId: 'rt-2',
        id: sent.id,
        output: 'active\n',
      }),
    );

    const result = await resultPromise;
    expect(result.success).toBe(true);
    expect(result.output).toBe('active\n');
  });
  it('reloads and retries when the runtime does not acknowledge a dispatched request', async () => {
    jest.useFakeTimers();
    bootRuntime('rt-1');

    const resultPromise = executePython({ code: 'print("retry")', timeoutMs: 1000 });
    await flushAsyncWork(4);

    expect(mockPostMessage).toHaveBeenCalledTimes(1);
    const firstAttempt = getPostedPayload();

    jest.advanceTimersByTime(1000);
    await flushAsyncWork(6);

    expect(mockReload).toHaveBeenCalledTimes(1);
    expect(mockPostMessage).toHaveBeenCalledTimes(1);

    bootRuntime('rt-2');
    await flushAsyncWork(6);

    expect(mockPostMessage).toHaveBeenCalledTimes(2);
    const retriedAttempt = getPostedPayload(1);
    expect(retriedAttempt.id).toBe(firstAttempt.id);

    handlePyodideMessage(
      JSON.stringify({ type: 'python-dispatch-ack', runtimeId: 'rt-2', id: retriedAttempt.id }),
    );
    handlePyodideMessage(
      JSON.stringify({
        type: 'python-result',
        runtimeId: 'rt-2',
        id: retriedAttempt.id,
        output: 'retry\n',
      }),
    );

    const result = await resultPromise;
    expect(result.success).toBe(true);
    expect(result.output).toBe('retry\n');
  });
  it('fails fast after repeated missing dispatch acknowledgements', async () => {
    jest.useFakeTimers();
    bootRuntime('rt-1');

    const resultPromise = executePython({ code: 'print("stalled")', timeoutMs: 1000 });
    await flushAsyncWork(4);

    expect(mockPostMessage).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1000);
    await flushAsyncWork(6);

    expect(mockReload).toHaveBeenCalledTimes(1);

    bootRuntime('rt-2');
    await flushAsyncWork(6);

    expect(mockPostMessage).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(1000);
    await flushAsyncWork(6);

    const result = await resultPromise;
    expect(result.success).toBe(false);
    expect(result.error).toContain('did not acknowledge');
    expect(mockReload).toHaveBeenCalledTimes(2);
  });
  it('times out when no response is received after acknowledgement', async () => {
    jest.useFakeTimers();
    bootRuntime('rt-1');

    const resultPromise = executePython({
      code: 'import time; time.sleep(999)',
      timeoutMs: 50,
    });

    await flushAsyncWork();
    const sent = getPostedPayload();
    handlePyodideMessage(
      JSON.stringify({ type: 'python-dispatch-ack', runtimeId: 'rt-1', id: sent.id }),
    );

    jest.advanceTimersByTime(50);
    await flushAsyncWork(6);

    const result = await resultPromise;
    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
    expect(mockReload).toHaveBeenCalledTimes(1);
  });
  it('serializes concurrent executions on the shared runtime', async () => {
    bootRuntime();

    const firstResultPromise = executePython({ code: 'print(1)', timeoutMs: 200 });
    await flushAsyncWork();
    const firstSent = getPostedPayload();

    const secondResultPromise = executePython({ code: 'print(2)', timeoutMs: 200 });
    await flushAsyncWork();

    expect(mockPostMessage).toHaveBeenCalledTimes(1);

    handlePyodideMessage(
      JSON.stringify({
        type: 'python-result',
        runtimeId: 'rt-1',
        id: firstSent.id,
        output: '1\n',
      }),
    );

    const firstResult = await firstResultPromise;
    await flushAsyncWork();

    expect(firstResult.output).toBe('1\n');
    expect(mockPostMessage).toHaveBeenCalledTimes(2);

    const secondSent = getPostedPayload(1);
    handlePyodideMessage(
      JSON.stringify({
        type: 'python-result',
        runtimeId: 'rt-1',
        id: secondSent.id,
        output: '2\n',
      }),
    );

    const secondResult = await secondResultPromise;
    expect(secondResult.output).toBe('2\n');
  });
});
