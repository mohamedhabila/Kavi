import { runMemoryDatabaseSavepoint } from './access/databaseSavepoint';
import type { getMemoryDb } from './database';
import {
  MEMORY_SOURCE_RETIREMENT_CHILD_COMMITMENT_VERSION,
  MEMORY_SOURCE_RETIREMENT_CHILD_SET_LIMITS,
} from './sourceRetirementChildCommitments';
import { ensureMemoryVaultIdentitySchema } from './memoryVaultIdentity';
import { assertAllSourceRetirementOperationsIntegrity } from './sourceRetirementIntegrity';

type MemoryDb = ReturnType<typeof getMemoryDb>;

const SCHEMA_RESET_REQUIRED = 'memory_source_retirement_schema_reset_required';
const SAFE_INTEGER_MAX = Number.MAX_SAFE_INTEGER;
const VERSION = MEMORY_SOURCE_RETIREMENT_CHILD_COMMITMENT_VERSION;
const LIMITS = MEMORY_SOURCE_RETIREMENT_CHILD_SET_LIMITS;
const LEGACY_TABLE_NAMES = Object.freeze([
  'memory_withdrawals',
  'memory_withdrawal_facts',
  'memory_withdrawal_sources',
]);

const TABLE_DDL = Object.freeze({
  memory_source_retirement_groups: `
    CREATE TABLE memory_source_retirement_groups (
      id TEXT PRIMARY KEY CHECK(
        TYPEOF(id) = 'text' AND LENGTH(id) BETWEEN 1 AND 512
      ),
      memory_owner_id TEXT NOT NULL CHECK(
        TYPEOF(memory_owner_id) = 'text' AND LENGTH(memory_owner_id) BETWEEN 1 AND 160
      ),
      reason TEXT NOT NULL CHECK(reason IN (
        'fact_withdrawal', 'message_edit', 'message_retry', 'message_delete',
        'conversation_delete', 'memory_opt_out', 'memory_reset', 'ingestion_conflict'
      )),
      retired_at INTEGER NOT NULL CHECK(
        TYPEOF(retired_at) = 'integer' AND retired_at BETWEEN 0 AND ${SAFE_INTEGER_MAX}
      ),
      requested_source_set_version INTEGER NOT NULL CHECK(
        TYPEOF(requested_source_set_version) = 'integer'
        AND requested_source_set_version = ${VERSION}
      ),
      requested_source_set_count INTEGER NOT NULL CHECK(
        TYPEOF(requested_source_set_count) = 'integer'
        AND requested_source_set_count BETWEEN 1 AND ${LIMITS.requestedSources}
      ),
      requested_source_set_sha256 TEXT NOT NULL CHECK(
        TYPEOF(requested_source_set_sha256) = 'text'
        AND LENGTH(requested_source_set_sha256) = 64
        AND requested_source_set_sha256 NOT GLOB '*[^0-9a-f]*'
      ),
      closed_source_set_version INTEGER NOT NULL CHECK(
        TYPEOF(closed_source_set_version) = 'integer'
        AND closed_source_set_version = ${VERSION}
      ),
      closed_source_set_count INTEGER NOT NULL CHECK(
        TYPEOF(closed_source_set_count) = 'integer'
        AND closed_source_set_count BETWEEN 1 AND ${LIMITS.retiredSources}
      ),
      closed_source_set_sha256 TEXT NOT NULL CHECK(
        TYPEOF(closed_source_set_sha256) = 'text'
        AND LENGTH(closed_source_set_sha256) = 64
        AND closed_source_set_sha256 NOT GLOB '*[^0-9a-f]*'
      ),
      retired_contribution_set_version INTEGER NOT NULL CHECK(
        TYPEOF(retired_contribution_set_version) = 'integer'
        AND retired_contribution_set_version = ${VERSION}
      ),
      retired_contribution_set_count INTEGER NOT NULL CHECK(
        TYPEOF(retired_contribution_set_count) = 'integer'
        AND retired_contribution_set_count BETWEEN 0 AND ${LIMITS.retiredContributions}
      ),
      retired_contribution_set_sha256 TEXT NOT NULL CHECK(
        TYPEOF(retired_contribution_set_sha256) = 'text'
        AND LENGTH(retired_contribution_set_sha256) = 64
        AND retired_contribution_set_sha256 NOT GLOB '*[^0-9a-f]*'
      ),
      retired_fact_set_version INTEGER NOT NULL CHECK(
        TYPEOF(retired_fact_set_version) = 'integer'
        AND retired_fact_set_version = ${VERSION}
      ),
      retired_fact_set_count INTEGER NOT NULL CHECK(
        TYPEOF(retired_fact_set_count) = 'integer'
        AND retired_fact_set_count BETWEEN 0 AND ${LIMITS.retiredFacts}
      ),
      retired_fact_set_sha256 TEXT NOT NULL CHECK(
        TYPEOF(retired_fact_set_sha256) = 'text'
        AND LENGTH(retired_fact_set_sha256) = 64
        AND retired_fact_set_sha256 NOT GLOB '*[^0-9a-f]*'
      ),
      CHECK(closed_source_set_count >= requested_source_set_count)
    ) WITHOUT ROWID`,
  memory_source_retirement_requests: `
    CREATE TABLE memory_source_retirement_requests (
      retirement_group_id TEXT NOT NULL CHECK(
        TYPEOF(retirement_group_id) = 'text' AND LENGTH(retirement_group_id) BETWEEN 1 AND 512
      ),
      memory_owner_id TEXT NOT NULL CHECK(
        TYPEOF(memory_owner_id) = 'text' AND LENGTH(memory_owner_id) BETWEEN 1 AND 160
      ),
      memory_conversation_id TEXT NOT NULL CHECK(
        TYPEOF(memory_conversation_id) = 'text'
        AND LENGTH(memory_conversation_id) BETWEEN 1 AND 160
      ),
      source_thread_id TEXT NOT NULL CHECK(
        TYPEOF(source_thread_id) = 'text' AND LENGTH(source_thread_id) BETWEEN 1 AND 160
      ),
      task_id TEXT NOT NULL CHECK(TYPEOF(task_id) = 'text' AND LENGTH(task_id) <= 160),
      source_kind TEXT NOT NULL CHECK(
        TYPEOF(source_kind) = 'text' AND source_kind IN ('message', 'turn', 'run')
      ),
      source_id TEXT NOT NULL CHECK(
        TYPEOF(source_id) = 'text' AND LENGTH(source_id) BETWEEN 1 AND 512
      ),
      PRIMARY KEY(
        retirement_group_id, memory_owner_id, memory_conversation_id,
        source_thread_id, task_id, source_kind, source_id
      )
    ) WITHOUT ROWID`,
  memory_retired_sources: `
    CREATE TABLE memory_retired_sources (
      retirement_group_id TEXT NOT NULL CHECK(
        TYPEOF(retirement_group_id) = 'text' AND LENGTH(retirement_group_id) BETWEEN 1 AND 512
      ),
      memory_owner_id TEXT NOT NULL CHECK(
        TYPEOF(memory_owner_id) = 'text' AND LENGTH(memory_owner_id) BETWEEN 1 AND 160
      ),
      memory_conversation_id TEXT NOT NULL CHECK(
        TYPEOF(memory_conversation_id) = 'text'
        AND LENGTH(memory_conversation_id) BETWEEN 1 AND 160
      ),
      source_thread_id TEXT NOT NULL CHECK(
        TYPEOF(source_thread_id) = 'text' AND LENGTH(source_thread_id) BETWEEN 1 AND 160
      ),
      task_id TEXT NOT NULL CHECK(TYPEOF(task_id) = 'text' AND LENGTH(task_id) <= 160),
      source_kind TEXT NOT NULL CHECK(
        TYPEOF(source_kind) = 'text' AND source_kind IN ('message', 'turn', 'run')
      ),
      source_id TEXT NOT NULL CHECK(
        TYPEOF(source_id) = 'text' AND LENGTH(source_id) BETWEEN 1 AND 512
      ),
      PRIMARY KEY(
        memory_owner_id, memory_conversation_id, source_thread_id,
        task_id, source_kind, source_id
      )
    ) WITHOUT ROWID`,
  memory_retired_fact_contributions: `
    CREATE TABLE memory_retired_fact_contributions (
      contribution_id TEXT PRIMARY KEY CHECK(
        TYPEOF(contribution_id) = 'text'
        AND LENGTH(contribution_id) = 68
        AND SUBSTR(contribution_id, 1, 4) = 'mfc_'
        AND SUBSTR(contribution_id, 5) NOT GLOB '*[^0-9a-f]*'
      ),
      retirement_group_id TEXT NOT NULL CHECK(
        TYPEOF(retirement_group_id) = 'text' AND LENGTH(retirement_group_id) BETWEEN 1 AND 512
      )
    ) WITHOUT ROWID`,
  memory_retired_facts: `
    CREATE TABLE memory_retired_facts (
      fact_id TEXT PRIMARY KEY CHECK(
        TYPEOF(fact_id) = 'text' AND LENGTH(fact_id) BETWEEN 1 AND 512
      ),
      retirement_group_id TEXT NOT NULL CHECK(
        TYPEOF(retirement_group_id) = 'text' AND LENGTH(retirement_group_id) BETWEEN 1 AND 512
      )
    ) WITHOUT ROWID`,
});

