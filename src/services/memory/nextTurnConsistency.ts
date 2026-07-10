import { getIngestionJobForSourceTurn } from './ingestionQueueStore';
import type { IngestionJob, IngestionJobStatus } from './ingestionQueueStore';
import { canReadLongTermMemory } from './policy';

export const NEXT_TURN_MEMORY_CONSISTENCY_BUDGET_MS = 120;
export const NEXT_TURN_MEMORY_CONSISTENCY_POLL_MS = 10;

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
  budgetMs?: number;
  pollIntervalMs?: number;
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
  if (job.status === 'processing') {
    return job.leaseExpiresAt !== null && job.leaseExpiresAt <= now ? 'degraded' : 'wait';
  }
  return job.nextAttemptAt !== null && job.nextAttemptAt <= now ? 'wait' : 'degraded';
}

function boundedPositiveInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(1, Math.floor(value!)));
}

export async function waitForNextTurnMemoryConsistency(
  input: NextTurnMemoryConsistencyInput,
): Promise<NextTurnMemoryConsistencyResult> {
  const clock = input.clock ?? DEFAULT_CLOCK;
  const startedAt = clock.now();
  const budgetMs = boundedPositiveInteger(
    input.budgetMs,
    NEXT_TURN_MEMORY_CONSISTENCY_BUDGET_MS,
    NEXT_TURN_MEMORY_CONSISTENCY_BUDGET_MS,
  );
  const pollIntervalMs = boundedPositiveInteger(
    input.pollIntervalMs,
    NEXT_TURN_MEMORY_CONSISTENCY_POLL_MS,
    budgetMs,
  );
  let waitedMs = 0;
  let queryCount = 0;

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

  const readJob = (): IngestionJob | null => {
    queryCount += 1;
    return getIngestionJobForSourceTurn({
      memoryConversationId: input.memoryConversationId,
      sourceThreadId: input.sourceThreadId,
      sourceEndMessageId,
    });
  };

  let job = readJob();
  if (!job) {
    return result('no_job', null, null, 0);
  }
  const initialJobStatus = job.status;
  let disposition = classifyJob(job, clock.now());
  if (disposition === 'completed') {
    return result('completed', initialJobStatus, job.status, 1);
  }
  if (disposition === 'degraded') {
    return result('degraded', initialJobStatus, job.status, 1);
  }

  while (waitedMs < budgetMs) {
    const delayMs = Math.min(pollIntervalMs, budgetMs - waitedMs);
    waitedMs += delayMs;
    await clock.wait(delayMs);
    job = readJob();
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
