// ---------------------------------------------------------------------------
// Kavi — Provider embedding call rate limiter
// ---------------------------------------------------------------------------
// A tiny shared pacer for batched, off-hot-path provider embedding calls
// (fact and episode backfill). Enforces a minimum interval between
// successive provider round trips so a large backlog cannot burst past a
// provider's rate limit. Deliberately process-local and dependency-free —
// this only spaces out sequential awaits within one batch loop.
// ---------------------------------------------------------------------------

export const PROVIDER_EMBEDDING_MINIMUM_CALL_INTERVAL_MS = 120;

let lastCallStartedAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
  });
}

/** Reset pacing state between tests so one suite's timing cannot leak into another. */
export function resetProviderEmbeddingRateLimiterForTests(): void {
  lastCallStartedAt = 0;
}

/** Await `fn` no sooner than `PROVIDER_EMBEDDING_MINIMUM_CALL_INTERVAL_MS` after the previous call. */
export async function throttledProviderEmbeddingCall<T>(fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const wait = Math.max(0, lastCallStartedAt + PROVIDER_EMBEDDING_MINIMUM_CALL_INTERVAL_MS - now);
  if (wait > 0) await sleep(wait);
  lastCallStartedAt = Date.now();
  return fn();
}
