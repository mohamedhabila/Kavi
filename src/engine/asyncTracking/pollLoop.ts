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
  deadlineMs: number;
  now?: AsyncPollClock;
  sleep?: AsyncPollSleep;
}): Promise<T> {
  const now = options.now || Date.now;
  const sleep = options.sleep || sleepAsyncPollInterval;
  let value = options.initialValue;

  while (options.shouldContinue(value) && now() < options.deadlineMs) {
    await sleep(options.pollIntervalMs);
    value = await options.poll();
  }

  return value;
}
