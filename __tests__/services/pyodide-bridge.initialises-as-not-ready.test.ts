import { executePython, handlePyodideMessage, isPyodideReady, registerPyodideWebView, subscribeToPyodideMountRequests, unregisterPyodideWebView } from '../../src/services/python/pyodideBridge';

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
  it('requests a lazy mount when execution starts before the WebView is mounted', async () => {
    unregisterPyodideWebView();
    const onMountRequest = jest.fn();
    const unsubscribe = subscribeToPyodideMountRequests(onMountRequest);

    const resultPromise = executePython({ code: 'print("hi")', timeoutMs: 200 });
    await flushAsyncWork();

    expect(onMountRequest).toHaveBeenCalledTimes(1);
    expect(mockPostMessage).not.toHaveBeenCalled();

    registerPyodideWebView({
      injectJavaScript: mockInjectJavaScript,
      postMessage: mockPostMessage,
      reload: mockReload,
    });
    bootRuntime();
    await flushAsyncWork();

    expect(mockPostMessage).toHaveBeenCalledTimes(1);
    const sent = getPostedPayload();
    handlePyodideMessage(
      JSON.stringify({ type: 'python-result', runtimeId: 'rt-1', id: sent.id, output: 'hi\n' }),
    );

    await expect(resultPromise).resolves.toMatchObject({
      success: true,
      output: 'hi\n',
    });

    unsubscribe();
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
});
