import { performPythonHttpRequest } from './httpBridge';
import type {
  PythonBridgeMessage,
  PythonHttpAbortMessage,
  PythonHttpRequestMessage,
} from './runtimeProtocol';

type SendBridgeMessage = (message: PythonBridgeMessage) => void;

const pendingRequests = new Map<string, AbortController>();

function requestKey(runtimeId: string, requestId: string): string {
  return `${runtimeId}:${requestId}`;
}

export function abortPendingPythonHttpRequests(reason: string): void {
  for (const controller of pendingRequests.values()) {
    controller.abort(reason);
  }
  pendingRequests.clear();
}

export async function handlePythonHttpRequest(
  message: PythonHttpRequestMessage,
  send: SendBridgeMessage,
): Promise<void> {
  if (!message.runtimeId || !message.requestId) {
    return;
  }

  const key = requestKey(message.runtimeId, message.requestId);
  const controller = new AbortController();
  pendingRequests.set(key, controller);

  try {
    const response = await performPythonHttpRequest(message, { signal: controller.signal });
    if (!pendingRequests.has(key)) {
      return;
    }

    send({
      type: 'python-http-response',
      runtimeId: message.runtimeId,
      requestId: message.requestId,
      ...response,
    });
  } catch (error) {
    if (!pendingRequests.has(key) || controller.signal.aborted) {
      return;
    }

    send({
      type: 'python-http-response',
      runtimeId: message.runtimeId,
      requestId: message.requestId,
      error:
        error instanceof Error ? error.message : String(error || 'Python HTTP request failed.'),
    });
  } finally {
    pendingRequests.delete(key);
  }
}

export function handlePythonHttpAbort(message: PythonHttpAbortMessage): void {
  if (!message.runtimeId || !message.requestId) {
    return;
  }

  const key = requestKey(message.runtimeId, message.requestId);
  const controller = pendingRequests.get(key);
  if (!controller) {
    return;
  }

  pendingRequests.delete(key);
  controller.abort(message.reason || 'Python HTTP request was aborted.');
}
