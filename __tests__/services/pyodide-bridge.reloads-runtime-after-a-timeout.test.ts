import { executePython, getPyodideHtml, handlePyodideMessage, isPyodideReady, registerPyodideWebView, reportPyodideRuntimeFailure, unregisterPyodideWebView } from '../../src/services/python/pyodideBridge';

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
