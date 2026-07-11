import {
  failUnsealedActiveJobs,
  quarantineConflictingSourceDuplicates,
} from './ingestionQueueConflictQuarantine';
import { getMemoryDb } from './database';

type MemoryDb = ReturnType<typeof getMemoryDb>;

const INGESTION_JOBS_TABLE = 'memory_ingestion_jobs';
const DURABLE_INGESTION_JOBS_TABLE = 'memory_ingestion_jobs_durable';
const INGESTION_RECEIPTS_TABLE = 'memory_ingestion_receipts';

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
      persona_id TEXT
        CHECK(persona_id IS NULL OR (
          LENGTH(persona_id) BETWEEN 1 AND 160
          AND persona_id = TRIM(persona_id)
        )),
      task_id TEXT,
      source_run_id TEXT,
      chat_provider_id TEXT,
      chat_model TEXT,
      source_start_message_id TEXT,
      source_end_message_id TEXT NOT NULL,
      source_at INTEGER NOT NULL,
      reason TEXT NOT NULL DEFAULT 'turn_completed'
        CHECK(reason IN ('turn_completed', 'migration', 'manual')),
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
      provider_enrichment INTEGER NOT NULL DEFAULT 1 CHECK(provider_enrichment IN (0, 1)),
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
          'persona_scope_missing',
          'source_identity_invalid',
          'source_identity_conflict',
          'source_window_unavailable',
          'stale_processing_lease'
        )),
      next_attempt_at INTEGER,
      lease_expires_at INTEGER,
      claim_token TEXT,
      structural_completed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER,
      CHECK(
        status NOT IN ('degraded', 'completed_structural', 'completed_enriched')
        OR structural_completed_at IS NOT NULL
      ),
      CHECK(status != 'failed' OR structural_completed_at IS NULL),
      CHECK((chat_provider_id IS NULL) = (chat_model IS NULL)),
      CHECK(source_at >= 0),
      CHECK(claim_token IS NULL OR LENGTH(TRIM(claim_token)) > 0),
      CHECK(
        (status = 'processing' AND claim_token IS NOT NULL AND lease_expires_at IS NOT NULL)
        OR (status != 'processing' AND claim_token IS NULL AND lease_expires_at IS NULL)
      )
    );
  `);
}

function ensureIngestionReceiptsTable(db: MemoryDb): void {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS ${INGESTION_RECEIPTS_TABLE} (
      job_id TEXT NOT NULL,
      attempt_number INTEGER NOT NULL CHECK(attempt_number > 0),
      episode_id TEXT,
      deterministic_fact_ids_json TEXT NOT NULL,
      provider_fact_ids_json TEXT NOT NULL,
      invalidated_fact_ids_json TEXT NOT NULL,
      bridged_evidence_fact_ids_json TEXT NOT NULL,
      agent_run_memory_fact_ids_json TEXT NOT NULL,
      active_focus_updated INTEGER NOT NULL CHECK(active_focus_updated IN (0, 1)),
      open_threads_updated INTEGER NOT NULL CHECK(open_threads_updated IN (0, 1)),
      provider_outcome TEXT NOT NULL
        CHECK(provider_outcome IN (
          'structural_only',
          'valid',
          'empty_valid',
          'malformed',
          'schema_invalid',
          'provider_error'
        )),
      provider_outcome_code TEXT
        CHECK(provider_outcome_code IS NULL OR provider_outcome_code IN (
          'empty_response',
          'invalid_json',
          'non_object',
          'missing_required_field',
          'unexpected_field',
          'invalid_field_type',
          'invalid_field_value',
          'limit_exceeded',
          'provider_request_failed',
          'unsupported_response_shape'
        )),
      persisted_at INTEGER NOT NULL CHECK(persisted_at >= 0),
      PRIMARY KEY (job_id, attempt_number),
      CHECK(episode_id IS NULL OR LENGTH(TRIM(episode_id)) > 0),
      CHECK(
        (provider_outcome IN ('structural_only', 'valid', 'empty_valid')
          AND provider_outcome_code IS NULL)
        OR (provider_outcome = 'malformed'
          AND provider_outcome_code IN ('empty_response', 'invalid_json', 'non_object'))
        OR (provider_outcome = 'schema_invalid'
          AND provider_outcome_code IN (
            'missing_required_field',
            'unexpected_field',
            'invalid_field_type',
            'invalid_field_value',
            'limit_exceeded'
          ))
        OR (provider_outcome = 'provider_error'
          AND provider_outcome_code IN (
            'provider_request_failed',
            'unsupported_response_shape'
          ))
      )
    );
    CREATE INDEX IF NOT EXISTS idx_ingestion_receipts_persisted_at
      ON ${INGESTION_RECEIPTS_TABLE}(persisted_at, job_id);
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
    'claim_token',
    'structural_completed_at',
    'thread_title',
    'persona_id',
    'source_at',
    'source_run_id',
    'chat_provider_id',
    'chat_model',
  ];
  const memoryConversationColumn = columns.find(
    (column) => column.name === 'memory_conversation_id',
  );
  const tableSql =
    db.getFirstSync<{ sql: string | null }>(
      `SELECT sql
         FROM sqlite_master
        WHERE type = 'table' AND name = ?`,
      INGESTION_JOBS_TABLE,
    )?.sql ?? '';
  const isDurableSchema =
    durableColumns.every((column) => names.has(column)) &&
    memoryConversationColumn?.notnull === 1 &&
    !names.has('error') &&
    tableSql.includes("CHECK(reason IN ('turn_completed', 'migration', 'manual'))") &&
    tableSql.includes('provider_enrichment IN (0, 1)') &&
    tableSql.includes('(chat_provider_id IS NULL) = (chat_model IS NULL)') &&
    tableSql.includes('source_identity_invalid') &&
    tableSql.includes('source_identity_conflict');

  if (isDurableSchema) return;

  ensureColumn(db, 'provider_enrichment', 'provider_enrichment INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'memory_conversation_id', 'memory_conversation_id TEXT');
  ensureColumn(db, 'persona_id', 'persona_id TEXT');
  ensureColumn(db, 'provider_outcome', 'provider_outcome TEXT');
  ensureColumn(db, 'outcome_code', 'outcome_code TEXT');
  ensureColumn(db, 'next_attempt_at', 'next_attempt_at INTEGER');
  ensureColumn(db, 'lease_expires_at', 'lease_expires_at INTEGER');
  ensureColumn(db, 'claim_token', 'claim_token TEXT');
  ensureColumn(db, 'structural_completed_at', 'structural_completed_at INTEGER');
  ensureColumn(db, 'thread_title', 'thread_title TEXT');
  ensureColumn(db, 'source_at', 'source_at INTEGER');
  ensureColumn(db, 'source_run_id', 'source_run_id TEXT');
  ensureColumn(db, 'chat_provider_id', 'chat_provider_id TEXT');
  ensureColumn(db, 'chat_model', 'chat_model TEXT');

  const invalidMigratedPersonaSql = `
    persona_id IS NULL
    OR LENGTH(persona_id) NOT BETWEEN 1 AND 160
    OR persona_id != TRIM(persona_id)
  `;
  const invalidMigratedNormalizedIdentitySql = `
    (${invalidMigratedPersonaSql})
    OR memory_conversation_id IS NULL
    OR TRIM(memory_conversation_id) = ''
    OR source_at IS NULL
    OR typeof(source_at) != 'integer'
    OR source_at < 0
    OR source_at > 9007199254740991
    OR reason IS NULL
    OR reason NOT IN ('turn_completed', 'migration', 'manual')
    OR provider_enrichment IS NULL
    OR provider_enrichment NOT IN (0, 1)
    OR ((chat_provider_id IS NULL) != (chat_model IS NULL))
  `;
  const invalidMigratedActiveIdentitySql = `
    status IN ('pending', 'processing', 'retrying')
    AND (${invalidMigratedNormalizedIdentitySql})
  `;

  db.execSync('BEGIN IMMEDIATE TRANSACTION');
  try {
    db.execSync(`DROP TABLE IF EXISTS ${DURABLE_INGESTION_JOBS_TABLE}`);
    createDurableIngestionJobsTable(db, DURABLE_INGESTION_JOBS_TABLE, false);
    db.execSync(`
      INSERT INTO ${DURABLE_INGESTION_JOBS_TABLE} (
        id, thread_id, thread_title, memory_conversation_id, persona_id, task_id, source_run_id,
        chat_provider_id, chat_model,
        source_start_message_id, source_end_message_id, source_at, reason, status,
        attempt_count, provider_enrichment, provider_outcome, outcome_code,
        next_attempt_at, lease_expires_at, claim_token, structural_completed_at,
        created_at, updated_at, completed_at
      )
      SELECT
        id,
        thread_id,
        thread_title,
        COALESCE(NULLIF(TRIM(memory_conversation_id), ''), thread_id),
        CASE
          WHEN persona_id IS NOT NULL
            AND LENGTH(persona_id) BETWEEN 1 AND 160
            AND persona_id = TRIM(persona_id)
            THEN persona_id
          ELSE NULL
        END,
        task_id,
        source_run_id,
        CASE
          WHEN chat_provider_id IS NOT NULL AND chat_model IS NOT NULL
            THEN chat_provider_id
          ELSE NULL
        END,
        CASE
          WHEN chat_provider_id IS NOT NULL AND chat_model IS NOT NULL
            THEN chat_model
          ELSE NULL
        END,
        source_start_message_id,
        source_end_message_id,
        CASE
          WHEN typeof(source_at) = 'integer'
            AND source_at BETWEEN 0 AND 9007199254740991
            THEN source_at
          WHEN typeof(created_at) = 'integer'
            AND created_at BETWEEN 0 AND 9007199254740991
            THEN created_at
          ELSE 0
        END,
        CASE
          WHEN reason IN ('turn_completed', 'migration', 'manual') THEN reason
          ELSE 'manual'
        END,
        CASE
          WHEN ${invalidMigratedActiveIdentitySql} THEN 'failed'
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
        CASE WHEN provider_enrichment IN (0, 1) THEN provider_enrichment ELSE 0 END,
        CASE
          WHEN ${invalidMigratedActiveIdentitySql} THEN NULL
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
          WHEN status IN ('pending', 'processing', 'retrying')
            AND (${invalidMigratedPersonaSql})
            THEN 'persona_scope_missing'
          WHEN ${invalidMigratedActiveIdentitySql} THEN 'source_identity_invalid'
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
            'persona_scope_missing',
            'source_identity_invalid',
            'source_identity_conflict',
            'source_window_unavailable',
            'stale_processing_lease'
          ) THEN outcome_code
          ELSE NULL
        END,
        CASE
          WHEN ${invalidMigratedActiveIdentitySql} THEN NULL
          WHEN status IN ('pending', 'retrying') THEN COALESCE(next_attempt_at, updated_at)
          WHEN status = 'processing' AND attempt_count < 5 THEN updated_at
          ELSE NULL
        END,
        NULL,
        NULL,
        CASE
          WHEN ${invalidMigratedActiveIdentitySql} THEN NULL
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
          WHEN ${invalidMigratedActiveIdentitySql} THEN updated_at
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
    CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_evidence_scope
      ON memory_ingestion_jobs(memory_conversation_id, thread_id, created_at, id);
  `);
}

function ensureSourceIdentity(db: MemoryDb): void {
  db.execSync('BEGIN IMMEDIATE TRANSACTION');
  try {
    quarantineConflictingSourceDuplicates(db);
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
      DELETE FROM memory_ingestion_receipts
        WHERE job_id NOT IN (SELECT id FROM memory_ingestion_jobs);
    `);
    db.execSync('COMMIT');
  } catch (error) {
    db.execSync('ROLLBACK');
    throw error;
  }
}

export function ensureIngestionQueueSchema(db: MemoryDb): void {
  createDurableIngestionJobsTable(db, INGESTION_JOBS_TABLE, true);
  migrateLegacyIngestionQueue(db);
  ensureIngestionReceiptsTable(db);
  failUnsealedActiveJobs(db);
  ensureIndexes(db);
  ensureSourceIdentity(db);
}
