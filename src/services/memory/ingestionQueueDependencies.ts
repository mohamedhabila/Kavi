import { getMemoryDb } from './database';
import { ensureFactSchema } from './schema';
import { getRuntimeProcessEpoch } from '../runtimeProcessEpoch';

function activePriorDependencyExistsSql(extraPredicate?: string): string {
  return `EXISTS (
  SELECT 1
    FROM memory_ingestion_jobs AS dependency
   WHERE candidate.prior_user_message_id IS NOT NULL
     AND dependency.id != candidate.id
     AND dependency.thread_id = candidate.thread_id
     AND dependency.memory_conversation_id = candidate.memory_conversation_id
     AND dependency.source_start_message_id = candidate.prior_user_message_id
     AND dependency.status IN ('pending', 'processing', 'retrying')
     ${extraPredicate ? `AND ${extraPredicate}` : ''}
)`;
}

const ACTIVE_PRIOR_DEPENDENCY_SQL = activePriorDependencyExistsSql();

export const NO_ACTIVE_PRIOR_DEPENDENCY_SQL = `NOT (${ACTIVE_PRIOR_DEPENDENCY_SQL})`;

export const CAN_CLAIM_STRUCTURAL_CHECKPOINT_SQL = `(
  candidate.structural_completed_at IS NULL
  AND ${ACTIVE_PRIOR_DEPENDENCY_SQL}
  AND NOT (${activePriorDependencyExistsSql('dependency.structural_completed_at IS NULL')})
)`;

export const NO_BLOCKING_PRIOR_DEPENDENCY_SQL = `(
  ${NO_ACTIVE_PRIOR_DEPENDENCY_SQL}
  OR ${CAN_CLAIM_STRUCTURAL_CHECKPOINT_SQL}
)`;

export function getNextPendingIngestionAttemptAt(): number | null {
  ensureFactSchema();
  const row = getMemoryDb().getFirstSync<{ next_attempt_at: number | null }>(
    `SELECT MIN(wake_at) AS next_attempt_at
       FROM (
         SELECT candidate.next_attempt_at AS wake_at
           FROM memory_ingestion_jobs AS candidate
          WHERE candidate.status IN ('pending', 'retrying')
            AND ${NO_BLOCKING_PRIOR_DEPENDENCY_SQL}
         UNION ALL
         SELECT CASE WHEN claim_process_epoch != ? THEN 0 ELSE lease_expires_at END AS wake_at
           FROM memory_ingestion_jobs
          WHERE status = 'processing'
       )`,
    getRuntimeProcessEpoch(),
  );
  return row?.next_attempt_at ?? null;
}
