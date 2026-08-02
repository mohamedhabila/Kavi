import { createAgentRunAbortError } from '../../services/runtimeError';

export const MODEL_TURN_INACTIVITY_TIMEOUT_MS = 15 * 60_000;

export type ModelTurnActivityGuard = {
  signal: AbortSignal;
  didTimeOut(): boolean;
  markActivity(): void;
  dispose(): void;
};

export function createModelTurnActivityGuard(parentSignal?: AbortSignal): ModelTurnActivityGuard {
  const controller = new AbortController();
  let timedOut = false;
  let activityDeadline = Date.now() + MODEL_TURN_INACTIVITY_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const scheduleDeadline = () => {
    if (controller.signal.aborted) return;
    const remainingMs = Math.max(0, activityDeadline - Date.now());
    timer = setTimeout(() => {
      timer = undefined;
      if (controller.signal.aborted) return;
      if (Date.now() < activityDeadline) {
        scheduleDeadline();
        return;
      }
      timedOut = true;
      controller.abort();
    }, remainingMs);
    (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
  };
  const handleParentAbort = () => controller.abort();
  parentSignal?.addEventListener('abort', handleParentAbort, { once: true });
  if (parentSignal?.aborted) {
    controller.abort();
  } else {
    scheduleDeadline();
  }

  return {
    signal: controller.signal,
    didTimeOut: () => timedOut,
    markActivity: () => {
      if (!controller.signal.aborted) {
        activityDeadline = Date.now() + MODEL_TURN_INACTIVITY_TIMEOUT_MS;
      }
    },
    dispose: () => {
      if (timer !== undefined) clearTimeout(timer);
      parentSignal?.removeEventListener('abort', handleParentAbort);
    },
  };
}

export function normalizeModelTurnActivityError(
  error: unknown,
  guard: ModelTurnActivityGuard,
): Error {
  if (guard.didTimeOut()) {
    const timeoutError = new Error(
      `Model response timed out after ${MODEL_TURN_INACTIVITY_TIMEOUT_MS}ms without provider activity.`,
    );
    timeoutError.name = 'ModelTurnInactivityTimeoutError';
    return timeoutError;
  }
  return error instanceof Error ? error : new Error(String(error));
}

export async function waitForPromiseOrAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) throw createAgentRunAbortError('Request cancelled');
  let settled = false;
  let onAbort: (() => void) | undefined;
  const guardedPromise = Promise.resolve(promise).finally(() => {
    settled = true;
    if (onAbort) signal.removeEventListener('abort', onAbort);
  });
  const abortPromise = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      if (!settled) guardedPromise.catch(() => undefined);
      reject(createAgentRunAbortError('Request cancelled'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  return Promise.race([guardedPromise, abortPromise]);
}
