import type { CronJob, DeliveryMode } from '../../src/services/cron/types';

export function claimedSchedulerJob(
  name: string,
  prompt: string,
  options: { deliveryMode?: DeliveryMode } = {},
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
    payload: { prompt },
    runningAttemptId: `attempt-${slug}`,
    runningOccurrenceId: `occurrence-${slug}`,
    runningStartedAtMs: 1,
    runningDefinitionRevision: 1,
    runningAttemptNumber: 1,
    runningEffectRisk: 'safe',
    ...(options.deliveryMode ? { delivery: { mode: options.deliveryMode } } : {}),
  };
}
