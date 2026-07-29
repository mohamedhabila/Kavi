type AsyncPollClock = () => number;
type AsyncPollSleep = (ms: number) => Promise<void>;

export function sleepAsyncPollInterval(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function runAsyncPollLoop<T>(options: {
  initialValue: T;
  shouldContinue: (value: T) => boolean;
  poll: () => Promise<T>;
  pollIntervalMs: number;
  maxPollIntervalMs?: number;
  backoffFactor?: number;
  deadlineMs: number;
  now?: AsyncPollClock;
  sleep?: AsyncPollSleep;
}): Promise<T> {
  const now = options.now || Date.now;
  const sleep = options.sleep || sleepAsyncPollInterval;
  if (!Number.isFinite(options.pollIntervalMs) || options.pollIntervalMs <= 0) {
    throw new RangeError('async_poll_interval_invalid');
  }
  const maxPollIntervalMs = options.maxPollIntervalMs ?? options.pollIntervalMs;
  if (!Number.isFinite(maxPollIntervalMs) || maxPollIntervalMs < options.pollIntervalMs) {
    throw new RangeError('async_poll_max_interval_invalid');
  }
  const backoffFactor = options.backoffFactor ?? 1;
  if (!Number.isFinite(backoffFactor) || backoffFactor < 1) {
    throw new RangeError('async_poll_backoff_factor_invalid');
  }
  if (!Number.isFinite(options.deadlineMs)) {
    throw new RangeError('async_poll_deadline_invalid');
  }
  let value = options.initialValue;
  let nextIntervalMs = options.pollIntervalMs;

  while (options.shouldContinue(value)) {
    const remainingMs = options.deadlineMs - now();
    if (remainingMs <= 0) break;
    await sleep(Math.min(nextIntervalMs, remainingMs));
    if (now() >= options.deadlineMs) break;
    value = await options.poll();
    nextIntervalMs = Math.min(maxPollIntervalMs, Math.ceil(nextIntervalMs * backoffFactor));
  }

  return value;
}
