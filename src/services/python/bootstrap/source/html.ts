import { PYODIDE_RESULT_CACHE_LIMIT, PYODIDE_WEBVIEW_BRIDGE_NAME } from '../../runtimeProtocol';

export function buildPyodideHtml(workerSource: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body>
<script>
(function() {
  var runtimeId = 'py-runtime-' + Math.random().toString(36).slice(2);
  var completedResultsById = Object.create(null);
  var completedResultIds = [];
  var activeRequestIds = Object.create(null);
  var pendingNativeMessages = [];
  var nativeMessageFlushTimer = null;
  var worker = null;

  function canPostMessageToNative() {
    return !!(window.ReactNativeWebView && typeof window.ReactNativeWebView.postMessage === 'function');
  }

  function decorateMessage(msg) {
    var base = msg && typeof msg === 'object' ? msg : { type: 'python-runtime-error', error: 'Invalid runtime message.' };
    if (!base.runtimeId) {
      base.runtimeId = runtimeId;
    }
    return base;
  }

  function flushPendingNativeMessages() {
    if (!canPostMessageToNative()) {
      return false;
    }

    while (pendingNativeMessages.length > 0) {
      window.ReactNativeWebView.postMessage(pendingNativeMessages.shift());
    }

    if (nativeMessageFlushTimer != null) {
      clearInterval(nativeMessageFlushTimer);
      nativeMessageFlushTimer = null;
    }

    return true;
  }

  function scheduleNativeMessageFlush() {
    if (nativeMessageFlushTimer != null) {
      return;
    }

    nativeMessageFlushTimer = setInterval(function() {
      flushPendingNativeMessages();
    }, 50);
  }

  function sendMessage(msg) {
    var serialized = JSON.stringify(decorateMessage(msg));
    if (canPostMessageToNative()) {
      window.ReactNativeWebView.postMessage(serialized);
      return;
    }

    pendingNativeMessages.push(serialized);
    scheduleNativeMessageFlush();
  }

  function cacheCompletedResult(resultMessage) {
    if (!resultMessage || !resultMessage.id) {
      return;
    }

    completedResultsById[resultMessage.id] = resultMessage;
    completedResultIds.push(resultMessage.id);
    if (completedResultIds.length > ${PYODIDE_RESULT_CACHE_LIMIT}) {
      var evictedId = completedResultIds.shift();
      if (evictedId) {
        delete completedResultsById[evictedId];
      }
    }
  }

  function sendPythonResult(resultMessage) {
    cacheCompletedResult(resultMessage);
    sendMessage(resultMessage);
  }

  function formatError(error) {
    return error && error.message ? error.message : String(error);
  }

  function clearActiveRequest(id) {
    if (id && activeRequestIds[id]) {
      delete activeRequestIds[id];
    }
  }

  function handleWorkerMessage(event) {
    var message = event && event.data ? event.data : null;
    if (!message || typeof message !== 'object') {
      return;
    }

    if (message.type === 'python-result' && message.id) {
      clearActiveRequest(message.id);
      sendPythonResult(message);
      return;
    }

    if (message.type === 'pyodide-ready') {
      sendMessage(message);
      return;
    }

    sendMessage(message);
  }

  function handleWorkerFailure(prefix, error) {
    sendMessage({
      type: 'python-runtime-error',
      error: prefix + ': ' + formatError(error),
    });
  }

  function createWorker() {
    try {
      var sourceUrl = URL.createObjectURL(new Blob([${JSON.stringify(workerSource)}], { type: 'text/javascript' }));
      worker = new Worker(sourceUrl);
      URL.revokeObjectURL(sourceUrl);
      worker.onmessage = handleWorkerMessage;
      worker.onerror = function(event) {
        handleWorkerFailure('Pyodide worker failed', event && event.message ? event.message : event);
      };
      worker.onmessageerror = function(event) {
        handleWorkerFailure('Pyodide worker message error', event && event.data ? event.data : 'messageerror');
      };
    } catch (error) {
      sendMessage({ type: 'pyodide-ready', error: 'Pyodide worker could not be created: ' + formatError(error) });
    }
  }

  function forwardRunMessage(message) {
    if (completedResultsById[message.id]) {
      sendMessage({ type: 'python-dispatch-ack', id: message.id, duplicate: true });
      sendMessage(completedResultsById[message.id]);
      return;
    }

    if (activeRequestIds[message.id]) {
      sendMessage({ type: 'python-dispatch-ack', id: message.id, duplicate: true });
      return;
    }

    activeRequestIds[message.id] = true;
    sendMessage({ type: 'python-dispatch-ack', id: message.id });
    if (!worker) {
      clearActiveRequest(message.id);
      sendPythonResult({
        type: 'python-result',
        id: message.id,
        output: '',
        error: 'Pyodide worker is not available.',
      });
      return;
    }

    worker.postMessage(message);
  }

  function handleMessage(data) {
    try {
      var message = typeof data === 'string' ? JSON.parse(data) : data;
      if (message.type === 'run-python' && message.id) {
        forwardRunMessage(message);
        return;
      }
      if (message.type === 'python-http-response' && message.requestId && worker) {
        worker.postMessage(message);
      }
    } catch (error) {
      // Ignore malformed bridge messages.
    }
  }

  window[${JSON.stringify(PYODIDE_WEBVIEW_BRIDGE_NAME)}] = {
    receive: handleMessage,
  };

  document.addEventListener('message', function(event) { handleMessage(event.data); });
  window.addEventListener('message', function(event) { handleMessage(event.data); });
  window.addEventListener('load', function() { flushPendingNativeMessages(); });
  window.addEventListener('pageshow', function() { flushPendingNativeMessages(); });
  window.addEventListener('error', function(event) {
    handleWorkerFailure('Pyodide page error', event && event.message ? event.message : event);
  });
  window.addEventListener('unhandledrejection', function(event) {
    var reason = event && 'reason' in event ? event.reason : event;
    handleWorkerFailure('Pyodide page unhandled rejection', reason);
  });
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible') {
      flushPendingNativeMessages();
    }
  });

  createWorker();
  sendMessage({ type: 'bridge-ready' });
})();
</script>
</body>
</html>`;
}
