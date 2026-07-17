import { failUnsealedActiveJobs } from './ingestionQueueConflictQuarantine';
import { getMemoryDb } from './database';
import { ensureIngestionJobSourceSchema } from './ingestionJobSourceSchema';
import { ensureIngestionQueueIndexes } from './ingestionQueueIndexes';
import { ensureIngestionQueueSourceIdentity } from './ingestionQueueSourceIdentitySchema';
import { failActiveJobsWithInvalidSourceSnapshots } from './ingestionSourceSnapshotStore';

type MemoryDb = ReturnType<typeof getMemoryDb>;

const INGESTION_JOBS_TABLE = 'memory_ingestion_jobs';
const DURABLE_INGESTION_JOBS_TABLE = 'memory_ingestion_jobs_durable';
const INGESTION_RECEIPTS_TABLE = 'memory_ingestion_receipts';
const INGESTION_STRUCTURAL_RECEIPTS_TABLE = 'memory_ingestion_structural_receipts';
const INGESTION_SOURCE_SNAPSHOTS_TABLE = 'memory_ingestion_source_snapshots';

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
      prior_user_message_id TEXT,
      source_start_message_id TEXT,
      source_end_message_id TEXT NOT NULL,
      source_snapshot_version INTEGER,
      source_snapshot_sha256 TEXT,
      source_snapshot_byte_length INTEGER,
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
          'source_snapshot_missing',
          'source_snapshot_invalid',
          'stale_processing_lease'
        )),
      next_attempt_at INTEGER,
      lease_expires_at INTEGER,
      claim_token TEXT,
      claim_process_epoch TEXT,
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
      CHECK(
        (source_snapshot_version IS NULL
          AND source_snapshot_sha256 IS NULL
          AND source_snapshot_byte_length IS NULL)
        OR (source_snapshot_version IS NOT NULL
          AND source_snapshot_version = 1
          AND source_snapshot_sha256 IS NOT NULL
          AND LENGTH(source_snapshot_sha256) = 64
          AND source_snapshot_sha256 = LOWER(source_snapshot_sha256)
          AND source_snapshot_sha256 NOT GLOB '*[^0-9a-f]*'
          AND source_snapshot_byte_length IS NOT NULL
          AND typeof(source_snapshot_byte_length) = 'integer'
          AND source_snapshot_byte_length BETWEEN 1 AND 524288)
      ),
      CHECK(
        status NOT IN ('pending', 'processing', 'retrying')
        OR (source_snapshot_version = 1
          AND source_snapshot_sha256 IS NOT NULL
          AND source_snapshot_byte_length IS NOT NULL)
      ),
      CHECK(claim_token IS NULL OR LENGTH(TRIM(claim_token)) > 0),
      CHECK(claim_process_epoch IS NULL OR LENGTH(TRIM(claim_process_epoch)) > 0),
      CHECK(
        (status = 'processing'
          AND claim_token IS NOT NULL
          AND lease_expires_at IS NOT NULL
          AND claim_process_epoch IS NOT NULL)
        OR (status != 'processing'
          AND claim_token IS NULL
          AND lease_expires_at IS NULL
          AND claim_process_epoch IS NULL)
      )
    );
  `);
}

function ensureIngestionSourceSnapshotsTable(db: MemoryDb): void {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS ${INGESTION_SOURCE_SNAPSHOTS_TABLE} (
      job_id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL CHECK(LENGTH(payload_json) > 0),
      created_at INTEGER NOT NULL CHECK(created_at >= 0)
    );
  `);
}

