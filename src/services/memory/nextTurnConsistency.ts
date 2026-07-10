import { getIngestionJobForSourceTurn } from './ingestionQueueStore';
import type { IngestionJob, IngestionJobStatus } from './ingestionQueueStore';
import { canReadLongTermMemory } from './policy';

export const NEXT_TURN_MEMORY_CONSISTENCY_BUDGET_MS = 120;
export const NEXT_TURN_MEMORY_CONSISTENCY_INITIAL_BACKOFF_MS = 8;
export const NEXT_TURN_MEMORY_CONSISTENCY_MAX_BACKOFF_MS = 32;

export type NextTurnMemoryConsistencyOutcome =
  | 'opt_out'
  | 'no_job'
  | 'completed'
  | 'degraded'
  | 'timed_out';

export type NextTurnMemoryConsistencyResult = Readonly<{
  outcome: NextTurnMemoryConsistencyOutcome;
  durationMs: number;
  waitedMs: number;
  queryCount: number;
  matchedJobCount: 0 | 1;
  queueAgeMs: number | null;
  initialJobStatus: IngestionJobStatus | null;
  finalJobStatus: IngestionJobStatus | null;
}>;

export type NextTurnMemoryConsistencyClock = Readonly<{
  now: () => number;
  wait: (delayMs: number) => Promise<void>;
}>;

export type NextTurnMemoryConsistencyInput = Readonly<{
  memoryConversationId: string;
  sourceThreadId: string;
  sourceEndMessageId: string | null;
  clock?: NextTurnMemoryConsistencyClock;
}>;

const DEFAULT_CLOCK: NextTurnMemoryConsistencyClock = {
  now: () => Date.now(),
  wait: (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
};

type JobDisposition = 'completed' | 'degraded' | 'wait';

function classifyJob(job: IngestionJob, now: number): JobDisposition {
  if (job.status === 'completed_structural' || job.status === 'completed_enriched') {
    return 'completed';
  }
  if (job.status === 'degraded' || job.status === 'failed') {
    return 'degraded';
  }
  if (job.structuralCompletedAt !== null) {
    return 'completed';
  }
  if (job.status === 'processing') {
    return job.leaseExpiresAt !== null && job.leaseExpiresAt <= now ? 'degraded' : 'wait';
  }
  return job.nextAttemptAt !== null && job.nextAttemptAt <= now ? 'wait' : 'degraded';
}

export async function waitForNextTurnMemoryConsistency(
  input: NextTurnMemoryConsistencyInput,
): Promise<NextTurnMemoryConsistencyResult> {
  const clock = input.clock ?? DEFAULT_CLOCK;
  const startedAt = clock.now();
  let nextBackoffMs = NEXT_TURN_MEMORY_CONSISTENCY_INITIAL_BACKOFF_MS;
  let waitedMs = 0;
  let queryCount = 0;
  let queueAgeMs: number | null = null;

  const result = (
    outcome: NextTurnMemoryConsistencyOutcome,
    initialJobStatus: IngestionJobStatus | null,
    finalJobStatus: IngestionJobStatus | null,
    matchedJobCount: 0 | 1,
  ): NextTurnMemoryConsistencyResult => ({
    outcome,
    durationMs: Math.max(0, clock.now() - startedAt),
    waitedMs,
    queryCount,
    matchedJobCount,
    queueAgeMs,
    initialJobStatus,
    finalJobStatus,
  });

  if (!canReadLongTermMemory()) {
    return result('opt_out', null, null, 0);
  }

  const sourceEndMessageId = input.sourceEndMessageId?.trim();
  if (!sourceEndMessageId) {
    return result('no_job', null, null, 0);
  }

  const readJob = (): { job: IngestionJob | null; failed: boolean } => {
    queryCount += 1;
    try {
      return {
        job: getIngestionJobForSourceTurn({
          memoryConversationId: input.memoryConversationId,
          sourceThreadId: input.sourceThreadId,
          sourceEndMessageId,
        }),
        failed: false,
      };
    } catch {
      return { job: null, failed: true };
    }
  };

  let read = readJob();
  if (read.failed) {
    return result('degraded', null, null, 0);
  }
  let job = read.job;
  if (!job) {
    return result('no_job', null, null, 0);
  }
  queueAgeMs = Math.max(0, startedAt - job.createdAt);
  const initialJobStatus = job.status;
  let disposition = classifyJob(job, clock.now());
  if (disposition === 'completed') {
    return result('completed', initialJobStatus, job.status, 1);
  }
  if (disposition === 'degraded') {
    return result('degraded', initialJobStatus, job.status, 1);
  }

  while (waitedMs < NEXT_TURN_MEMORY_CONSISTENCY_BUDGET_MS) {
    const delayMs = Math.min(nextBackoffMs, NEXT_TURN_MEMORY_CONSISTENCY_BUDGET_MS - waitedMs);
    waitedMs += delayMs;
    await clock.wait(delayMs);
    nextBackoffMs = Math.min(NEXT_TURN_MEMORY_CONSISTENCY_MAX_BACKOFF_MS, nextBackoffMs * 2);
    read = readJob();
    if (read.failed) {
      return result('degraded', initialJobStatus, job.status, 1);
    }
    job = read.job;
    if (!job) {
      return result('degraded', initialJobStatus, null, 1);
    }
    disposition = classifyJob(job, clock.now());
    if (disposition === 'completed') {
      return result('completed', initialJobStatus, job.status, 1);
    }
    if (disposition === 'degraded') {
      return result('degraded', initialJobStatus, job.status, 1);
    }
  }

  return result('timed_out', initialJobStatus, job.status, 1);
}
