import { getPyodideHtml } from './runtimeBootstrap';
import { performPythonHttpRequest } from './httpBridge';
import {
  getDispatchAcknowledgementTimeoutMs,
  normalizePythonExecutionRequest,
  normalizeWorkspaceFiles,
  unrefTimerIfSupported,
} from './requestNormalization';
import {
  DEFAULT_PYODIDE_STARTUP_TIMEOUT_MS,
  DEFAULT_PYTHON_EXECUTION_TIMEOUT_MS,
  MAX_PYODIDE_DISPATCH_RETRIES,
  PYODIDE_WEBVIEW_BASE_URL,
  PYODIDE_WEBVIEW_BRIDGE_NAME,
  type PythonBridgeMessage,
  type PythonHttpAbortMessage,
  type PythonHttpRequestMessage,
  type PythonRuntimeMessage,
} from './runtimeProtocol';
import type {
  NormalizedPythonExecutionRequest,
  PythonExecutionRequest,
  PythonExecutionResult,
} from './types';
import { normalizePythonWorkflowBridgeResult } from './workflowBridge';

export type {
  PythonExecutionRequest,
  PythonExecutionResult,
  PythonWorkflowBridgeState,
  PythonWorkspaceFile,
} from './types';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
  isSettled: () => boolean;
};

type QueuedExecution = {
  id: string;
  request: NormalizedPythonExecutionRequest;
  resolve: (result: PythonExecutionResult) => void;
  dispatchAttempts: number;
};

type ActiveExecution = {
  entry: QueuedExecution;
  acknowledgementTimer: ReturnType<typeof setTimeout> | null;
  executionTimer: ReturnType<typeof setTimeout> | null;
  hasReceivedAck: boolean;
};

type PythonWebViewRef = {
  injectJavaScript?: (script: string) => void;
  postMessage?: (message: string) => void;
  reload?: () => void;
};

type PyodideMountRequestListener = () => void;

let webViewRef: PythonWebViewRef | null = null;
let pyodideReady = false;
let runtimeError: string | null = null;
let runtimeInstanceId: string | null = null;
let runtimeReadyDeferred: Deferred<void> | null = null;
let mountReadyDeferred: Deferred<void> | null = null;
const queuedExecutions: QueuedExecution[] = [];
let activeExecution: ActiveExecution | null = null;
let drainPromise: Promise<void> | null = null;
let requestId = 0;
const pendingHttpRequests = new Map<string, AbortController>();
const mountRequestListeners = new Set<PyodideMountRequestListener>();

function getPendingHttpRequestKey(runtimeId: string, requestIdValue: string): string {
  return `${runtimeId}:${requestIdValue}`;
}

function abortPendingHttpRequests(reason: string): void {
  for (const controller of pendingHttpRequests.values()) {
    controller.abort(reason);
  }
  pendingHttpRequests.clear();
}

function createDeferred<T>(): Deferred<T> {
  let settled = false;
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  let rejectPromise!: (reason?: unknown) => void;

  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  void promise.catch(() => {});

  return {
    promise,
    resolve: (value) => {
      if (settled) {
        return;
      }
      settled = true;
      resolvePromise(value);
    },
    reject: (reason) => {
      if (settled) {
        return;
      }
      settled = true;
      rejectPromise(reason);
    },
    isSettled: () => settled,
  };
}

function clearActiveExecutionTimers(execution: ActiveExecution): void {
  if (execution.acknowledgementTimer) {
    clearTimeout(execution.acknowledgementTimer);
    execution.acknowledgementTimer = null;
  }

  if (execution.executionTimer) {
    clearTimeout(execution.executionTimer);
    execution.executionTimer = null;
  }
}

function startActiveExecutionTimer(execution: ActiveExecution): void {
  if (execution.executionTimer) {
    return;
  }

  execution.executionTimer = setTimeout(() => {
    handleActiveExecutionTimeout();
  }, execution.entry.request.timeoutMs);
  unrefTimerIfSupported(execution.executionTimer);
}

function startRuntimeBoot(): void {
  abortPendingHttpRequests('Python runtime reloaded.');
  pyodideReady = false;
  runtimeError = null;
  runtimeInstanceId = null;
  runtimeReadyDeferred = createDeferred<void>();
}

function clearExecutionQueueWithError(error: string): void {
  while (queuedExecutions.length > 0) {
    const entry = queuedExecutions.shift();
    entry?.resolve({ success: false, output: '', error });
  }
}

function ensureMountReadyDeferred(): Deferred<void> {
  if (!mountReadyDeferred || mountReadyDeferred.isSettled()) {
    mountReadyDeferred = createDeferred<void>();
  }
  return mountReadyDeferred;
}