const INDEX_DDL = Object.freeze({
  idx_memory_source_retirement_requests_exact: `
    CREATE INDEX idx_memory_source_retirement_requests_exact
      ON memory_source_retirement_requests(
        memory_owner_id, memory_conversation_id, source_thread_id,
        task_id, source_kind, source_id, retirement_group_id
      )`,
  idx_memory_retired_sources_group: `
    CREATE INDEX idx_memory_retired_sources_group
      ON memory_retired_sources(retirement_group_id)`,
  idx_memory_retired_fact_contributions_group: `
    CREATE INDEX idx_memory_retired_fact_contributions_group
      ON memory_retired_fact_contributions(retirement_group_id, contribution_id)`,
  idx_memory_retired_facts_group: `
    CREATE INDEX idx_memory_retired_facts_group
      ON memory_retired_facts(retirement_group_id, fact_id)`,
});

const TRIGGER_DDL = Object.freeze({
  trg_memory_source_retirement_group_owner: `
    CREATE TRIGGER trg_memory_source_retirement_group_owner
    BEFORE INSERT ON memory_source_retirement_groups
    WHEN NOT EXISTS (
      SELECT 1 FROM memory_vault_identity
       WHERE singleton = 1 AND owner_id = NEW.memory_owner_id
    )
    BEGIN SELECT RAISE(ABORT, 'memory_source_retirement_group_owner_invalid'); END`,
  trg_memory_source_retirement_group_update_immutable: `
    CREATE TRIGGER trg_memory_source_retirement_group_update_immutable
    BEFORE UPDATE ON memory_source_retirement_groups
    BEGIN SELECT RAISE(ABORT, 'memory_source_retirement_group_immutable'); END`,
  trg_memory_source_retirement_group_delete_immutable: `
    CREATE TRIGGER trg_memory_source_retirement_group_delete_immutable
    BEFORE DELETE ON memory_source_retirement_groups
    BEGIN SELECT RAISE(ABORT, 'memory_source_retirement_group_immutable'); END`,
  trg_memory_source_retirement_request_parent: `
    CREATE TRIGGER trg_memory_source_retirement_request_parent
    BEFORE INSERT ON memory_source_retirement_requests
    WHEN NOT EXISTS (
      SELECT 1 FROM memory_source_retirement_groups
       WHERE id = NEW.retirement_group_id AND memory_owner_id = NEW.memory_owner_id
    )
    BEGIN SELECT RAISE(ABORT, 'memory_source_retirement_request_parent_invalid'); END`,
  trg_memory_source_retirement_request_count: `
    CREATE TRIGGER trg_memory_source_retirement_request_count
    BEFORE INSERT ON memory_source_retirement_requests
    WHEN (
      SELECT COUNT(*) FROM memory_source_retirement_requests
       WHERE retirement_group_id = NEW.retirement_group_id
    ) >= (
      SELECT requested_source_set_count FROM memory_source_retirement_groups
       WHERE id = NEW.retirement_group_id
    )
    BEGIN SELECT RAISE(ABORT, 'memory_source_retirement_request_count_exceeded'); END`,
  trg_memory_source_retirement_request_update_immutable: `
    CREATE TRIGGER trg_memory_source_retirement_request_update_immutable
    BEFORE UPDATE ON memory_source_retirement_requests
    BEGIN SELECT RAISE(ABORT, 'memory_source_retirement_request_immutable'); END`,
  trg_memory_source_retirement_request_delete_immutable: `
    CREATE TRIGGER trg_memory_source_retirement_request_delete_immutable
    BEFORE DELETE ON memory_source_retirement_requests
    BEGIN SELECT RAISE(ABORT, 'memory_source_retirement_request_immutable'); END`,
  trg_memory_retired_source_parent: `
    CREATE TRIGGER trg_memory_retired_source_parent
    BEFORE INSERT ON memory_retired_sources
    WHEN NOT EXISTS (
      SELECT 1 FROM memory_source_retirement_groups
       WHERE id = NEW.retirement_group_id AND memory_owner_id = NEW.memory_owner_id
    )
    BEGIN SELECT RAISE(ABORT, 'memory_retired_source_parent_invalid'); END`,
  trg_memory_retired_source_count: `
    CREATE TRIGGER trg_memory_retired_source_count
    BEFORE INSERT ON memory_retired_sources
    WHEN (
      SELECT COUNT(*) FROM memory_retired_sources
       WHERE retirement_group_id = NEW.retirement_group_id
    ) >= (
      SELECT closed_source_set_count FROM memory_source_retirement_groups
       WHERE id = NEW.retirement_group_id
    )
    BEGIN SELECT RAISE(ABORT, 'memory_retired_source_count_exceeded'); END`,
  trg_memory_retired_source_update_immutable: `
    CREATE TRIGGER trg_memory_retired_source_update_immutable
    BEFORE UPDATE ON memory_retired_sources
    BEGIN SELECT RAISE(ABORT, 'memory_retired_source_immutable'); END`,
  trg_memory_retired_source_delete_immutable: `
    CREATE TRIGGER trg_memory_retired_source_delete_immutable
    BEFORE DELETE ON memory_retired_sources
    BEGIN SELECT RAISE(ABORT, 'memory_retired_source_immutable'); END`,
  trg_memory_retired_fact_contribution_parent: `
    CREATE TRIGGER trg_memory_retired_fact_contribution_parent
    BEFORE INSERT ON memory_retired_fact_contributions
    WHEN NOT EXISTS (
      SELECT 1
        FROM memory_source_retirement_groups AS parent
        JOIN memory_fact_contributions AS contribution
          ON contribution.id = NEW.contribution_id
         AND contribution.memory_owner_id = parent.memory_owner_id
       WHERE parent.id = NEW.retirement_group_id
    )
    BEGIN SELECT RAISE(ABORT, 'memory_retired_fact_contribution_parent_invalid'); END`,
  trg_memory_retired_fact_contribution_count: `
    CREATE TRIGGER trg_memory_retired_fact_contribution_count
    BEFORE INSERT ON memory_retired_fact_contributions
    WHEN (
      SELECT COUNT(*) FROM memory_retired_fact_contributions
       WHERE retirement_group_id = NEW.retirement_group_id
    ) >= (
      SELECT retired_contribution_set_count FROM memory_source_retirement_groups
       WHERE id = NEW.retirement_group_id
    )
    BEGIN SELECT RAISE(ABORT, 'memory_retired_fact_contribution_count_exceeded'); END`,
  trg_memory_retired_fact_contribution_update_immutable: `
    CREATE TRIGGER trg_memory_retired_fact_contribution_update_immutable
    BEFORE UPDATE ON memory_retired_fact_contributions
    BEGIN SELECT RAISE(ABORT, 'memory_retired_fact_contribution_immutable'); END`,
  trg_memory_retired_fact_contribution_delete_immutable: `
    CREATE TRIGGER trg_memory_retired_fact_contribution_delete_immutable
    BEFORE DELETE ON memory_retired_fact_contributions
    BEGIN SELECT RAISE(ABORT, 'memory_retired_fact_contribution_immutable'); END`,
  trg_memory_retired_fact_parent: `
    CREATE TRIGGER trg_memory_retired_fact_parent
    BEFORE INSERT ON memory_retired_facts
    WHEN NOT EXISTS (
      SELECT 1
        FROM memory_source_retirement_groups AS parent
        JOIN memory_facts AS fact
          ON fact.id = NEW.fact_id
         AND fact.memory_owner_id = parent.memory_owner_id
       WHERE parent.id = NEW.retirement_group_id
    )
    BEGIN SELECT RAISE(ABORT, 'memory_retired_fact_parent_invalid'); END`,
  trg_memory_retired_fact_count: `
    CREATE TRIGGER trg_memory_retired_fact_count
    BEFORE INSERT ON memory_retired_facts
    WHEN (
      SELECT COUNT(*) FROM memory_retired_facts
       WHERE retirement_group_id = NEW.retirement_group_id
    ) >= (
      SELECT retired_fact_set_count FROM memory_source_retirement_groups
       WHERE id = NEW.retirement_group_id
    )
    BEGIN SELECT RAISE(ABORT, 'memory_retired_fact_count_exceeded'); END`,
  trg_memory_retired_fact_update_immutable: `
    CREATE TRIGGER trg_memory_retired_fact_update_immutable
    BEFORE UPDATE ON memory_retired_facts
    BEGIN SELECT RAISE(ABORT, 'memory_retired_fact_immutable'); END`,
  trg_memory_retired_fact_delete_immutable: `
    CREATE TRIGGER trg_memory_retired_fact_delete_immutable
    BEFORE DELETE ON memory_retired_facts
    BEGIN SELECT RAISE(ABORT, 'memory_retired_fact_immutable'); END`,
  trg_memory_retired_fact_contribution_parent_identity_update: `
    CREATE TRIGGER trg_memory_retired_fact_contribution_parent_identity_update
    BEFORE UPDATE OF id, memory_owner_id ON memory_fact_contributions
    WHEN (NEW.id IS NOT OLD.id OR NEW.memory_owner_id IS NOT OLD.memory_owner_id)
     AND EXISTS (
       SELECT 1 FROM memory_retired_fact_contributions
        WHERE contribution_id = OLD.id
    )
    BEGIN SELECT RAISE(ABORT, 'memory_retired_fact_contribution_parent_immutable'); END`,
  trg_memory_retired_fact_parent_delete: `
    CREATE TRIGGER trg_memory_retired_fact_parent_delete
    BEFORE DELETE ON memory_facts
    WHEN NOT EXISTS (
      SELECT 1
        FROM memory_retired_facts AS retired
        JOIN memory_source_retirement_groups AS retirement
          ON retirement.id = retired.retirement_group_id
       WHERE retired.fact_id = OLD.id
         AND retirement.memory_owner_id = OLD.memory_owner_id
    )
      AND NOT EXISTS (
        SELECT 1 FROM memory_fact_legacy_quarantine WHERE fact_id = OLD.id
      )
    BEGIN SELECT RAISE(ABORT, 'memory_fact_delete_not_authorized'); END`,
  trg_memory_retired_fact_parent_insert: `
    CREATE TRIGGER trg_memory_retired_fact_parent_insert
    BEFORE INSERT ON memory_facts
    WHEN EXISTS (
      SELECT 1
        FROM memory_retired_facts AS retired
        JOIN memory_source_retirement_groups AS retirement
          ON retirement.id = retired.retirement_group_id
       WHERE retired.fact_id = NEW.id
         AND retirement.memory_owner_id = NEW.memory_owner_id
    )
    BEGIN SELECT RAISE(ABORT, 'memory_retired_fact_replay_forbidden'); END`,
  trg_memory_retired_fact_parent_identity_update: `
    CREATE TRIGGER trg_memory_retired_fact_parent_identity_update
    BEFORE UPDATE OF id, memory_owner_id ON memory_facts
    WHEN (NEW.id IS NOT OLD.id OR NEW.memory_owner_id IS NOT OLD.memory_owner_id)
     AND EXISTS (
       SELECT 1 FROM memory_retired_facts WHERE fact_id = OLD.id
     )
    BEGIN SELECT RAISE(ABORT, 'memory_retired_fact_parent_immutable'); END`,
});

