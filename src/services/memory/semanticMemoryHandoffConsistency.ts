import type { SemanticMemoryHandoff } from '../../types/conversation';
import {
  getIngestionJobForSourceTurn,
  type IngestionJob,
  type IngestionJobStatus,
} from './ingestionQueueStore';
import { canReadLongTermMemory, captureMemoryReadEpoch, isMemoryReadEpochCurrent } from './policy';
import { normalizeSemanticMemoryHandoff } from './semanticMemoryHandoff';

export const SEMANTIC_MEMORY_HANDOFF_BUDGET_MS = 35_000;
export const SEMANTIC_MEMORY_HANDOFF_ENQUEUE_GRACE_MS = 500;
export const SEMANTIC_MEMORY_HANDOFF_INITIAL_BACKOFF_MS = 10;
export const SEMANTIC_MEMORY_HANDOFF_MAX_BACKOFF_MS = 250;

export type SemanticMemoryHandoffOutcome =
  | 'ready'
  | 'opt_out'
  | 'unavailable'
  | 'timed_out'
  | 'cancelled';

export type SemanticMemoryHandoffUnavailableReason =
  | 'invalid_handoff'
  | 'durable_read_failed'
  | 'missing_job'
  | 'policy_changed'
  | 'terminal_job';

export interface SemanticMemoryHandoffConsistencyResult {
  outcome: SemanticMemoryHandoffOutcome;
  durationMs: number;
  waitedMs: number;
  queryCount: number;
  matchedJobCount: 0 | 1;
  initialJobStatus: IngestionJobStatus | null;
  finalJobStatus: IngestionJobStatus | null;
  unavailableReason: SemanticMemoryHandoffUnavailableReason | null;
}

export interface SemanticMemoryHandoffClock {
  now: () => number;
  wait: (delayMs: number) => Promise<void>;
}

export interface WaitForSemanticMemoryHandoffInput {
  handoff: SemanticMemoryHandoff;
  clock?: SemanticMemoryHandoffClock;
  signal?: AbortSignal;
  memoryReadEpoch?: number;
  budgetMs?: number;
  enqueueGraceMs?: number;
}

const DEFAULT_CLOCK: SemanticMemoryHandoffClock = {
  now: () => Date.now(),
  wait: (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
};

type JobDisposition = 'ready' | 'unavailable' | 'wait';

function classifySemanticJob(job: IngestionJob): JobDisposition {
  if (job.status === 'completed_enriched') return 'ready';
  if (
    job.status === 'completed_structural' ||
    job.status === 'degraded' ||
    job.status === 'failed'
  ) {
    return 'unavailable';
  }
  return 'wait';
}

function validDuration(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('semantic_memory_handoff_duration_invalid');
  }
  return value;
}

export async function waitForSemanticMemoryHandoff(
  input: WaitForSemanticMemoryHandoffInput,
): Promise<SemanticMemoryHandoffConsistencyResult> {
  const clock = input.clock ?? DEFAULT_CLOCK;
  const budgetMs = validDuration(input.budgetMs, SEMANTIC_MEMORY_HANDOFF_BUDGET_MS);
  const enqueueGraceMs = Math.min(
    budgetMs,
    validDuration(input.enqueueGraceMs, SEMANTIC_MEMORY_HANDOFF_ENQUEUE_GRACE_MS),
  );
  const startedAt = clock.now();
  const memoryReadEpoch = input.memoryReadEpoch ?? captureMemoryReadEpoch();
  const handoff = normalizeSemanticMemoryHandoff(input.handoff);
  let waitedMs = 0;
  let queryCount = 0;
  let matchedJobCount: 0 | 1 = 0;
  let initialJobStatus: IngestionJobStatus | null = null;
  let finalJobStatus: IngestionJobStatus | null = null;
  let nextBackoffMs = SEMANTIC_MEMORY_HANDOFF_INITIAL_BACKOFF_MS;
  let greatestElapsedMs = 0;

  const elapsedMs = () => {
    greatestElapsedMs = Math.max(greatestElapsedMs, Math.max(0, clock.now() - startedAt));
    return greatestElapsedMs;
  };

  const result = (
    outcome: SemanticMemoryHandoffOutcome,
    unavailableReason: SemanticMemoryHandoffUnavailableReason | null = null,
  ): SemanticMemoryHandoffConsistencyResult => ({
    outcome,
    durationMs: elapsedMs(),
    waitedMs,
    queryCount,
    matchedJobCount,
    initialJobStatus,
    finalJobStatus,
    unavailableReason,
  });

  if (input.signal?.aborted) return result('cancelled');
  if (memoryReadEpoch === null || !isMemoryReadEpochCurrent(memoryReadEpoch)) {
    return canReadLongTermMemory() ? result('unavailable', 'policy_changed') : result('opt_out');
  }
  if (!handoff) return result('unavailable', 'invalid_handoff');

  while (true) {
    if (input.signal?.aborted) return result('cancelled');
    if (!isMemoryReadEpochCurrent(memoryReadEpoch)) {
      return canReadLongTermMemory() ? result('unavailable', 'policy_changed') : result('opt_out');
    }

    let job: IngestionJob | null;
    queryCount += 1;
    try {
      job = getIngestionJobForSourceTurn({
        memoryConversationId: handoff.memoryConversationId,
        sourceThreadId: handoff.sourceThreadId,
        sourceEndMessageId: handoff.sourceEndMessageId,
      });
    } catch {
      return result('unavailable', 'durable_read_failed');
    }

    if (job) {
      matchedJobCount = 1;
      initialJobStatus ??= job.status;
      finalJobStatus = job.status;
      const disposition = classifySemanticJob(job);
      if (disposition === 'ready') return result('ready');
      if (disposition === 'unavailable') return result('unavailable', 'terminal_job');
    } else if (elapsedMs() >= enqueueGraceMs) {
      return result('unavailable', 'missing_job');
    }

    const elapsed = elapsedMs();
    if (elapsed >= budgetMs) return result('timed_out');
    const remainingMs = budgetMs - elapsed;
    const missingGraceRemaining = job ? remainingMs : enqueueGraceMs - elapsed;
    const delayMs = Math.min(nextBackoffMs, remainingMs, missingGraceRemaining);
    if (delayMs <= 0) {
      return job ? result('timed_out') : result('unavailable', 'missing_job');
    }
    waitedMs += delayMs;
    await clock.wait(delayMs);
    nextBackoffMs = Math.min(SEMANTIC_MEMORY_HANDOFF_MAX_BACKOFF_MS, nextBackoffMs * 2);
  }
}
