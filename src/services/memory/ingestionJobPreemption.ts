import {
  MAX_EXACT_INGESTION_PREEMPTION_WAIT_MS,
  preemptActiveIngestionAttemptForJobAndWait,
} from './ingestionAttemptPreemption';
import {
  discardIngestionJob,
  getIngestionJob,
  type IngestionJobStatus,
} from './ingestionQueueStore';
import { isExactMemoryScopeId } from './memoryScopeIdentity';

export const EXACT_INGESTION_PREEMPTION_WAIT_MS = 5_000;

type QueueOnlyIngestionStatus = 'pending' | 'retrying';
type PreemptibleIngestionStatus = QueueOnlyIngestionStatus | 'processing';
type TerminalIngestionStatus = Exclude<
  IngestionJobStatus,
  PreemptibleIngestionStatus
>;

export type ExactIngestionJobPreemptionResult =
  | { status: 'discarded'; previousStatus: QueueOnlyIngestionStatus }
  | { status: 'preempted'; previousStatus: PreemptibleIngestionStatus | 'missing' }
  | {
      status: 'ownership_release_timed_out';
      previousStatus: PreemptibleIngestionStatus | 'missing';
    }
  | { status: 'ownership_release_unobserved'; previousStatus: 'processing' }
  | { status: 'terminal'; jobStatus: TerminalIngestionStatus }
  | { status: 'missing' }
  | { status: 'invalid_job_id' }
  | { status: 'revocation_failed'; jobStatus: IngestionJobStatus | 'missing' };

export interface PreemptIngestionJobAndWaitInput {
  jobId: string;
  timeoutMs?: number;
}

function requireWaitBudget(timeoutMs: number | undefined): number {
  const value = timeoutMs ?? EXACT_INGESTION_PREEMPTION_WAIT_MS;
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_EXACT_INGESTION_PREEMPTION_WAIT_MS
  ) {
    throw new Error('memory_ingestion_preemption_wait_invalid');
  }
  return value;
}

function terminalStatus(status: IngestionJobStatus): status is TerminalIngestionStatus {
  return (
    status === 'degraded' ||
    status === 'completed_structural' ||
    status === 'completed_enriched' ||
    status === 'failed'
  );
}

/** Revoke one durable job and wait only for its matching in-process owner. */
export async function preemptIngestionJobAndWait(
  input: PreemptIngestionJobAndWaitInput,
): Promise<ExactIngestionJobPreemptionResult> {
  if (!isExactMemoryScopeId(input.jobId)) return { status: 'invalid_job_id' };
  const timeoutMs = requireWaitBudget(input.timeoutMs);
  const job = getIngestionJob(input.jobId);

  if (job && terminalStatus(job.status)) {
    return { status: 'terminal', jobStatus: job.status };
  }

  const ownerRelease = preemptActiveIngestionAttemptForJobAndWait({
    jobId: input.jobId,
    timeoutMs,
  });

  if (!job) {
    const release = await ownerRelease;
    if (release === 'released') return { status: 'preempted', previousStatus: 'missing' };
    if (release === 'timed_out') {
      return { status: 'ownership_release_timed_out', previousStatus: 'missing' };
    }
    return { status: 'missing' };
  }

  const previousStatus = job.status;
  if (terminalStatus(previousStatus)) {
    return { status: 'terminal', jobStatus: previousStatus };
  }

  const revoked = discardIngestionJob(job.id);
  const release = await ownerRelease;
  if (!revoked) {
    const current = getIngestionJob(job.id);
    if (current && terminalStatus(current.status)) {
      return { status: 'terminal', jobStatus: current.status };
    }
    if (!current && release === 'released') {
      return { status: 'preempted', previousStatus };
    }
    if (!current && release === 'timed_out') {
      return { status: 'ownership_release_timed_out', previousStatus };
    }
    if (!current) return { status: 'missing' };
    return { status: 'revocation_failed', jobStatus: current.status };
  }

  if (previousStatus === 'pending' || previousStatus === 'retrying') {
    if (release === 'released') return { status: 'preempted', previousStatus };
    if (release === 'timed_out') {
      return { status: 'ownership_release_timed_out', previousStatus };
    }
    return { status: 'discarded', previousStatus };
  }

  if (release === 'released') return { status: 'preempted', previousStatus: 'processing' };
  if (release === 'timed_out') {
    return { status: 'ownership_release_timed_out', previousStatus: 'processing' };
  }
  return { status: 'ownership_release_unobserved', previousStatus: 'processing' };
}