const EXTERNAL_PARENT_TRIGGERS = Object.freeze({
  trg_memory_retired_fact_contribution_parent_identity_update: 'memory_fact_contributions',
  trg_memory_retired_fact_parent_delete: 'memory_facts',
  trg_memory_retired_fact_parent_insert: 'memory_facts',
  trg_memory_retired_fact_parent_identity_update: 'memory_facts',
});
const INTERNAL_TRIGGER_DDL = Object.freeze(
  Object.fromEntries(
    Object.entries(TRIGGER_DDL).filter(([name]) => !Object.hasOwn(EXTERNAL_PARENT_TRIGGERS, name)),
  ),
);

function failResetRequired(): never {
  throw new Error(SCHEMA_RESET_REQUIRED);
}

function tableSql(db: MemoryDb, tableName: string): string | null {
  return (
    db.getFirstSync<{ sql: string | null }>(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
      tableName,
    )?.sql ?? null
  );
}

function normalizeSql(value: string): string {
  return value.replace(/;\s*$/u, '').replace(/\s+/gu, ' ').trim();
}

function assertExactTables(db: MemoryDb): void {
  for (const [tableName, expectedSql] of Object.entries(TABLE_DDL)) {
    const actualSql = tableSql(db, tableName);
    if (!actualSql || normalizeSql(actualSql) !== normalizeSql(expectedSql)) failResetRequired();
  }
}