function requestPyodideWebViewMount(): void {
  if (webViewRef) {
    return;
  }

  if (mountReadyDeferred && !mountReadyDeferred.isSettled()) {
    return;
  }

  ensureMountReadyDeferred();
  for (const listener of mountRequestListeners) {
    listener();
  }
}

function reloadPyodideRuntime(): void {
  if (!webViewRef) {
    return;
  }

  startRuntimeBoot();
  if (typeof webViewRef.reload === 'function') {
    webViewRef.reload();
  }
}

function buildInjectedBridgeScript(serializedMessage: string): string {
  return [
    '(function() {',
    `  var payload = ${JSON.stringify(serializedMessage)};`,
    `  var bridge = window[${JSON.stringify(PYODIDE_WEBVIEW_BRIDGE_NAME)}];`,
    '  if (bridge && typeof bridge.receive === "function") {',
    '    bridge.receive(payload);',
    '    return;',
    '  }',
    '  try {',
    '    var event = typeof MessageEvent === "function" ? new MessageEvent("message", { data: payload }) : null;',
    '    if (event) {',
    '      window.dispatchEvent(event);',
    '      document.dispatchEvent(event);',
    '    }',
    '  } catch (error) {}',
    '})();',
    'true;',
  ].join('\n');
}

function sendPyodideBridgeMessage(message: PythonBridgeMessage): void {
  if (!webViewRef) {
    throw new Error('Pyodide WebView is not mounted.');
  }

  const serializedMessage = JSON.stringify(message);
  if (typeof webViewRef.postMessage === 'function') {
    webViewRef.postMessage(serializedMessage);
    return;
  }

  if (typeof webViewRef.injectJavaScript === 'function') {
    webViewRef.injectJavaScript(buildInjectedBridgeScript(serializedMessage));
    return;
  }

  throw new Error('Pyodide WebView bridge does not support postMessage or injectJavaScript.');
}

export function reportPyodideRuntimeFailure(reason: string): void {
  const message = reason.trim() || 'Python runtime failed to initialize.';

  abortPendingHttpRequests(message);
  pyodideReady = false;
  runtimeError = message;
  runtimeInstanceId = null;

  if (runtimeReadyDeferred && !runtimeReadyDeferred.isSettled()) {
    runtimeReadyDeferred.reject(new Error(message));
  }

  if (activeExecution) {
    clearActiveExecutionTimers(activeExecution);
    activeExecution.entry.resolve({ success: false, output: '', error: message });
    activeExecution = null;
  }

  clearExecutionQueueWithError(message);
}

async function waitForPyodideReady(): Promise<void> {
  if (!webViewRef) {
    requestPyodideWebViewMount();
    const mountDeferred = ensureMountReadyDeferred();
    let mountTimeout: ReturnType<typeof setTimeout> | null = null;
    try {
      await Promise.race([
        mountDeferred.promise,
        new Promise<never>((_, reject) => {
        mountTimeout = setTimeout(() => {
          mountReadyDeferred = null;
          reject(
            new Error(
              `Python runtime mount timed out after ${DEFAULT_PYODIDE_STARTUP_TIMEOUT_MS}ms.`,
            ),
            );
          }, DEFAULT_PYODIDE_STARTUP_TIMEOUT_MS);
          unrefTimerIfSupported(mountTimeout);
        }),
      ]);
    } finally {
      if (mountTimeout) {
        clearTimeout(mountTimeout);
      }
    }
  }

  if (!webViewRef) {
    throw new Error('Python runtime is not available. The Pyodide WebView did not mount.');
  }

  if (pyodideReady) {
    return;
  }

  if (runtimeError) {
    reloadPyodideRuntime();
  }

  if (!runtimeReadyDeferred) {
    startRuntimeBoot();
  }

  const readyDeferred = runtimeReadyDeferred;
  if (!readyDeferred) {
    throw new Error('Python runtime is not available.');
  }

  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      readyDeferred.promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          const message = `Python runtime startup timed out after ${DEFAULT_PYODIDE_STARTUP_TIMEOUT_MS}ms.`;
          reportPyodideRuntimeFailure(message);
          reject(new Error(message));
        }, DEFAULT_PYODIDE_STARTUP_TIMEOUT_MS);
        unrefTimerIfSupported(timeout);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function handleActiveExecutionDispatchTimeout(): void {
  if (!activeExecution || activeExecution.hasReceivedAck) {
    return;
  }

  const stalledExecution = activeExecution;
  clearActiveExecutionTimers(stalledExecution);
  activeExecution = null;

  if (stalledExecution.entry.dispatchAttempts <= MAX_PYODIDE_DISPATCH_RETRIES) {
    queuedExecutions.unshift(stalledExecution.entry);
    reloadPyodideRuntime();
    void drainExecutionQueue();
    return;
  }

  stalledExecution.entry.resolve({
    success: false,
    output: '',
    error: `Python runtime did not acknowledge the execution request after ${getDispatchAcknowledgementTimeoutMs(stalledExecution.entry.request.timeoutMs)}ms.`,
  });

  reloadPyodideRuntime();
  void drainExecutionQueue();
}