function ensureIngestionSourceSnapshotGuards(db: MemoryDb): void {
  db.execSync(`
    DROP TRIGGER IF EXISTS trg_memory_ingestion_source_snapshot_parent_required;
    CREATE TRIGGER trg_memory_ingestion_source_snapshot_parent_required
      BEFORE INSERT ON ${INGESTION_SOURCE_SNAPSHOTS_TABLE}
      WHEN NOT EXISTS (
        SELECT 1 FROM ${INGESTION_JOBS_TABLE}
         WHERE id = NEW.job_id
           AND status IN ('pending', 'processing', 'retrying')
      )
      BEGIN
        SELECT RAISE(ABORT, 'memory_ingestion_source_snapshot_parent_invalid');
      END;

    DROP TRIGGER IF EXISTS trg_memory_ingestion_source_snapshot_immutable;
    CREATE TRIGGER trg_memory_ingestion_source_snapshot_immutable
      BEFORE UPDATE ON ${INGESTION_SOURCE_SNAPSHOTS_TABLE}
      BEGIN
        SELECT RAISE(ABORT, 'memory_ingestion_source_snapshot_immutable');
      END;

    DROP TRIGGER IF EXISTS trg_memory_ingestion_source_snapshot_active_delete;
    CREATE TRIGGER trg_memory_ingestion_source_snapshot_active_delete
      BEFORE DELETE ON ${INGESTION_SOURCE_SNAPSHOTS_TABLE}
      WHEN EXISTS (
        SELECT 1 FROM ${INGESTION_JOBS_TABLE}
         WHERE id = OLD.job_id
           AND status IN ('pending', 'processing', 'retrying')
      )
      BEGIN
        SELECT RAISE(ABORT, 'memory_ingestion_source_snapshot_immutable');
      END;

    DROP TRIGGER IF EXISTS trg_memory_ingestion_job_snapshot_metadata_immutable;
    CREATE TRIGGER trg_memory_ingestion_job_snapshot_metadata_immutable
      BEFORE UPDATE OF source_snapshot_version, source_snapshot_sha256,
                       source_snapshot_byte_length ON ${INGESTION_JOBS_TABLE}
      WHEN OLD.source_snapshot_version IS NOT NEW.source_snapshot_version
        OR OLD.source_snapshot_sha256 IS NOT NEW.source_snapshot_sha256
        OR OLD.source_snapshot_byte_length IS NOT NEW.source_snapshot_byte_length
      BEGIN
        SELECT RAISE(ABORT, 'memory_ingestion_source_snapshot_immutable');
      END;

    DROP TRIGGER IF EXISTS trg_memory_ingestion_job_terminal_snapshot_cleanup;
    CREATE TRIGGER trg_memory_ingestion_job_terminal_snapshot_cleanup
      AFTER UPDATE OF status ON ${INGESTION_JOBS_TABLE}
      WHEN NEW.status IN ('degraded', 'completed_structural', 'completed_enriched', 'failed')
      BEGIN
        DELETE FROM ${INGESTION_SOURCE_SNAPSHOTS_TABLE} WHERE job_id = NEW.id;
      END;

    DROP TRIGGER IF EXISTS trg_memory_ingestion_job_delete_snapshot_cleanup;
    CREATE TRIGGER trg_memory_ingestion_job_delete_snapshot_cleanup
      AFTER DELETE ON ${INGESTION_JOBS_TABLE}
      BEGIN
        DELETE FROM ${INGESTION_SOURCE_SNAPSHOTS_TABLE} WHERE job_id = OLD.id;
      END;

    DELETE FROM ${INGESTION_SOURCE_SNAPSHOTS_TABLE}
      WHERE job_id NOT IN (SELECT id FROM ${INGESTION_JOBS_TABLE})
         OR job_id IN (
           SELECT id FROM ${INGESTION_JOBS_TABLE}
            WHERE status IN ('degraded', 'completed_structural', 'completed_enriched', 'failed')
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
    CREATE TRIGGER IF NOT EXISTS trg_memory_ingestion_receipt_immutable
      BEFORE UPDATE ON ${INGESTION_RECEIPTS_TABLE}
      BEGIN
        SELECT RAISE(ABORT, 'memory_ingestion_receipt_immutable');
      END;
  `);
}

