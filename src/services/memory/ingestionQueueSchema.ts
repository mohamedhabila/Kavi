import { getMemoryDb } from './sqlite-store';

type MemoryDb = ReturnType<typeof getMemoryDb>;

const INGESTION_JOBS_TABLE = 'memory_ingestion_jobs';
const DURABLE_INGESTION_JOBS_TABLE = 'memory_ingestion_jobs_durable';

function createDurableIngestionJobsTable(
  db: MemoryDb,
  table: typeof INGESTION_JOBS_TABLE | typeof DURABLE_INGESTION_JOBS_TABLE,
  ifNotExists: boolean,
): void {
  db.execSync(`
    CREATE TABLE ${ifNotExists ? 'IF NOT EXISTS ' : ''}${table} (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      thread_title TEXT,
      memory_conversation_id TEXT NOT NULL,
      task_id TEXT,
      source_run_id TEXT,
      chat_provider_id TEXT,
      chat_model TEXT,
      source_start_message_id TEXT,
      source_end_message_id TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT 'turn_completed',
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN (
          'pending',
          'processing',
          'retrying',
          'degraded',
          'completed_structural',
          'completed_enriched',
          'failed'
        )),
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
      provider_enrichment INTEGER NOT NULL DEFAULT 1,
      provider_outcome TEXT
        CHECK(provider_outcome IS NULL OR provider_outcome IN (
          'structural_only',
          'valid',
          'empty_valid',
          'malformed',
          'schema_invalid',
          'provider_error'
        )),
      outcome_code TEXT
        CHECK(outcome_code IS NULL OR outcome_code IN (
          'empty_response',
          'invalid_json',
          'non_object',
          'missing_required_field',
          'unexpected_field',
          'invalid_field_type',
          'invalid_field_value',
          'limit_exceeded',
          'provider_request_failed',
          'unsupported_response_shape',
          'processing_incomplete',
          'processing_error',
          'stale_processing_lease'
        )),
      next_attempt_at INTEGER,
      lease_expires_at INTEGER,
      structural_completed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER,
      CHECK(
        status NOT IN ('degraded', 'completed_structural', 'completed_enriched')
        OR structural_completed_at IS NOT NULL
      ),
      CHECK(status != 'failed' OR structural_completed_at IS NULL),
      CHECK(chat_provider_id IS NOT NULL OR chat_model IS NULL)
    );
  `);
}

function ensureColumn(db: MemoryDb, column: string, definition: string): void {
  const rows = db.getAllSync<{ name: string }>(`PRAGMA table_info(${INGESTION_JOBS_TABLE})`);
  if (rows.some((row) => row.name === column)) return;
  db.execSync(`ALTER TABLE ${INGESTION_JOBS_TABLE} ADD COLUMN ${definition}`);
}

/**
 * Upgrade the original best-effort ingestion queue to the durable state
 * machine. The old free-form error column is intentionally not copied: queue
 * diagnostics are bounded status/outcome codes and never provider output or
 * exception text.
 */
