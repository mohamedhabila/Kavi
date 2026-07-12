import { getMemoryDb } from './database';
import { ensureFactSchema } from './schema';

export const NO_ACTIVE_PRIOR_DEPENDENCY_SQL = `NOT EXISTS (
  SELECT 1
    FROM memory_ingestion_jobs AS dependency
   WHERE candidate.prior_user_message_id IS NOT NULL
     AND dependency.id != candidate.id
     AND dependency.thread_id = candidate.thread_id
     AND dependency.memory_conversation_id = candidate.memory_conversation_id
     AND dependency.source_start_message_id = candidate.prior_user_message_id
     AND dependency.status IN ('pending', 'processing', 'retrying')
)`;

export function getNextPendingIngestionAttemptAt(): number | null {
  ensureFactSchema();
  const row = getMemoryDb().getFirstSync<{ next_attempt_at: number | null }>(
    `SELECT MIN(wake_at) AS next_attempt_at
       FROM (
         SELECT candidate.next_attempt_at AS wake_at
           FROM memory_ingestion_jobs AS candidate
          WHERE candidate.status IN ('pending', 'retrying')
            AND ${NO_ACTIVE_PRIOR_DEPENDENCY_SQL}
         UNION ALL
         SELECT lease_expires_at AS wake_at
           FROM memory_ingestion_jobs
          WHERE status = 'processing'
       )`,
  );
  return row?.next_attempt_at ?? null;
}