function assertExactNamedObjects(
  db: MemoryDb,
  type: 'index' | 'trigger',
  expectedNames: readonly string[],
  tableNames: readonly string[] = Object.keys(TABLE_DDL),
): void {
  const rows = db.getAllSync<{ name: string }>(
    `SELECT name FROM sqlite_master
      WHERE type = ? AND tbl_name IN (${tableNames.map(() => '?').join(', ')})
        AND sql IS NOT NULL`,
    type,
    ...tableNames,
  );
  const actual = rows.map((row) => row.name).sort();
  const expected = [...expectedNames].sort();
  if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
    failResetRequired();
  }
}

function assertExactDefinitions(
  db: MemoryDb,
  type: 'index' | 'trigger',
  expectedDdl: Readonly<Record<string, string>>,
): void {
  for (const [name, expectedSql] of Object.entries(expectedDdl)) {
    const actualSql =
      db.getFirstSync<{ sql: string | null }>(
        'SELECT sql FROM sqlite_master WHERE type = ? AND name = ?',
        type,
        name,
      )?.sql ?? null;
    if (!actualSql || normalizeSql(actualSql) !== normalizeSql(expectedSql)) failResetRequired();
  }
}

function assertExternalParentTriggers(db: MemoryDb): void {
  const expectedNames = Object.keys(EXTERNAL_PARENT_TRIGGERS);
  const rows = db.getAllSync<{ name: string; sql: string | null; tbl_name: string }>(
    `SELECT name, sql, tbl_name FROM sqlite_master
      WHERE type = 'trigger' AND name IN (${expectedNames.map(() => '?').join(', ')})`,
    ...expectedNames,
  );
  if (
    rows.length !== expectedNames.length ||
    rows.some(
      (row) =>
        EXTERNAL_PARENT_TRIGGERS[row.name as keyof typeof EXTERNAL_PARENT_TRIGGERS] !==
          row.tbl_name ||
        !row.sql ||
        normalizeSql(row.sql) !== normalizeSql(TRIGGER_DDL[row.name as keyof typeof TRIGGER_DDL]),
    )
  ) {
    failResetRequired();
  }
}

