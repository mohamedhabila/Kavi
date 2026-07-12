import type { CronJob, DeliveryMode, SessionTarget, WakeMode } from '../../src/services/cron/types';
import type { ConversationMode } from '../../src/types/conversation';

export function claimedSchedulerJob(
  name: string,
  prompt: string,
  options: {
    mode?: ConversationMode;
    sessionTarget?: SessionTarget;
    wakeMode?: WakeMode;
    deliveryMode?: DeliveryMode;
  } = {},
): CronJob {
  const slug = name.toLowerCase().replace(/\s+/g, '-');
  return {
    id: `job-${slug}`,
    definitionRevision: 1,
    name,
    enabled: true,
    createdAtMs: 1,
    updatedAtMs: 1,
    schedule: { kind: 'every', everyMs: 60_000 },
    payload: { prompt, mode: options.mode ?? 'agentic' },
    sessionTarget: options.sessionTarget ?? 'isolated',
    wakeMode: options.wakeMode ?? 'new',
    runningAttemptId: `attempt-${slug}`,
    runningOccurrenceId: `occurrence-${slug}`,
    runningStartedAtMs: 1,
    runningDefinitionRevision: 1,
    runningAttemptNumber: 1,
    runningEffectRisk: 'safe',
    ...(options.deliveryMode ? { delivery: { mode: options.deliveryMode } } : {}),
  };
}
