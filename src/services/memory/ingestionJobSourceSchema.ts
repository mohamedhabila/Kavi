import { runMemoryDatabaseSavepoint } from './access/databaseSavepoint';
import type { getMemoryDb } from './database';
import {
  buildIngestionJobSourcesFromSnapshot,
  buildProvableLegacyIngestionJobSources,
  insertIngestionJobSources,
} from './ingestionJobSources';
import type { IngestionJobRow } from './ingestionQueueIdentity';
import { decodeIngestionSourceSnapshot } from './ingestionSourceSnapshot';
import { getLocalMemoryVaultOwnerId } from './memoryVaultIdentity';

type MemoryDb = ReturnType<typeof getMemoryDb>;

interface SnapshotPayloadRow {
  payload_json: string;
}

function tableExists(db: MemoryDb, tableName: string): boolean {
  return Boolean(
    db.getFirstSync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      tableName,
    ),
  );
}

function isActiveJob(row: IngestionJobRow): boolean {
  return row.status === 'pending' || row.status === 'processing' || row.status === 'retrying';
}

function decodeBootstrapSnapshot(db: MemoryDb, row: IngestionJobRow) {
  const payload = db.getFirstSync<SnapshotPayloadRow>(
    `SELECT payload_json
       FROM memory_ingestion_source_snapshots
      WHERE job_id = ?
      LIMIT 1`,
    row.id,
  );
  if (!payload) throw new Error('memory_ingestion_job_sources_bootstrap_snapshot_missing');
  const snapshot = decodeIngestionSourceSnapshot({
    snapshotVersion: row.source_snapshot_version,
    payloadJson: payload.payload_json,
    payloadSha256: row.source_snapshot_sha256,
    payloadByteLength: row.source_snapshot_byte_length,
  });
  if (
    snapshot.priorUserMessageId !== row.prior_user_message_id ||
    snapshot.sourceStartMessageId !== row.source_start_message_id ||
    snapshot.sourceEndMessageId !== row.source_end_message_id
  ) {
    throw new Error('memory_ingestion_job_sources_bootstrap_snapshot_invalid');
  }
  return snapshot;
}

function bootstrapExistingJobs(db: MemoryDb): void {
  const memoryOwnerId = getLocalMemoryVaultOwnerId(db);
  const rows = db.getAllSync<IngestionJobRow>('SELECT * FROM memory_ingestion_jobs');
  for (const row of rows) {
    const sources = isActiveJob(row)
      ? buildIngestionJobSourcesFromSnapshot(
          {
            memoryOwnerId,
            memoryConversationId: row.memory_conversation_id,
            sourceThreadId: row.thread_id,
            taskId: row.task_id,
            sourceEndMessageId: row.source_end_message_id,
            sourceRunId: row.source_run_id,
          },
          decodeBootstrapSnapshot(db, row),
        )
      : buildProvableLegacyIngestionJobSources(memoryOwnerId, row);
    insertIngestionJobSources(db, row.id, sources);
  }
}

/**
 * Install the canonical ingestion-source index and perform its only legacy read.
 * Once this transaction commits, runtime code treats these immutable rows as authoritative.
 */
export function ensureIngestionJobSourceSchema(db: MemoryDb): void {
  const requiresOneWayBootstrap = !tableExists(db, 'memory_ingestion_job_sources');
  runMemoryDatabaseSavepoint(db, (database) => {
    database.execSync(`
      CREATE TABLE IF NOT EXISTS memory_ingestion_job_sources (
        job_id TEXT NOT NULL,
        memory_owner_id TEXT NOT NULL,
        memory_conversation_id TEXT NOT NULL,
        source_thread_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        source_kind TEXT NOT NULL CHECK(source_kind IN ('message', 'turn', 'run')),
        source_id TEXT NOT NULL,
        PRIMARY KEY (job_id, source_kind, source_id),
        CHECK(LENGTH(job_id) BETWEEN 1 AND 160),
        CHECK(LENGTH(memory_owner_id) BETWEEN 1 AND 160),
        CHECK(LENGTH(memory_conversation_id) BETWEEN 1 AND 160),
        CHECK(LENGTH(source_thread_id) BETWEEN 1 AND 160),
        CHECK(LENGTH(task_id) <= 160),
        CHECK(LENGTH(source_id) BETWEEN 1 AND 512)
      );
      CREATE INDEX IF NOT EXISTS idx_memory_ingestion_job_sources_exact
        ON memory_ingestion_job_sources(
          memory_owner_id, memory_conversation_id, source_thread_id,
          task_id, source_kind, source_id, job_id
        );

      DROP TRIGGER IF EXISTS trg_memory_ingestion_job_source_parent_required;
      CREATE TRIGGER trg_memory_ingestion_job_source_parent_required
        BEFORE INSERT ON memory_ingestion_job_sources
        WHEN NOT EXISTS (
          SELECT 1
            FROM memory_ingestion_jobs AS job
            JOIN memory_vault_identity AS vault ON vault.singleton = 1
           WHERE job.id = NEW.job_id
             AND vault.owner_id = NEW.memory_owner_id
             AND job.memory_conversation_id = NEW.memory_conversation_id
             AND job.thread_id = NEW.source_thread_id
             AND COALESCE(job.task_id, '') = NEW.task_id
        )
        BEGIN
          SELECT RAISE(ABORT, 'memory_ingestion_job_source_parent_invalid');
        END;

      DROP TRIGGER IF EXISTS trg_memory_ingestion_job_source_immutable;
      CREATE TRIGGER trg_memory_ingestion_job_source_immutable
        BEFORE UPDATE ON memory_ingestion_job_sources
        BEGIN
          SELECT RAISE(ABORT, 'memory_ingestion_job_source_immutable');
        END;

      DROP TRIGGER IF EXISTS trg_memory_ingestion_job_source_delete_guard;
      CREATE TRIGGER trg_memory_ingestion_job_source_delete_guard
        BEFORE DELETE ON memory_ingestion_job_sources
        WHEN EXISTS (SELECT 1 FROM memory_ingestion_jobs WHERE id = OLD.job_id)
        BEGIN
          SELECT RAISE(ABORT, 'memory_ingestion_job_source_immutable');
        END;

      DROP TRIGGER IF EXISTS trg_memory_ingestion_job_delete_source_cleanup;
      CREATE TRIGGER trg_memory_ingestion_job_delete_source_cleanup
        AFTER DELETE ON memory_ingestion_jobs
        BEGIN
          DELETE FROM memory_ingestion_job_sources WHERE job_id = OLD.id;
        END;

      DELETE FROM memory_ingestion_job_sources
       WHERE job_id NOT IN (SELECT id FROM memory_ingestion_jobs);
    `);
    if (requiresOneWayBootstrap) bootstrapExistingJobs(database);
  });
}