function handleActiveExecutionTimeout(): void {
  if (!activeExecution) {
    return;
  }

  const timedOutExecution = activeExecution;
  clearActiveExecutionTimers(timedOutExecution);
  activeExecution = null;
  timedOutExecution.entry.resolve({
    success: false,
    output: '',
    error: `Python execution timed out after ${timedOutExecution.entry.request.timeoutMs}ms.`,
  });

  reloadPyodideRuntime();
  void drainExecutionQueue();
}

async function drainExecutionQueue(): Promise<void> {
  if (drainPromise) {
    return drainPromise;
  }

  drainPromise = (async () => {
    if (activeExecution || queuedExecutions.length === 0) {
      return;
    }

    try {
      await waitForPyodideReady();
    } catch {
      return;
    }

    if (activeExecution || queuedExecutions.length === 0 || !webViewRef) {
      return;
    }

    const entry = queuedExecutions.shift();
    if (!entry) {
      return;
    }

    const currentExecution: ActiveExecution = {
      entry,
      acknowledgementTimer: setTimeout(() => {
        handleActiveExecutionDispatchTimeout();
      }, getDispatchAcknowledgementTimeoutMs(entry.request.timeoutMs)),
      executionTimer: null,
      hasReceivedAck: false,
    };
    if (currentExecution.acknowledgementTimer) {
      unrefTimerIfSupported(currentExecution.acknowledgementTimer);
    }
    activeExecution = currentExecution;

    try {
      entry.dispatchAttempts += 1;
      sendPyodideBridgeMessage({
        type: 'run-python',
        id: entry.id,
        code: entry.request.code,
        scriptPath: entry.request.scriptPath,
        argv: entry.request.argv,
        files: entry.request.files,
        workingDirectory: entry.request.workingDirectory,
        packages: entry.request.packages,
        indexUrls: entry.request.indexUrls,
        env: entry.request.env,
        ...(entry.request.workflowBridge ? { workflowBridge: entry.request.workflowBridge } : {}),
      });
    } catch (err: unknown) {
      clearActiveExecutionTimers(currentExecution);
      activeExecution = null;

      const message = err instanceof Error ? err.message : String(err);
      entry.resolve({
        success: false,
        output: '',
        error: `Python runtime is not available. ${message}`,
      });
      void drainExecutionQueue();
    }
  })().finally(() => {
    drainPromise = null;
    if (!activeExecution && queuedExecutions.length > 0) {
      void drainExecutionQueue();
    }
  });

  return drainPromise;
}

function acceptRuntimeMessage(message: PythonRuntimeMessage): boolean {
  if (!message.runtimeId || typeof message.runtimeId !== 'string') {
    return false;
  }

  if (message.type === 'bridge-ready') {
    runtimeInstanceId = message.runtimeId;
    return true;
  }

  if (!runtimeInstanceId) {
    runtimeInstanceId = message.runtimeId;
  }

  return runtimeInstanceId === message.runtimeId;
}

async function handlePythonHttpRequest(message: PythonHttpRequestMessage): Promise<void> {
  if (!message.runtimeId || !message.requestId) {
    return;
  }

  const key = getPendingHttpRequestKey(message.runtimeId, message.requestId);
  const controller = new AbortController();
  pendingHttpRequests.set(key, controller);

  try {
    const response = await performPythonHttpRequest(message, { signal: controller.signal });
    if (!pendingHttpRequests.has(key)) {
      return;
    }

    sendPyodideBridgeMessage({
      type: 'python-http-response',
      runtimeId: message.runtimeId,
      requestId: message.requestId,
      ...response,
    });
  } catch (error) {
    if (!pendingHttpRequests.has(key)) {
      return;
    }

    if (controller.signal.aborted) {
      return;
    }

    sendPyodideBridgeMessage({
      type: 'python-http-response',
      runtimeId: message.runtimeId,
      requestId: message.requestId,
      error:
        error instanceof Error ? error.message : String(error || 'Python HTTP request failed.'),
    });
  } finally {
    pendingHttpRequests.delete(key);
  }
}

function handlePythonHttpAbort(message: PythonHttpAbortMessage): void {
  if (!message.runtimeId || !message.requestId) {
    return;
  }

  const key = getPendingHttpRequestKey(message.runtimeId, message.requestId);
  const controller = pendingHttpRequests.get(key);
  if (!controller) {
    return;
  }

  pendingHttpRequests.delete(key);
  controller.abort(message.reason || 'Python HTTP request was aborted.');
}