function ensureIngestionStructuralReceiptsTable(db: MemoryDb): void {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS ${INGESTION_STRUCTURAL_RECEIPTS_TABLE} (
      job_id TEXT NOT NULL,
      attempt_number INTEGER NOT NULL CHECK(attempt_number > 0),
      memory_conversation_id TEXT NOT NULL CHECK(LENGTH(TRIM(memory_conversation_id)) > 0),
      source_thread_id TEXT NOT NULL CHECK(LENGTH(TRIM(source_thread_id)) > 0),
      persona_id TEXT NOT NULL CHECK(LENGTH(TRIM(persona_id)) > 0),
      task_id TEXT,
      source_run_id TEXT,
      source_start_message_id TEXT,
      source_end_message_id TEXT NOT NULL CHECK(LENGTH(source_end_message_id) > 0),
      source_snapshot_sha256 TEXT NOT NULL
        CHECK(
          LENGTH(source_snapshot_sha256) = 64
          AND source_snapshot_sha256 = LOWER(source_snapshot_sha256)
          AND source_snapshot_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
      source_at INTEGER NOT NULL CHECK(source_at >= 0),
      episode_id TEXT,
      deterministic_fact_ids_json TEXT NOT NULL,
      provider_fact_ids_json TEXT NOT NULL CHECK(provider_fact_ids_json = '[]'),
      invalidated_fact_ids_json TEXT NOT NULL,
      bridged_evidence_fact_ids_json TEXT NOT NULL,
      agent_run_memory_fact_ids_json TEXT NOT NULL,
      active_focus_updated INTEGER NOT NULL CHECK(active_focus_updated IN (0, 1)),
      open_threads_updated INTEGER NOT NULL CHECK(open_threads_updated IN (0, 1)),
      persisted_at INTEGER NOT NULL CHECK(persisted_at >= 0),
      PRIMARY KEY (job_id, attempt_number),
      CHECK(task_id IS NULL OR LENGTH(TRIM(task_id)) > 0),
      CHECK(source_run_id IS NULL OR LENGTH(source_run_id) > 0),
      CHECK(source_start_message_id IS NULL OR LENGTH(source_start_message_id) > 0),
      CHECK(episode_id IS NULL OR LENGTH(episode_id) > 0)
    );
    CREATE INDEX IF NOT EXISTS idx_ingestion_structural_receipts_persisted_at
      ON ${INGESTION_STRUCTURAL_RECEIPTS_TABLE}(persisted_at, job_id);
    CREATE TRIGGER IF NOT EXISTS trg_memory_ingestion_structural_receipt_immutable
      BEFORE UPDATE ON ${INGESTION_STRUCTURAL_RECEIPTS_TABLE}
      BEGIN
        SELECT RAISE(ABORT, 'memory_ingestion_structural_receipt_immutable');
      END;
    CREATE TRIGGER IF NOT EXISTS trg_memory_ingestion_job_structural_receipt_cleanup
      AFTER DELETE ON ${INGESTION_JOBS_TABLE}
      BEGIN
        DELETE FROM ${INGESTION_STRUCTURAL_RECEIPTS_TABLE} WHERE job_id = OLD.id;
      END;
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
    'claim_process_epoch',
    'structural_completed_at',
    'thread_title',
    'persona_id',
    'source_at',
    'source_run_id',
    'chat_provider_id',
    'chat_model',
    'prior_user_message_id',
    'source_snapshot_version',
    'source_snapshot_sha256',
    'source_snapshot_byte_length',
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
    tableSql.includes(
      'CHECK(claim_process_epoch IS NULL OR LENGTH(TRIM(claim_process_epoch)) > 0)',
    ) &&
    tableSql.includes('AND claim_process_epoch IS NOT NULL)') &&
    tableSql.includes('AND claim_process_epoch IS NULL)') &&
    tableSql.includes('source_identity_invalid') &&
    tableSql.includes('source_identity_conflict') &&
    tableSql.includes('source_snapshot_missing') &&
    tableSql.includes('source_snapshot_invalid') &&
    tableSql.includes('source_snapshot_version = 1') &&
    !tableSql.includes('source_window_unavailable');

  if (isDurableSchema) return;

  ensureColumn(db, 'provider_enrichment', 'provider_enrichment INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'memory_conversation_id', 'memory_conversation_id TEXT');
  ensureColumn(db, 'persona_id', 'persona_id TEXT');
  ensureColumn(db, 'provider_outcome', 'provider_outcome TEXT');
  ensureColumn(db, 'outcome_code', 'outcome_code TEXT');
  ensureColumn(db, 'next_attempt_at', 'next_attempt_at INTEGER');
  ensureColumn(db, 'lease_expires_at', 'lease_expires_at INTEGER');
  ensureColumn(db, 'claim_token', 'claim_token TEXT');
  ensureColumn(db, 'claim_process_epoch', 'claim_process_epoch TEXT');
  ensureColumn(db, 'structural_completed_at', 'structural_completed_at INTEGER');
  ensureColumn(db, 'thread_title', 'thread_title TEXT');
  ensureColumn(db, 'source_at', 'source_at INTEGER');
  ensureColumn(db, 'source_run_id', 'source_run_id TEXT');
  ensureColumn(db, 'chat_provider_id', 'chat_provider_id TEXT');
  ensureColumn(db, 'chat_model', 'chat_model TEXT');
  ensureColumn(db, 'prior_user_message_id', 'prior_user_message_id TEXT');
  ensureColumn(db, 'source_snapshot_version', 'source_snapshot_version INTEGER');
  ensureColumn(db, 'source_snapshot_sha256', 'source_snapshot_sha256 TEXT');
  ensureColumn(db, 'source_snapshot_byte_length', 'source_snapshot_byte_length INTEGER');

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
  const migratedPriorIdentityUnavailableSql = names.has('prior_user_message_id') ? '0' : '1';
  const migratedSnapshotMetadataMissingSql = names.has('source_snapshot_version')
    ? `(
        source_snapshot_version IS NULL
        AND source_snapshot_sha256 IS NULL
        AND source_snapshot_byte_length IS NULL
      )`
    : '1';
  const migratedSnapshotMetadataValidSql = names.has('source_snapshot_version')
    ? `(
        source_snapshot_version = 1
        AND LENGTH(source_snapshot_sha256) = 64
        AND source_snapshot_sha256 = LOWER(source_snapshot_sha256)
        AND source_snapshot_sha256 NOT GLOB '*[^0-9a-f]*'
        AND typeof(source_snapshot_byte_length) = 'integer'
        AND source_snapshot_byte_length BETWEEN 1 AND 524288
      )`
    : '0';
  const migratedSnapshotMetadataInvalidSql = names.has('source_snapshot_version')
    ? `(
        NOT (${migratedSnapshotMetadataMissingSql})
        AND COALESCE((${migratedSnapshotMetadataValidSql}), 0) = 0
      )`
    : '0';
  const invalidMigratedActiveBaseIdentitySql = `
    status IN ('pending', 'processing', 'retrying')
    AND (
      ${migratedPriorIdentityUnavailableSql}
      OR (${invalidMigratedNormalizedIdentitySql})
    )
  `;
  const invalidMigratedActiveIdentitySql = `
    status IN ('pending', 'processing', 'retrying')
    AND (
      (${invalidMigratedActiveBaseIdentitySql})
      OR (${migratedSnapshotMetadataMissingSql})
      OR (${migratedSnapshotMetadataInvalidSql})
    )
  `;
  const invalidMigratedActiveSnapshotSql = `
    status IN ('pending', 'processing', 'retrying')
    AND (
      (${migratedSnapshotMetadataMissingSql})
      OR (${migratedSnapshotMetadataInvalidSql})
    )
  `;

  db.execSync('BEGIN IMMEDIATE TRANSACTION');
  try {
    db.execSync(`DROP TABLE IF EXISTS ${DURABLE_INGESTION_JOBS_TABLE}`);
    createDurableIngestionJobsTable(db, DURABLE_INGESTION_JOBS_TABLE, false);
    db.execSync(`
      INSERT INTO ${DURABLE_INGESTION_JOBS_TABLE} (
        id, thread_id, thread_title, memory_conversation_id, persona_id, task_id, source_run_id,
        chat_provider_id, chat_model, prior_user_message_id,
        source_start_message_id, source_end_message_id,
        source_snapshot_version, source_snapshot_sha256, source_snapshot_byte_length,
        source_at, reason, status,
        attempt_count, provider_enrichment, provider_outcome, outcome_code,
        next_attempt_at, lease_expires_at, claim_token, claim_process_epoch,
        structural_completed_at,
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
        prior_user_message_id,
        source_start_message_id,
        source_end_message_id,
        CASE WHEN ${migratedSnapshotMetadataValidSql} THEN 1 ELSE NULL END,
        CASE
          WHEN ${migratedSnapshotMetadataValidSql}
            THEN source_snapshot_sha256
          ELSE NULL
        END,
        CASE
          WHEN ${migratedSnapshotMetadataValidSql}
            THEN source_snapshot_byte_length
          ELSE NULL
        END,
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
          WHEN ${invalidMigratedActiveBaseIdentitySql} THEN 'failed'
          WHEN ${invalidMigratedActiveSnapshotSql} AND structural_completed_at IS NOT NULL
            THEN 'degraded'
          WHEN ${invalidMigratedActiveSnapshotSql} THEN 'failed'
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
          WHEN ${invalidMigratedActiveBaseIdentitySql} THEN NULL
          WHEN ${invalidMigratedActiveSnapshotSql} AND structural_completed_at IS NOT NULL
            THEN 'structural_only'
          WHEN ${invalidMigratedActiveSnapshotSql} THEN NULL
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
          WHEN ${invalidMigratedActiveBaseIdentitySql} THEN 'source_identity_invalid'
          WHEN status IN ('pending', 'processing', 'retrying')
            AND (${migratedSnapshotMetadataMissingSql})
            THEN 'source_snapshot_missing'
          WHEN status IN ('pending', 'processing', 'retrying')
            AND (${migratedSnapshotMetadataInvalidSql})
            THEN 'source_snapshot_invalid'
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
            'source_snapshot_missing',
            'source_snapshot_invalid',
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
        NULL,
        CASE
          WHEN ${invalidMigratedActiveBaseIdentitySql} THEN NULL
          WHEN ${invalidMigratedActiveSnapshotSql} AND structural_completed_at IS NOT NULL
            THEN structural_completed_at
          WHEN ${invalidMigratedActiveSnapshotSql} THEN NULL
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

export function ensureIngestionQueueSchema(db: MemoryDb): void {
  createDurableIngestionJobsTable(db, INGESTION_JOBS_TABLE, true);
  ensureIngestionSourceSnapshotsTable(db);
  migrateLegacyIngestionQueue(db);
  ensureIngestionReceiptsTable(db);
  ensureIngestionStructuralReceiptsTable(db);
  ensureIngestionQueueIndexes(db);
  ensureIngestionSourceSnapshotGuards(db);
  failUnsealedActiveJobs(db);
  failActiveJobsWithInvalidSourceSnapshots(db, Date.now());
  ensureIngestionJobSourceSchema(db);
  ensureIngestionQueueSourceIdentity(db);
}