function assertNoOrphanedChildren(db: MemoryDb): void {
  const orphan = db.getFirstSync<{ present: number }>(`
    SELECT 1 AS present
      FROM (
        SELECT request.retirement_group_id AS group_id
          FROM memory_source_retirement_requests AS request
          LEFT JOIN memory_source_retirement_groups AS parent
            ON parent.id = request.retirement_group_id
           AND parent.memory_owner_id = request.memory_owner_id
         WHERE parent.id IS NULL
        UNION ALL
        SELECT source.retirement_group_id
          FROM memory_retired_sources AS source
          LEFT JOIN memory_source_retirement_groups AS parent
            ON parent.id = source.retirement_group_id
           AND parent.memory_owner_id = source.memory_owner_id
         WHERE parent.id IS NULL
        UNION ALL
        SELECT child.retirement_group_id
          FROM memory_retired_fact_contributions AS child
          LEFT JOIN memory_source_retirement_groups AS parent
            ON parent.id = child.retirement_group_id
         WHERE parent.id IS NULL
        UNION ALL
        SELECT child.retirement_group_id
          FROM memory_retired_facts AS child
          LEFT JOIN memory_source_retirement_groups AS parent
            ON parent.id = child.retirement_group_id
         WHERE parent.id IS NULL
      )
     LIMIT 1
  `);
  if (orphan) failResetRequired();
}

