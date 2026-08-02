import { AppState } from 'react-native';

function isRenderTimerSuspendedAppState(state: string | null | undefined): boolean {
  return state === 'background' || state === 'inactive';
}

/**
 * React Native render-driven timers can stop advancing after the host activity pauses.
 * Use a microtask while backgrounded so bounded consistency checks and orchestration
 * yields cannot suspend user-started work indefinitely. Callers remain responsible for
 * enforcing their logical wait budget.
 */
export function waitForAppStateAwareDelay(delayMs: number): Promise<void> {
  if (isRenderTimerSuspendedAppState(AppState.currentState)) {
    return new Promise<void>((resolve) => queueMicrotask(resolve));
  }
  return new Promise<void>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let subscription: ReturnType<typeof AppState.addEventListener> | undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      subscription?.remove();
      resolve();
    };
    const finishIfTimersSuspend = (state: string | null | undefined) => {
      if (isRenderTimerSuspendedAppState(state)) queueMicrotask(finish);
    };

    subscription = AppState.addEventListener('change', finishIfTimersSuspend);
    // Close the check-to-subscribe race if the host paused between the first
    // state read and listener registration.
    if (isRenderTimerSuspendedAppState(AppState.currentState)) {
      queueMicrotask(finish);
      return;
    }
    timer = setTimeout(finish, delayMs);
  });
}
