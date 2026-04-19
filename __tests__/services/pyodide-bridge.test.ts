import {
  executePython,
  getPyodideHtml,
  handlePyodideMessage,
  isPyodideReady,
  registerPyodideWebView,
  reportPyodideRuntimeFailure,
  unregisterPyodideWebView,
} from '../../src/services/python/pyodideBridge';

describe('pyodideBridge', () => {
  let mockInjectJavaScript: jest.Mock;
  let mockPostMessage: jest.Mock;
  let mockReload: jest.Mock;
  let originalFetch: typeof fetch;

  function getPostedPayload(callIndex = 0): Record<string, unknown> {
    return JSON.parse(String(mockPostMessage.mock.calls[callIndex]?.[0] || '{}'));
  }

  function getInjectedPayload(callIndex = 0): Record<string, unknown> {
    const script = String(mockInjectJavaScript.mock.calls[callIndex]?.[0] || '');
    const match = script.match(/var payload = ("(?:[^"\\]|\\.)*");/);
    if (!match) {
      throw new Error(`Unable to parse injected payload from script: ${script}`);
    }
    return JSON.parse(JSON.parse(match[1]));
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

  it('initialises as not ready', () => {
    unregisterPyodideWebView();
    expect(isPyodideReady()).toBe(false);
  });

  it('does not become ready on bridge-ready alone', () => {
    handlePyodideMessage(JSON.stringify({ type: 'bridge-ready', runtimeId: 'rt-1' }));
    expect(isPyodideReady()).toBe(false);
  });

  it('becomes ready when the current runtime reports pyodide-ready', () => {
    bootRuntime();
    expect(isPyodideReady()).toBe(true);
  });

  it('returns error when WebView is not mounted', async () => {
    unregisterPyodideWebView();
    const result = await executePython({ code: 'print("hi")' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not available');
  });

  it('rejects requests that omit both inline code and a script path', async () => {
    const result = await executePython({});

    expect(result.success).toBe(false);
    expect(result.error).toContain('either inline code or a scriptPath');
    expect(mockPostMessage).not.toHaveBeenCalled();
  });

  it('rejects ambiguous requests that provide both inline code and a script path', async () => {
    const result = await executePython({ code: 'print("hi")', scriptPath: 'scripts/test.py' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('not both');
    expect(mockPostMessage).not.toHaveBeenCalled();
  });

  it('waits for the runtime to become ready before dispatching execution requests', async () => {
    const resultPromise = executePython({ code: 'print("hi")', timeoutMs: 200 });

    await flushAsyncWork();
    expect(mockPostMessage).not.toHaveBeenCalled();

    handlePyodideMessage(JSON.stringify({ type: 'bridge-ready', runtimeId: 'rt-1' }));
    await flushAsyncWork();
    expect(mockPostMessage).not.toHaveBeenCalled();

    handlePyodideMessage(JSON.stringify({ type: 'pyodide-ready', runtimeId: 'rt-1' }));
    await flushAsyncWork();

    expect(mockPostMessage).toHaveBeenCalledTimes(1);
    const sent = getPostedPayload();
    expect(sent.type).toBe('run-python');

    handlePyodideMessage(
      JSON.stringify({ type: 'python-dispatch-ack', runtimeId: 'rt-1', id: sent.id }),
    );
    handlePyodideMessage(
      JSON.stringify({ type: 'python-result', runtimeId: 'rt-1', id: sent.id, output: 'hi\n' }),
    );

    const result = await resultPromise;
    expect(result.success).toBe(true);
    expect(result.output).toBe('hi\n');
  });

  it('surfaces startup failures instead of marking the runtime as ready', async () => {
    const resultPromise = executePython({ code: 'print("hi")', timeoutMs: 200 });

    bootRuntime('rt-1', 'CDN load failed');

    const result = await resultPromise;
    expect(result.success).toBe(false);
    expect(result.error).toContain('CDN load failed');
    expect(isPyodideReady()).toBe(false);
    expect(mockPostMessage).not.toHaveBeenCalled();
  });

  it('retries with a runtime reload after a startup failure on the next request', async () => {
    const failedResultPromise = executePython({ code: 'print("hi")', timeoutMs: 200 });
    bootRuntime('rt-1', 'CDN load failed');
    await failedResultPromise;

    const retriedResultPromise = executePython({ code: 'print("retry")', timeoutMs: 200 });
    await flushAsyncWork(6);

    expect(mockReload).toHaveBeenCalledTimes(1);
    expect(mockPostMessage).not.toHaveBeenCalled();

    bootRuntime('rt-2');
    await flushAsyncWork();

    expect(mockPostMessage).toHaveBeenCalledTimes(1);
    const sent = getPostedPayload();
    handlePyodideMessage(
      JSON.stringify({ type: 'python-result', runtimeId: 'rt-2', id: sent.id, output: 'retry\n' }),
    );

    const retriedResult = await retriedResultPromise;
    expect(retriedResult.success).toBe(true);
    expect(retriedResult.output).toBe('retry\n');
  });

  it('uses postMessage as the primary bridge channel', async () => {
    bootRuntime();

    const resultPromise = executePython({
      code: 'print("hello")',
      packages: ['requests'],
      timeoutMs: 200,
    });
    await flushAsyncWork();

    expect(mockPostMessage).toHaveBeenCalledTimes(1);
    expect(mockInjectJavaScript).not.toHaveBeenCalled();

    const sent = getPostedPayload();
    expect(sent.type).toBe('run-python');
    expect(sent.code).toBe('print("hello")');
    expect(sent.packages).toEqual(['requests']);
    expect(sent.argv).toEqual([]);
    expect(sent.files).toEqual([]);
    expect(sent.workingDirectory).toBe('');
    expect(sent.id).toMatch(/^py-/);

    handlePyodideMessage(
      JSON.stringify({
        type: 'python-result',
        runtimeId: 'rt-1',
        id: sent.id,
        output: 'hello\n',
        durationMs: 42,
      }),
    );

    const result = await resultPromise;
    expect(result.success).toBe(true);
    expect(result.output).toBe('hello\n');
    expect(result.durationMs).toBe(42);
  });

  it('falls back to injectJavaScript when postMessage is unavailable', async () => {
    unregisterPyodideWebView();
    registerPyodideWebView({ injectJavaScript: mockInjectJavaScript, reload: mockReload });
    bootRuntime();

    const resultPromise = executePython({ code: 'print("fallback")', timeoutMs: 200 });
    await flushAsyncWork();

    expect(mockInjectJavaScript).toHaveBeenCalledTimes(1);
    const sent = getInjectedPayload();
    expect(sent.type).toBe('run-python');

    handlePyodideMessage(
      JSON.stringify({
        type: 'python-result',
        runtimeId: 'rt-1',
        id: sent.id,
        output: 'fallback\n',
      }),
    );

    const result = await resultPromise;
    expect(result.output).toBe('fallback\n');
  });

  it('sends script execution requests with argv and mounted files', async () => {
    bootRuntime();

    const resultPromise = executePython({
      scriptPath: 'skills/nano-banana/scripts/generate.py',
      argv: ['--prompt', 'banana'],
      files: [
        {
          path: 'skills/nano-banana/scripts/generate.py',
          contentBase64: 'cHJpbnQoImhlbGxvIik=',
        },
      ],
      timeoutMs: 200,
    });
    await flushAsyncWork();

    const sent = getPostedPayload();
    expect(sent.scriptPath).toBe('skills/nano-banana/scripts/generate.py');
    expect(sent.argv).toEqual(['--prompt', 'banana']);
    expect(sent.files).toEqual([
      { path: 'skills/nano-banana/scripts/generate.py', contentBase64: 'cHJpbnQoImhlbGxvIik=' },
    ]);

    handlePyodideMessage(
      JSON.stringify({
        type: 'python-result',
        runtimeId: 'rt-1',
        id: sent.id,
        output: 'saved',
        files: [{ path: 'outputs/result.txt', contentBase64: 'ZG9uZQ==' }],
      }),
    );

    const result = await resultPromise;
    expect(result.files).toEqual([{ path: 'outputs/result.txt', contentBase64: 'ZG9uZQ==' }]);
  });

  it('forwards workflow bridge state into Python and returns emitted workflow evidence', async () => {
    bootRuntime();

    const resultPromise = executePython({
      code: 'print("workflow")',
      workflowBridge: {
        evidence: [
          {
            kind: 'fact',
            status: 'verified',
            title: 'Known constraint',
            content: 'The workspace snapshot is authoritative.',
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
          title: 'Known constraint',
          content: 'The workspace snapshot is authoritative.',
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
            },
          ],
        },
      }),
    );

    const result = await resultPromise;
    expect(result.success).toBe(true);
    expect(result.workflowBridge?.emittedEvidence).toEqual([
      expect.objectContaining({
        kind: 'summary',
        title: 'Python verification',
        content: 'Validated the current workspace snapshot.',
      }),
    ]);
  });

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

  it('reloads the runtime after a timeout and waits for a fresh ready signal before running queued work', async () => {
    jest.useFakeTimers();
    bootRuntime('rt-1');

    const slowResultPromise = executePython({ code: 'print("slow")', timeoutMs: 30 });
    await flushAsyncWork();
    expect(mockPostMessage).toHaveBeenCalledTimes(1);
    const slowSent = getPostedPayload();
    handlePyodideMessage(
      JSON.stringify({ type: 'python-dispatch-ack', runtimeId: 'rt-1', id: slowSent.id }),
    );

    const queuedResultPromise = executePython({ code: 'print("queued")', timeoutMs: 200 });

    jest.advanceTimersByTime(30);
    await flushAsyncWork(6);

    const slowResult = await slowResultPromise;
    expect(slowResult.success).toBe(false);
    expect(slowResult.error).toContain('timed out');
    expect(mockReload).toHaveBeenCalledTimes(1);

    await flushAsyncWork();
    expect(mockPostMessage).toHaveBeenCalledTimes(1);

    bootRuntime('rt-2');
    await flushAsyncWork();

    expect(mockPostMessage).toHaveBeenCalledTimes(2);
    const queuedSent = getPostedPayload(1);
    handlePyodideMessage(
      JSON.stringify({
        type: 'python-result',
        runtimeId: 'rt-2',
        id: queuedSent.id,
        output: 'queued\n',
      }),
    );

    const queuedResult = await queuedResultPromise;
    expect(queuedResult.success).toBe(true);
    expect(queuedResult.output).toBe('queued\n');
  });

  it('resolves pending requests on unmount', async () => {
    bootRuntime();

    const resultPromise = executePython({ code: 'x=1', timeoutMs: 5000 });
    const queuedPromise = executePython({ code: 'x=2', timeoutMs: 5000 });

    unregisterPyodideWebView();

    const result = await resultPromise;
    const queuedResult = await queuedPromise;
    expect(result.success).toBe(false);
    expect(result.error).toContain('unmounted');
    expect(queuedResult.success).toBe(false);
    expect(queuedResult.error).toContain('unmounted');
  });

  it('sanitizes env values to strings only', async () => {
    bootRuntime();

    const resultPromise = executePython({
      code: 'import os; print(os.environ.get("KEY"))',
      env: { KEY: 'value', BAD: 123 as any },
      timeoutMs: 200,
    });
    await flushAsyncWork();

    const sent = getPostedPayload();
    expect(sent.env).toEqual({ KEY: 'value' });

    handlePyodideMessage(
      JSON.stringify({
        type: 'python-result',
        runtimeId: 'rt-1',
        id: sent.id,
        output: 'value',
      }),
    );

    await resultPromise;
  });

  it('deduplicates and filters package specs before dispatching to the runtime', async () => {
    bootRuntime();

    const resultPromise = executePython({
      code: 'print("packages")',
      packages: ['requests', 'requests', 42 as any, 'httpx'],
      timeoutMs: 200,
    } as any);
    await flushAsyncWork();

    const sent = getPostedPayload();
    expect(sent.packages).toEqual(['requests', 'httpx']);

    handlePyodideMessage(
      JSON.stringify({
        type: 'python-result',
        runtimeId: 'rt-1',
        id: sent.id,
        output: 'packages\n',
      }),
    );

    await resultPromise;
  });

  it('deduplicates and forwards custom package indexes to the runtime', async () => {
    bootRuntime();

    const resultPromise = executePython({
      code: 'print("packages")',
      packages: ['requests'],
      indexUrls: [
        'https://packages.example/simple',
        'https://packages.example/simple',
        'ftp://ignored.example',
      ],
      timeoutMs: 200,
    } as any);
    await flushAsyncWork();

    const sent = getPostedPayload();
    expect(sent.indexUrls).toEqual(['https://packages.example/simple']);

    handlePyodideMessage(
      JSON.stringify({
        type: 'python-result',
        runtimeId: 'rt-1',
        id: sent.id,
        output: 'packages\n',
      }),
    );

    await resultPromise;
  });

  it('rejects unsafe direct script paths before queueing execution', async () => {
    const result = await executePython({ scriptPath: '../unsafe.py' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('scriptPath');
    expect(mockPostMessage).not.toHaveBeenCalled();
  });

  it('rejects unsafe working directories before queueing execution', async () => {
    const result = await executePython({
      code: 'print("hi")',
      workingDirectory: '../unsafe',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('workingDirectory');
    expect(mockPostMessage).not.toHaveBeenCalled();
  });

  it('fails active and queued requests when the runtime reports a load failure', async () => {
    bootRuntime();

    const activePromise = executePython({ code: 'print("active")', timeoutMs: 200 });
    await flushAsyncWork();
    const queuedPromise = executePython({ code: 'print("queued")', timeoutMs: 200 });

    handlePyodideMessage(
      JSON.stringify({
        type: 'python-runtime-error',
        runtimeId: 'rt-1',
        error: 'Pyodide worker failed: network failed',
      }),
    );

    const activeResult = await activePromise;
    const queuedResult = await queuedPromise;
    expect(activeResult.success).toBe(false);
    expect(activeResult.error).toContain('network failed');
    expect(queuedResult.success).toBe(false);
    expect(queuedResult.error).toContain('network failed');
    expect(isPyodideReady()).toBe(false);
  });

  it('allows direct runtime failure reporting through the public helper', async () => {
    bootRuntime();

    const activePromise = executePython({ code: 'print("active")', timeoutMs: 200 });
    await flushAsyncWork();
    const queuedPromise = executePython({ code: 'print("queued")', timeoutMs: 200 });

    reportPyodideRuntimeFailure('Pyodide WebView failed to load: network failed');

    const activeResult = await activePromise;
    const queuedResult = await queuedPromise;
    expect(activeResult.success).toBe(false);
    expect(activeResult.error).toContain('network failed');
    expect(queuedResult.success).toBe(false);
    expect(queuedResult.error).toContain('network failed');
  });

  it('generates Pyodide HTML with worker bootstrap and runtime error plumbing', () => {
    const html = getPyodideHtml();

    expect(html).toContain('new Worker');
    expect(html).toContain('bridge-ready');
    expect(html).toContain('python-runtime-error');
    expect(html).toContain('pyodide.setStdout');
    expect(html).toContain('pyodide.setStderr');
    expect(html).toContain('runtimeId');
    expect(html).toContain('python-dispatch-ack');
    expect(html).toContain('_kavi_execute_inline(');
    expect(html).toContain('_kavi_clear_workspace_modules(workspace_root)');
    expect(html).toContain('__kavi_workflow_bridge__');
    expect(html).toContain('_kavi_http_module = _kavi_types.ModuleType(');
    expect(html).toContain('_kavi_module = _kavi_types.ModuleType(');
    expect(html).toContain('builtins.kavi = _kavi_module');
  });

  it('reuses the cached Pyodide HTML bootstrap string', () => {
    const firstHtml = getPyodideHtml();
    const secondHtml = getPyodideHtml();

    expect(secondHtml).toBe(firstHtml);
  });
});
