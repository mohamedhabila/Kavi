import { getMemoryDb } from './database';

type MemoryDb = ReturnType<typeof getMemoryDb>;

export function ensureIngestionQueueIndexes(db: MemoryDb): void {
  db.execSync(`
    DROP INDEX IF EXISTS idx_ingestion_jobs_status;
    DROP INDEX IF EXISTS idx_ingestion_jobs_thread;
    CREATE INDEX idx_ingestion_jobs_status
      ON memory_ingestion_jobs(status, next_attempt_at, created_at);
    CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_lease
      ON memory_ingestion_jobs(status, lease_expires_at);
    CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_evidence_scope
      ON memory_ingestion_jobs(memory_conversation_id, thread_id, created_at, id);
    DROP INDEX IF EXISTS idx_ingestion_jobs_prior_dependency;
    CREATE INDEX idx_ingestion_jobs_prior_dependency
      ON memory_ingestion_jobs(
        thread_id,
        memory_conversation_id,
        source_start_message_id,
        status
      );
  `);
}
