let operationTail: Promise<void> = Promise.resolve();
let activeExecutions = 0;
let pendingRecoveries = 0;
let recoveryTail: Promise<void> = Promise.resolve();
const idleWaiters = new Set<() => void>();

export const MAX_CONCURRENT_SCHEDULER_EXECUTIONS = 2;

export function withSchedulerOperationLock<T>(operation: () => Promise<T>): Promise<T> {
  const running = operationTail.then(operation, operation);
  operationTail = running.then(
    () => undefined,
    () => undefined,
  );
  return running;
}

export function resetSchedulerOperationLockForTests(): void {
  operationTail = Promise.resolve();
  activeExecutions = 0;
  pendingRecoveries = 0;
  recoveryTail = Promise.resolve();
  idleWaiters.clear();
}

function waitForExecutionsToSettle(): Promise<void> {
  if (activeExecutions === 0) return Promise.resolve();
  return new Promise((resolve) => idleWaiters.add(resolve));
}

export async function withSchedulerRecoveryBarrier<T>(recovery: () => Promise<T>): Promise<T> {
  pendingRecoveries += 1;
  let result!: T;
  const running = recoveryTail.then(async () => {
    await waitForExecutionsToSettle();
    result = await recovery();
  });
  recoveryTail = running.catch(() => undefined);
  try {
    await running;
    return result;
  } finally {
    pendingRecoveries -= 1;
  }
}

export async function tryWithSchedulerExecutionSlot<T>(
  execution: () => Promise<T>,
): Promise<{ acquired: true; value: T } | { acquired: false; reason: 'recovery' | 'capacity' }> {
  if (pendingRecoveries > 0) return { acquired: false, reason: 'recovery' };
  if (activeExecutions >= MAX_CONCURRENT_SCHEDULER_EXECUTIONS) {
    return { acquired: false, reason: 'capacity' };
  }
  activeExecutions += 1;
  try {
    return { acquired: true, value: await execution() };
  } finally {
    activeExecutions -= 1;
    if (activeExecutions === 0) {
      for (const resolve of idleWaiters) resolve();
      idleWaiters.clear();
    }
  }
}