function assertCommittedChildCounts(db: MemoryDb): void {
  const mismatch = db.getFirstSync<{ present: number }>(`
    SELECT 1 AS present
      FROM memory_source_retirement_groups AS parent
     WHERE parent.requested_source_set_count != (
             SELECT COUNT(*) FROM memory_source_retirement_requests
              WHERE retirement_group_id = parent.id
           )
        OR parent.closed_source_set_count != (
             SELECT COUNT(*) FROM memory_retired_sources
              WHERE retirement_group_id = parent.id
           )
        OR parent.retired_contribution_set_count != (
             SELECT COUNT(*) FROM memory_retired_fact_contributions
              WHERE retirement_group_id = parent.id
           )
        OR parent.retired_fact_set_count != (
             SELECT COUNT(*) FROM memory_retired_facts
              WHERE retirement_group_id = parent.id
           )
     LIMIT 1
  `);
  if (mismatch) failResetRequired();
}

function installFreshSchema(db: MemoryDb): void {
  runMemoryDatabaseSavepoint(db, (database) => {
    for (const ddl of Object.values(TABLE_DDL)) database.execSync(ddl);
    for (const ddl of Object.values(INDEX_DDL)) database.execSync(ddl);
    for (const ddl of Object.values(TRIGGER_DDL)) database.execSync(ddl);
  });
}