export function registerPyodideWebView(ref: PythonWebViewRef | null): void {
  webViewRef = ref;
  if (ref) {
    ensureMountReadyDeferred().resolve();
    startRuntimeBoot();
  }
}

export function unregisterPyodideWebView(): void {
  abortPendingHttpRequests('Pyodide WebView was unmounted.');
  webViewRef = null;
  pyodideReady = false;
  runtimeError = null;
  runtimeInstanceId = null;

  if (runtimeReadyDeferred && !runtimeReadyDeferred.isSettled()) {
    runtimeReadyDeferred.reject(new Error('Pyodide WebView was unmounted.'));
  }
  runtimeReadyDeferred = null;

  if (activeExecution) {
    clearActiveExecutionTimers(activeExecution);
    activeExecution.entry.resolve({
      success: false,
      output: '',
      error: 'Pyodide WebView was unmounted.',
    });
    activeExecution = null;
  }

  clearExecutionQueueWithError('Pyodide WebView was unmounted.');
}

export function subscribeToPyodideMountRequests(
  listener: PyodideMountRequestListener,
): () => void {
  mountRequestListeners.add(listener);
  return () => {
    mountRequestListeners.delete(listener);
  };
}

export function isPyodideReady(): boolean {
  return pyodideReady;
}

export function handlePyodideMessage(data: string): void {
  try {
    const message = (typeof data === 'string' ? JSON.parse(data) : data) as PythonRuntimeMessage;
    if (!message || typeof message !== 'object' || typeof message.type !== 'string') {
      return;
    }

    if (
      (message.type === 'python-http-request' || message.type === 'python-http-abort') &&
      !pyodideReady
    ) {
      return;
    }

    if (!acceptRuntimeMessage(message)) {
      return;
    }

    if (message.type === 'pyodide-ready') {
      if (message.error) {
        reportPyodideRuntimeFailure(
          `Python runtime failed to initialize: ${String(message.error)}`,
        );
        return;
      }

      runtimeError = null;
      pyodideReady = true;
      runtimeReadyDeferred?.resolve();
      return;
    }

    if (message.type === 'python-runtime-error') {
      reportPyodideRuntimeFailure(String(message.error || 'Python runtime failed unexpectedly.'));
      return;
    }

    if (message.type === 'python-http-request') {
      void handlePythonHttpRequest(message);
      return;
    }

    if (message.type === 'python-http-abort') {
      handlePythonHttpAbort(message);
      return;
    }

    if (message.type === 'python-dispatch-ack' && message.id) {
      const currentExecution = activeExecution;
      if (!currentExecution || currentExecution.entry.id !== message.id) {
        return;
      }

      if (!currentExecution.hasReceivedAck) {
        currentExecution.hasReceivedAck = true;
        if (currentExecution.acknowledgementTimer) {
          clearTimeout(currentExecution.acknowledgementTimer);
          currentExecution.acknowledgementTimer = null;
        }
        startActiveExecutionTimer(currentExecution);
      }
      return;
    }

    if (message.type === 'python-result' && message.id) {
      const currentExecution = activeExecution;
      if (!currentExecution || currentExecution.entry.id !== message.id) {
        return;
      }

      clearActiveExecutionTimers(currentExecution);
      const completedExecution = currentExecution.entry;
      activeExecution = null;
      completedExecution.resolve({
        success: !message.error,
        output: message.output ?? '',
        error: message.error,
        durationMs: message.durationMs,
        files: normalizeWorkspaceFiles(message.files),
        ...(normalizePythonWorkflowBridgeResult(message.workflowBridge)
          ? { workflowBridge: normalizePythonWorkflowBridgeResult(message.workflowBridge) }
          : {}),
      });
      void drainExecutionQueue();
    }
  } catch {
    // Ignore non-JSON or unrelated messages.
  }
}

export async function executePython(
  request: PythonExecutionRequest,
): Promise<PythonExecutionResult> {
  const normalized = normalizePythonExecutionRequest(request);
  if (normalized.error || !normalized.request) {
    return {
      success: false,
      output: '',
      error: normalized.error || 'Python execution request is invalid.',
    };
  }

  const normalizedRequest = normalized.request;

  const id = `py-${++requestId}`;

  return new Promise<PythonExecutionResult>((resolve) => {
    requestPyodideWebViewMount();
    queuedExecutions.push({
      id,
      request: normalizedRequest,
      resolve,
      dispatchAttempts: 0,
    });

    void drainExecutionQueue();
  });
}

export {
  DEFAULT_PYODIDE_STARTUP_TIMEOUT_MS,
  DEFAULT_PYTHON_EXECUTION_TIMEOUT_MS,
  PYODIDE_WEBVIEW_BASE_URL,
  PYODIDE_WEBVIEW_BRIDGE_NAME,
  getPyodideHtml,
};