function migrateLegacyIngestionQueue(db: MemoryDb): void {
  const columns = db.getAllSync<{ name: string; notnull: number }>(
    `PRAGMA table_info(${INGESTION_JOBS_TABLE})`,
  );
  const names = new Set(columns.map((column) => column.name));
  const durableColumns = [
    'provider_outcome',
    'outcome_code',
    'next_attempt_at',
    'lease_expires_at',
    'structural_completed_at',
    'thread_title',
    'source_run_id',
    'chat_provider_id',
    'chat_model',
  ];
  const memoryConversationColumn = columns.find(
    (column) => column.name === 'memory_conversation_id',
  );
  const isDurableSchema =
    durableColumns.every((column) => names.has(column)) &&
    memoryConversationColumn?.notnull === 1 &&
    !names.has('error');

  if (isDurableSchema) return;

  ensureColumn(db, 'provider_enrichment', 'provider_enrichment INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'memory_conversation_id', 'memory_conversation_id TEXT');
  ensureColumn(db, 'provider_outcome', 'provider_outcome TEXT');
  ensureColumn(db, 'outcome_code', 'outcome_code TEXT');
  ensureColumn(db, 'next_attempt_at', 'next_attempt_at INTEGER');
  ensureColumn(db, 'lease_expires_at', 'lease_expires_at INTEGER');
  ensureColumn(db, 'structural_completed_at', 'structural_completed_at INTEGER');
  ensureColumn(db, 'thread_title', 'thread_title TEXT');
  ensureColumn(db, 'source_run_id', 'source_run_id TEXT');
  ensureColumn(db, 'chat_provider_id', 'chat_provider_id TEXT');
  ensureColumn(db, 'chat_model', 'chat_model TEXT');

  db.execSync('BEGIN IMMEDIATE TRANSACTION');
  try {
    db.execSync(`DROP TABLE IF EXISTS ${DURABLE_INGESTION_JOBS_TABLE}`);
    createDurableIngestionJobsTable(db, DURABLE_INGESTION_JOBS_TABLE, false);
    db.execSync(`
      INSERT INTO ${DURABLE_INGESTION_JOBS_TABLE} (
        id, thread_id, thread_title, memory_conversation_id, task_id, source_run_id,
        chat_provider_id, chat_model,
        source_start_message_id, source_end_message_id, reason, status,
        attempt_count, provider_enrichment, provider_outcome, outcome_code,
        next_attempt_at, lease_expires_at, structural_completed_at,
        created_at, updated_at, completed_at
      )
      SELECT
        id,
        thread_id,
        thread_title,
        COALESCE(NULLIF(TRIM(memory_conversation_id), ''), thread_id),
        task_id,
        source_run_id,
        chat_provider_id,
        CASE WHEN chat_provider_id IS NOT NULL THEN chat_model ELSE NULL END,
        source_start_message_id,
        source_end_message_id,
        reason,
        CASE
          WHEN status = 'completed' THEN 'completed_structural'
          WHEN status = 'processing' AND attempt_count < 5 THEN 'retrying'
          WHEN status = 'processing' AND structural_completed_at IS NOT NULL THEN 'degraded'
          WHEN status = 'processing' THEN 'failed'
          WHEN status IN (
            'pending',
            'retrying',
            'degraded',
            'completed_structural',
            'completed_enriched',
            'failed'
          ) THEN status
          ELSE 'failed'
        END,
        MAX(0, attempt_count),
        provider_enrichment,
        CASE
          WHEN status = 'completed' THEN 'structural_only'
          WHEN provider_outcome IN (
            'structural_only',
            'valid',
            'empty_valid',
            'malformed',
            'schema_invalid',
            'provider_error'
          ) THEN provider_outcome
          ELSE NULL
        END,
        CASE
          WHEN status = 'processing' THEN 'stale_processing_lease'
          WHEN outcome_code IN (
            'empty_response',
            'invalid_json',
            'non_object',
            'missing_required_field',
            'unexpected_field',
            'invalid_field_type',
            'invalid_field_value',
            'limit_exceeded',
            'provider_request_failed',
            'unsupported_response_shape',
            'processing_incomplete',
            'processing_error',
            'stale_processing_lease'
          ) THEN outcome_code
          ELSE NULL
        END,
        CASE
          WHEN status IN ('pending', 'retrying') THEN COALESCE(next_attempt_at, updated_at)
          WHEN status = 'processing' AND attempt_count < 5 THEN updated_at
          ELSE NULL
        END,
        NULL,
        CASE
          WHEN status IN (
            'completed',
            'degraded',
            'completed_structural',
            'completed_enriched'
          ) THEN COALESCE(structural_completed_at, completed_at, updated_at)
          WHEN status = 'processing' AND structural_completed_at IS NOT NULL
            THEN structural_completed_at
          WHEN status = 'retrying' THEN structural_completed_at
          ELSE NULL
        END,
        created_at,
        updated_at,
        CASE
          WHEN status IN (
            'completed',
            'degraded',
            'completed_structural',
            'completed_enriched',
            'failed'
          ) THEN COALESCE(completed_at, updated_at)
          WHEN status = 'processing' AND attempt_count >= 5 THEN updated_at
          ELSE NULL
        END
      FROM ${INGESTION_JOBS_TABLE};
      DROP TABLE ${INGESTION_JOBS_TABLE};
      ALTER TABLE ${DURABLE_INGESTION_JOBS_TABLE} RENAME TO ${INGESTION_JOBS_TABLE};
    `);
    db.execSync('COMMIT');
  } catch (error) {
    db.execSync('ROLLBACK');
    throw error;
  }
}

function ensureIndexes(db: MemoryDb): void {
  db.execSync(`
    DROP INDEX IF EXISTS idx_ingestion_jobs_status;
    DROP INDEX IF EXISTS idx_ingestion_jobs_thread;
    CREATE INDEX idx_ingestion_jobs_status
      ON memory_ingestion_jobs(status, next_attempt_at, created_at);
    CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_lease
      ON memory_ingestion_jobs(status, lease_expires_at);
  `);
}

function ensureSourceIdentity(db: MemoryDb): void {
  db.execSync(`
    DELETE FROM memory_ingestion_jobs
      WHERE rowid IN (
        SELECT rowid
          FROM (
            SELECT rowid,
                   ROW_NUMBER() OVER (
                     PARTITION BY thread_id, source_end_message_id
                     ORDER BY
                       CASE status
                         WHEN 'completed_enriched' THEN 7
                         WHEN 'completed_structural' THEN 6
                         WHEN 'degraded' THEN 5
                         WHEN 'retrying' THEN 4
                         WHEN 'processing' THEN 3
                         WHEN 'pending' THEN 2
                         ELSE 1
                       END DESC,
                       attempt_count DESC,
                       updated_at DESC,
                       rowid DESC
                   ) AS source_rank
              FROM memory_ingestion_jobs
          )
         WHERE source_rank > 1
      );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ingestion_jobs_source_turn
      ON memory_ingestion_jobs(thread_id, source_end_message_id);
  `);
}

export function ensureIngestionQueueSchema(db: MemoryDb): void {
  createDurableIngestionJobsTable(db, INGESTION_JOBS_TABLE, true);
  migrateLegacyIngestionQueue(db);
  ensureIndexes(db);
  ensureSourceIdentity(db);
}