export function isSourceRetirementSchemaResetRequired(error: unknown): boolean {
  return error instanceof Error && error.message.includes(SCHEMA_RESET_REQUIRED);
}

/** Install only a fresh canonical schema; legacy or partial layouts require an explicit reset. */
export function ensureSourceRetirementSchema(db: MemoryDb): void {
  const legacyTable = db.getFirstSync<{ name: string }>(
    `SELECT name FROM sqlite_master
      WHERE type = 'table' AND name IN (${LEGACY_TABLE_NAMES.map(() => '?').join(', ')})
      LIMIT 1`,
    ...LEGACY_TABLE_NAMES,
  );
  if (legacyTable) failResetRequired();
  const tableNames = Object.keys(TABLE_DDL);
  const expectedObjectNames = [
    ...tableNames,
    ...Object.keys(INDEX_DDL),
    ...Object.keys(TRIGGER_DDL),
  ];
  const existingObjects = db.getAllSync<{ name: string; type: string }>(
    `SELECT name, type FROM sqlite_master
      WHERE name IN (${expectedObjectNames.map(() => '?').join(', ')})`,
    ...expectedObjectNames,
  );
  const existingTables = existingObjects.filter(
    (object) => object.type === 'table' && tableNames.includes(object.name),
  );
  const existingCount = existingTables.length;
  if (existingCount !== 0 && existingCount !== tableNames.length) failResetRequired();
  if (existingCount === 0 && existingObjects.length !== 0) failResetRequired();

  ensureMemoryVaultIdentitySchema(db);
  if (existingCount === 0) installFreshSchema(db);

  assertExactTables(db);
  assertExactNamedObjects(db, 'index', Object.keys(INDEX_DDL));
  assertExactDefinitions(db, 'index', INDEX_DDL);
  assertExactNamedObjects(db, 'trigger', Object.keys(INTERNAL_TRIGGER_DDL));
  assertExactDefinitions(db, 'trigger', INTERNAL_TRIGGER_DDL);
  assertExternalParentTriggers(db);
  assertNoOrphanedChildren(db);
  assertCommittedChildCounts(db);
  assertAllSourceRetirementOperationsIntegrity(db);
}
