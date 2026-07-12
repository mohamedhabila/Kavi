export const APP_BACKGROUND_ABORT_MESSAGE =
  'Scheduled task execution stopped because the app entered the background';

export class ScheduledAppBackgroundAbortReason extends Error {
  constructor() {
    super(APP_BACKGROUND_ABORT_MESSAGE);
    this.name = 'AbortError';
  }
}

export interface ScheduledJobExecutionRegistration {
  controller: AbortController;
  throwIfBackgrounded(): void;
  unregister(): void;
}

export interface ScheduledExecutionContext {
  lifecycleEpoch: number;
}

const activeControllersByJobId = new Map<string, Set<AbortController>>();
let lifecycleEpoch = 0;

function createAppBackgroundAbortReason(): ScheduledAppBackgroundAbortReason {
  return new ScheduledAppBackgroundAbortReason();
}

export function getScheduledExecutionLifecycleEpoch(): number {
  return lifecycleEpoch;
}

export function isScheduledExecutionLifecycleEpochCurrent(epoch: number): boolean {
  return epoch === lifecycleEpoch;
}

export function registerScheduledJobExecution(
  jobId: string,
  expectedEpoch: number,
): ScheduledJobExecutionRegistration {
  const controller = new AbortController();
  const activeControllers = activeControllersByJobId.get(jobId) ?? new Set<AbortController>();
  activeControllers.add(controller);
  activeControllersByJobId.set(jobId, activeControllers);
  if (!isScheduledExecutionLifecycleEpochCurrent(expectedEpoch)) {
    controller.abort(createAppBackgroundAbortReason());
  }

  let registered = true;
  return {
    controller,
    throwIfBackgrounded: () => {
      if (controller.signal.reason instanceof ScheduledAppBackgroundAbortReason) {
        throw controller.signal.reason;
      }
    },
    unregister: () => {
      if (!registered) return;
      registered = false;
      activeControllers.delete(controller);
      if (activeControllers.size === 0) activeControllersByJobId.delete(jobId);
    },
  };
}

export function abortAllScheduledJobExecutions(): number {
  lifecycleEpoch += 1;
  let abortedCount = 0;
  for (const activeControllers of activeControllersByJobId.values()) {
    for (const controller of activeControllers) {
      if (controller.signal.aborted) continue;
      controller.abort(createAppBackgroundAbortReason());
      abortedCount += 1;
    }
  }
  return abortedCount;
}

export function hasActiveScheduledJobExecutions(): boolean {
  for (const controllers of activeControllersByJobId.values()) {
    if (controllers.size > 0) return true;
  }
  return false;
}

export function resetScheduledExecutionLifecycleForTests(): void {
  lifecycleEpoch = 0;
}
