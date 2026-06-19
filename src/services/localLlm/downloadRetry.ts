import { unrefTimerIfSupported } from '../../utils/timers';
import {
  LOCAL_LLM_DOWNLOAD_CANCELLED_ERROR_PATTERN,
  LOCAL_LLM_DOWNLOAD_RETRY_BASE_MS,
  LOCAL_LLM_DOWNLOAD_RETRY_JITTER_RATIO,
  LOCAL_LLM_DOWNLOAD_RETRY_MAX_MS,
  LOCAL_LLM_DOWNLOAD_RETRYABLE_ERROR_PATTERN,
  LOCAL_LLM_DOWNLOAD_RETRYABLE_STATUS_CODES,
} from './constants';

export function getLocalLlmDownloadErrorMessage(error: unknown): string {
  if (
    error instanceof Error &&
    typeof error.message === 'string' &&
    error.message.trim().length > 0
  ) {
    return error.message.trim();
  }
  return String(error ?? 'Unknown error');
}

export function isRetryableLocalLlmDownloadStatus(status: number): boolean {
  return LOCAL_LLM_DOWNLOAD_RETRYABLE_STATUS_CODES.has(status);
}

export function isCancelledLocalLlmDownloadError(error: unknown): boolean {
  return LOCAL_LLM_DOWNLOAD_CANCELLED_ERROR_PATTERN.test(getLocalLlmDownloadErrorMessage(error));
}

export function isRetryableLocalLlmDownloadError(error: unknown): boolean {
  if (isCancelledLocalLlmDownloadError(error)) {
    return false;
  }

  const message = getLocalLlmDownloadErrorMessage(error);
  const statusMatch = message.match(/status\s+(\d{3})/i);
  if (statusMatch) {
    const parsedStatus = Number(statusMatch[1]);
    if (Number.isFinite(parsedStatus)) {
      return isRetryableLocalLlmDownloadStatus(parsedStatus);
    }
  }

  return LOCAL_LLM_DOWNLOAD_RETRYABLE_ERROR_PATTERN.test(message);
}

export function createLocalLlmDownloadRetryLimitError(modelId: string, error: unknown): Error {
  const lastError = getLocalLlmDownloadErrorMessage(error);
  const retryLimitError = new Error(
    `Download for ${modelId} failed after repeated transient network interruptions. Partial progress was preserved when safe; retry again when the connection is stable. Last error: ${lastError}`,
  );

  if (typeof retryLimitError.stack === 'string') {
    retryLimitError.stack = retryLimitError.stack.split('\n', 1)[0];
  }

  return retryLimitError;
}

export function getLocalLlmDownloadRetryDelayMs(consecutiveFailures: number): number {
  const exponentialDelay = Math.min(
    LOCAL_LLM_DOWNLOAD_RETRY_MAX_MS,
    LOCAL_LLM_DOWNLOAD_RETRY_BASE_MS * 2 ** Math.max(0, consecutiveFailures - 1),
  );
  const jitterWindow = Math.max(
    0,
    Math.floor(exponentialDelay * LOCAL_LLM_DOWNLOAD_RETRY_JITTER_RATIO),
  );
  const jitter = jitterWindow > 0 ? Math.floor(Math.random() * (jitterWindow + 1)) : 0;
  return exponentialDelay + jitter;
}

export function waitForLocalLlmDownloadRetry(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    unrefTimerIfSupported(timer);
  });
}
