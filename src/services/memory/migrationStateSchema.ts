import type { getMemoryDb } from './database';

type MemoryDb = ReturnType<typeof getMemoryDb>;

const MIGRATION_STATE_TABLE = 'memory_migration_state';
const DURABLE_MIGRATION_STATE_TABLE = 'memory_migration_state_durable';

export const MIGRATION_STATUSES = ['pending', 'in_progress', 'completed', 'error'] as const;
export type MigrationStatus = (typeof MIGRATION_STATUSES)[number];

export const MIGRATION_ERROR_CODES = [
  'invalid_conversation',
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
  'persistence_failed',
  'claim_lost',
  'legacy_error_sanitized',
  'legacy_state_sanitized',
] as const;
export type MigrationErrorCode = (typeof MIGRATION_ERROR_CODES)[number];

function sqlList(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(', ');
}

function createMigrationStateTable(
  db: MemoryDb,
  table: typeof MIGRATION_STATE_TABLE | typeof DURABLE_MIGRATION_STATE_TABLE,
  ifNotExists: boolean,
): void {
  db.execSync(`
    CREATE TABLE ${ifNotExists ? 'IF NOT EXISTS ' : ''}${table} (
      conversation_id TEXT PRIMARY KEY,
      last_seeded_message_id TEXT,
      seeded_turns INTEGER NOT NULL DEFAULT 0 CHECK(seeded_turns >= 0),
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN (${sqlList(MIGRATION_STATUSES)})),
      error TEXT
        CHECK(error IS NULL OR error IN (${sqlList(MIGRATION_ERROR_CODES)})),
      claim_token TEXT,
      claim_expires_at INTEGER,
      updated_at INTEGER NOT NULL,
      CHECK(status = 'error' OR error IS NULL),
      CHECK(status != 'error' OR error IS NOT NULL),
      CHECK(
        (claim_token IS NULL AND claim_expires_at IS NULL)
        OR (claim_token IS NOT NULL AND claim_expires_at IS NOT NULL)
      ),
      CHECK(claim_token IS NULL OR LENGTH(TRIM(claim_token)) > 0),
      CHECK(claim_expires_at IS NULL OR claim_expires_at >= 0),
      CHECK(status NOT IN ('completed', 'error') OR claim_token IS NULL)
    );
  `);
}

function ensureColumn(db: MemoryDb, column: string, definition: string): void {
  const columns = db.getAllSync<{ name: string }>(`PRAGMA table_info(${MIGRATION_STATE_TABLE})`);
  if (columns.some((candidate) => candidate.name === column)) return;
  db.execSync(`ALTER TABLE ${MIGRATION_STATE_TABLE} ADD COLUMN ${definition}`);
}

function hasDurableContract(db: MemoryDb): boolean {
  const tableSql =
    db.getFirstSync<{ sql: string | null }>(
      `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`,
      MIGRATION_STATE_TABLE,
    )?.sql ?? '';
  const columns = new Set(
    db
      .getAllSync<{ name: string }>(`PRAGMA table_info(${MIGRATION_STATE_TABLE})`)
      .map((column) => column.name),
  );
  return (
    columns.has('claim_token') &&
    columns.has('claim_expires_at') &&
    tableSql.includes('CHECK(error IS NULL OR error IN') &&
    tableSql.includes("CHECK(status = 'error' OR error IS NULL)") &&
    tableSql.includes("CHECK(status != 'error' OR error IS NOT NULL)") &&
    tableSql.includes('(claim_token IS NULL AND claim_expires_at IS NULL)') &&
    tableSql.includes('CHECK(claim_token IS NULL OR LENGTH(TRIM(claim_token)) > 0)') &&
    tableSql.includes('CHECK(claim_expires_at IS NULL OR claim_expires_at >= 0)') &&
    MIGRATION_STATUSES.every((status) => tableSql.includes(`'${status}'`)) &&
    MIGRATION_ERROR_CODES.every((code) => tableSql.includes(`'${code}'`))
  );
}

/**
 * Upgrade the original free-form migration cursor to a constrained state
 * machine. Historical exception/provider text is deliberately replaced by a
 * bounded diagnostic code instead of being copied into the durable database.
 */
export function ensureMigrationStateSchema(db: MemoryDb): void {
  createMigrationStateTable(db, MIGRATION_STATE_TABLE, true);
  if (hasDurableContract(db)) {
    db.execSync(`
      CREATE INDEX IF NOT EXISTS idx_migration_status
        ON ${MIGRATION_STATE_TABLE}(status);
      CREATE INDEX IF NOT EXISTS idx_migration_claim_expiry
        ON ${MIGRATION_STATE_TABLE}(claim_expires_at);
    `);
    return;
  }

  ensureColumn(db, 'claim_token', 'claim_token TEXT');
  ensureColumn(db, 'claim_expires_at', 'claim_expires_at INTEGER');

  db.execSync('BEGIN IMMEDIATE TRANSACTION');
  try {
    db.execSync(`DROP TABLE IF EXISTS ${DURABLE_MIGRATION_STATE_TABLE}`);
    createMigrationStateTable(db, DURABLE_MIGRATION_STATE_TABLE, false);
    db.execSync(`
      INSERT INTO ${DURABLE_MIGRATION_STATE_TABLE} (
        conversation_id,
        last_seeded_message_id,
        seeded_turns,
        status,
        error,
        claim_token,
        claim_expires_at,
        updated_at
      )
      SELECT
        conversation_id,
        last_seeded_message_id,
        MAX(0, seeded_turns),
        CASE
          WHEN status IN (${sqlList(MIGRATION_STATUSES)}) THEN status
          ELSE 'error'
        END,
        CASE
          WHEN status NOT IN (${sqlList(MIGRATION_STATUSES)}) THEN 'legacy_state_sanitized'
          WHEN status = 'error' AND error IN (${sqlList(MIGRATION_ERROR_CODES)}) THEN error
          WHEN status = 'error' THEN 'legacy_error_sanitized'
          ELSE NULL
        END,
        CASE
          WHEN status IN ('pending', 'in_progress')
           AND NULLIF(TRIM(claim_token), '') IS NOT NULL
           AND claim_expires_at IS NOT NULL
          THEN claim_token
          ELSE NULL
        END,
        CASE
          WHEN status IN ('pending', 'in_progress')
           AND NULLIF(TRIM(claim_token), '') IS NOT NULL
           AND claim_expires_at IS NOT NULL
          THEN claim_expires_at
          ELSE NULL
        END,
        updated_at
      FROM ${MIGRATION_STATE_TABLE};
      DROP TABLE ${MIGRATION_STATE_TABLE};
      ALTER TABLE ${DURABLE_MIGRATION_STATE_TABLE} RENAME TO ${MIGRATION_STATE_TABLE};
      CREATE INDEX idx_migration_status
        ON ${MIGRATION_STATE_TABLE}(status);
      CREATE INDEX idx_migration_claim_expiry
        ON ${MIGRATION_STATE_TABLE}(claim_expires_at);
    `);
    db.execSync('COMMIT');
  } catch (error) {
    db.execSync('ROLLBACK');
    throw error;
  }
}
