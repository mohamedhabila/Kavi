// ---------------------------------------------------------------------------
// Kavi — Web Shared Utilities
// ---------------------------------------------------------------------------

import { unrefTimerIfSupported } from '../../utils/timers';

export type CacheEntry<T> = {
  value: T;
  expiresAt: number;
  insertedAt: number;
};

export type TimeoutHandle = {
  signal: AbortSignal;
  dispose: () => void;
};

export const DEFAULT_TIMEOUT_SECONDS = 30;
export const DEFAULT_CACHE_TTL_MINUTES = 15;
const DEFAULT_CACHE_MAX_ENTRIES = 100;

export function resolveTimeoutSeconds(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(1, Math.floor(parsed));
}

export function resolveCacheTtlMs(value: unknown, fallbackMinutes: number): number {
  const minutes =
    typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : fallbackMinutes;
  return Math.round(minutes * 60_000);
}

export function normalizeCacheKey(value: string): string {
  return value.trim().toLowerCase();
}

export function readCache<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
): { value: T; cached: boolean } | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return { value: entry.value, cached: true };
}

export function writeCache<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  value: T,
  ttlMs: number,
): void {
  if (ttlMs <= 0) return;
  if (cache.size >= DEFAULT_CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
    insertedAt: Date.now(),
  });
}

export function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): TimeoutHandle {
  if (timeoutMs <= 0) {
    return {
      signal: signal ?? new AbortController().signal,
      dispose: () => {},
    };
  }

  const controller = new AbortController();
  let disposed = false;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', abortFromParent);
    controller.signal.removeEventListener('abort', dispose);
  };

  const abortFromParent = () => {
    dispose();
    if (!controller.signal.aborted) controller.abort();
  };

  const abortFromTimeout = () => {
    dispose();
    if (!controller.signal.aborted) controller.abort();
  };

  const timer = setTimeout(abortFromTimeout, timeoutMs);
  unrefTimerIfSupported(timer);

  if (signal) {
    if (signal.aborted) {
      abortFromParent();
    } else {
      signal.addEventListener('abort', abortFromParent, { once: true });
    }
  }

  controller.signal.addEventListener('abort', dispose, { once: true });

  return {
    signal: controller.signal,
    dispose,
  };
}

export function isAbortLikeTransportError(error: unknown): boolean {
  if (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError') {
    return true;
  }

  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';
  return /\babort(ed|error)?\b/i.test(message) || /\btime(?:d)?\s*out\b/i.test(message);
}

export async function runWithTimeoutRetries<T>(params: {
  attempts: number;
  operation: (signal: AbortSignal, attempt: number) => Promise<T>;
  shouldRetry: (error: unknown) => boolean;
  signal?: AbortSignal;
  timeoutSeconds: number;
}): Promise<T> {
  const attempts = Math.max(1, Math.floor(params.attempts));
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const timeout = withTimeout(
      params.signal,
      resolveTimeoutSeconds(params.timeoutSeconds, DEFAULT_TIMEOUT_SECONDS) * 1000,
    );
    try {
      return await params.operation(timeout.signal, attempt);
    } catch (error: unknown) {
      lastError = error;
      if (attempt >= attempts || !params.shouldRetry(error)) {
        throw error;
      }
    } finally {
      timeout.dispose();
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Operation failed');
}

export async function readResponseText(
  res: Response,
  options?: { maxBytes?: number },
): Promise<{ text: string; truncated: boolean; bytesRead: number }> {
  const maxBytes = options?.maxBytes;

  if (maxBytes && maxBytes > 0) {
    // Try streaming read with limit
    try {
      const text = await res.text();
      if (text.length > maxBytes) {
        return { text: text.slice(0, maxBytes), truncated: true, bytesRead: maxBytes };
      }
      return { text, truncated: false, bytesRead: text.length };
    } catch {
      return { text: '', truncated: false, bytesRead: 0 };
    }
  }

  try {
    const text = await res.text();
    return { text, truncated: false, bytesRead: text.length };
  } catch {
    return { text: '', truncated: false, bytesRead: 0 };
  }
}
