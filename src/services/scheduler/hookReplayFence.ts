import { getRegisteredEventKeys } from '../events/bus';
import { persistAttemptMutation, type PersistedMutationResult } from './attemptRecovery';
import type { useSchedulerStore } from './store';

const UNJOURNALED_SCHEDULED_HOOK_EVENTS = ['agent', 'command', 'scheduler', 'session'] as const;

function hasUnjournaledScheduledHookRisk(): boolean {
  return getRegisteredEventKeys().some((eventKey) =>
    UNJOURNALED_SCHEDULED_HOOK_EVENTS.some(
      (eventType) => eventKey === eventType || eventKey.startsWith(`${eventType}:`),
    ),
  );
}

export function fenceUnjournaledScheduledHooks(
  store: ReturnType<typeof useSchedulerStore.getState>,
  jobId: string,
  attemptId: string,
): Promise<PersistedMutationResult | { status: 'not_required' }> {
  if (!hasUnjournaledScheduledHookRisk()) return Promise.resolve({ status: 'not_required' });
  const previousRisk = store.getJob(jobId)?.runningEffectRisk;
  if (!previousRisk) return Promise.resolve({ status: 'not_owned' });
  return persistAttemptMutation(
    () => store.markRunningAttemptEffectUnsafe(jobId, attemptId),
    () => store.restoreRunningAttemptEffectRisk(jobId, attemptId, previousRisk),
  );
}
