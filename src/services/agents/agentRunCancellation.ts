const DEFAULT_ABORT_MESSAGE = 'Request cancelled';

type AgentRunOperationControllerParams = {
  conversationId: string;
  runId: string;
  operationId: string;
  parentSignal?: AbortSignal;
};

export type AgentRunOperationControllerHandle = {
  controller: AbortController;
  signal: AbortSignal;
  dispose: () => void;
};

const cancelledRunReasons = new Map<string, Error>();
const runOperationControllers = new Map<string, Map<string, AbortController>>();

function buildAgentRunKey(conversationId: string, runId: string): string {
  return `${conversationId.trim()}::${runId.trim()}`;
}

function normalizeAbortMessage(reason: unknown): string {
  if (reason instanceof Error) {
    return reason.message?.trim() || DEFAULT_ABORT_MESSAGE;
  }

  if (typeof reason === 'string' && reason.trim().length > 0) {
    return reason.trim();
  }

  return DEFAULT_ABORT_MESSAGE;
}

function toAbortError(reason?: unknown): Error {
  if (reason instanceof Error && reason.name === 'AbortError') {
    return reason;
  }

  const abortError = new Error(normalizeAbortMessage(reason));
  abortError.name = 'AbortError';

  if (reason instanceof Error) {
    (abortError as Error & { cause?: unknown }).cause = reason;
  }

  return abortError;
}

function abortController(controller: AbortController, reason?: unknown): void {
  if (controller.signal.aborted) {
    return;
  }

  const abortReason = toAbortError(reason);
  try {
    controller.abort(abortReason);
  } catch {
    controller.abort();
  }
}

export function isAbortErrorLike(error: unknown, signal?: AbortSignal | null): boolean {
  if (signal?.aborted) {
    return true;
  }

  if (signal?.reason && error === signal.reason) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  if (error.name === 'AbortError') {
    return true;
  }

  const normalizedMessage = error.message.trim();
  return (
    normalizedMessage === DEFAULT_ABORT_MESSAGE ||
    normalizedMessage === 'Aborted' ||
    normalizedMessage === 'The operation was aborted.' ||
    normalizedMessage === 'This operation was aborted'
  );
}

export function throwIfAbortSignalTriggered(signal?: AbortSignal | null): void {
  if (!signal?.aborted) {
    return;
  }

  const abortSignal = signal as AbortSignal & { throwIfAborted?: () => void };
  if (typeof abortSignal.throwIfAborted === 'function') {
    try {
      abortSignal.throwIfAborted();
      return;
    } catch (error) {
      throw toAbortError(error ?? signal.reason);
    }
  }

  throw toAbortError(signal.reason);
}

export function clearAgentRunCancellation(conversationId: string, runId: string): void {
  const normalizedConversationId = conversationId.trim();
  const normalizedRunId = runId.trim();
  if (!normalizedConversationId || !normalizedRunId) {
    return;
  }

  cancelledRunReasons.delete(buildAgentRunKey(normalizedConversationId, normalizedRunId));
}

export function cancelAgentRunOperations(
  conversationId: string,
  runId: string,
  reason?: unknown,
): Error | undefined {
  const normalizedConversationId = conversationId.trim();
  const normalizedRunId = runId.trim();
  if (!normalizedConversationId || !normalizedRunId) {
    return undefined;
  }

  const runKey = buildAgentRunKey(normalizedConversationId, normalizedRunId);
  const abortReason = toAbortError(reason);
  cancelledRunReasons.set(runKey, abortReason);

  const operations = runOperationControllers.get(runKey);
  if (operations) {
    for (const controller of operations.values()) {
      abortController(controller, abortReason);
    }
    runOperationControllers.delete(runKey);
  }

  return abortReason;
}

export function createAgentRunOperationController(
  params: AgentRunOperationControllerParams,
): AgentRunOperationControllerHandle {
  const normalizedConversationId = params.conversationId.trim();
  const normalizedRunId = params.runId.trim();
  const normalizedOperationId = params.operationId.trim();
  const runKey = buildAgentRunKey(normalizedConversationId, normalizedRunId);
  const controller = new AbortController();
  const operations = runOperationControllers.get(runKey) ?? new Map<string, AbortController>();

  if (!runOperationControllers.has(runKey)) {
    runOperationControllers.set(runKey, operations);
  }

  const existingController = operations.get(normalizedOperationId);
  if (existingController) {
    abortController(existingController, `Superseded run operation: ${normalizedOperationId}`);
  }
  operations.set(normalizedOperationId, controller);

  const cancelledReason = cancelledRunReasons.get(runKey);
  if (cancelledReason) {
    abortController(controller, cancelledReason);
  }

  const parentSignal = params.parentSignal;
  let removeParentListener: (() => void) | undefined;
  if (parentSignal) {
    if (parentSignal.aborted) {
      abortController(controller, parentSignal.reason);
    } else {
      const onAbort = () => {
        abortController(controller, parentSignal.reason);
      };
      parentSignal.addEventListener('abort', onAbort, { once: true });
      removeParentListener = () => {
        parentSignal.removeEventListener('abort', onAbort);
      };
    }
  }

  let disposed = false;
  return {
    controller,
    signal: controller.signal,
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      removeParentListener?.();

      const activeOperations = runOperationControllers.get(runKey);
      if (!activeOperations) {
        return;
      }

      if (activeOperations.get(normalizedOperationId) === controller) {
        activeOperations.delete(normalizedOperationId);
      }

      if (activeOperations.size === 0) {
        runOperationControllers.delete(runKey);
      }
    },
  };
}

export function __resetAgentRunCancellationRegistryForTests(): void {
  for (const operations of runOperationControllers.values()) {
    for (const controller of operations.values()) {
      abortController(controller, 'Resetting agent-run cancellation registry for tests.');
    }
  }

  runOperationControllers.clear();
  cancelledRunReasons.clear();
}
