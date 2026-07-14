import { runMemoryDatabaseSavepoint } from './access/databaseSavepoint';
import type { getMemoryDb } from './database';
import { MEMORY_FACT_CONTRIBUTION_MAX_SUPERSESSION_EDGES } from './factContributionChildCommitments';
import { MEMORY_FACT_CONTRIBUTION_LIMITS } from './factContributionCodec';

type MemoryDb = ReturnType<typeof getMemoryDb>;

const REQUIRED_CHILD_SET_COMMITMENT_COLUMNS = [
  'source_set_version',
  'source_set_count',
  'source_set_sha256',
  'supersession_set_version',
  'supersession_set_count',
  'supersession_set_sha256',
] as const;
const SCHEMA_RESET_REQUIRED = 'memory_fact_contribution_schema_reset_required';

export function isFactContributionSchemaResetRequired(error: unknown): boolean {
  return error instanceof Error && error.message.includes(SCHEMA_RESET_REQUIRED);
}

function assertFreshFactContributionParentSchema(db: MemoryDb): void {
  const parentExists = db.getFirstSync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_fact_contributions'",
  );
  if (!parentExists) return;
  const columns = db
    .getAllSync<{ name: string }>('PRAGMA table_info(memory_fact_contributions)')
    .map((column) => column.name);
  const commitmentColumns = columns.filter(
    (column) => column.startsWith('source_set_') || column.startsWith('supersession_set_'),
  );
  if (
    commitmentColumns.length !== REQUIRED_CHILD_SET_COMMITMENT_COLUMNS.length ||
    REQUIRED_CHILD_SET_COMMITMENT_COLUMNS.some((column) => !commitmentColumns.includes(column))
  ) {
    throw new Error(SCHEMA_RESET_REQUIRED);
  }
}

/** Remove only triggers that reference memory_facts before its canonical table rebuild. */
export function dropFactContributionFactReferenceTriggers(db: MemoryDb): void {
  db.execSync(`
    DROP TRIGGER IF EXISTS trg_memory_fact_contribution_parent_insert;
    DROP TRIGGER IF EXISTS trg_memory_fact_contribution_supersession_snapshot_parent_insert;
    DROP TRIGGER IF EXISTS trg_memory_fact_contribution_supersession_parent_insert;
    DROP TRIGGER IF EXISTS trg_memory_fact_contribution_supersession_delete_immutable;
    DROP TRIGGER IF EXISTS trg_memory_fact_contribution_delete_immutable;
    DROP TRIGGER IF EXISTS trg_memory_fact_predecessor_delete_committed;
    DROP TRIGGER IF EXISTS trg_memory_fact_delete_contributions;
  `);
}

/** Canonical immutable ledger substrate. Population and replay are owned by later slices. */
export function ensureFactContributionSchema(db: MemoryDb): void {
  runMemoryDatabaseSavepoint(db, (database) => {
    assertFreshFactContributionParentSchema(database);
    database.execSync(`
      CREATE TABLE IF NOT EXISTS memory_fact_contributions (
        id TEXT PRIMARY KEY
          CHECK(LENGTH(id) = 68 AND SUBSTR(id, 1, 4) = 'mfc_'),
        fact_id TEXT NOT NULL CHECK(LENGTH(fact_id) BETWEEN 1 AND 512),
        memory_owner_id TEXT NOT NULL CHECK(LENGTH(memory_owner_id) BETWEEN 1 AND 160),
        memory_conversation_id TEXT NOT NULL
          CHECK(LENGTH(memory_conversation_id) BETWEEN 1 AND 160),
        source_thread_id TEXT NOT NULL CHECK(LENGTH(source_thread_id) BETWEEN 1 AND 160),
        task_id TEXT NOT NULL CHECK(LENGTH(task_id) <= 160),
        producer_id TEXT NOT NULL CHECK(LENGTH(producer_id) BETWEEN 1 AND 160),
        producer_event_id TEXT NOT NULL CHECK(LENGTH(producer_event_id) BETWEEN 1 AND 512),
        source_set_version INTEGER NOT NULL CHECK(
          TYPEOF(source_set_version) = 'integer'
          AND source_set_version = 1
        ),
        source_set_count INTEGER NOT NULL CHECK(
          TYPEOF(source_set_count) = 'integer'
          AND source_set_count BETWEEN 1 AND ${MEMORY_FACT_CONTRIBUTION_LIMITS.sourceAliases}
        ),
        source_set_sha256 TEXT NOT NULL CHECK(
          TYPEOF(source_set_sha256) = 'text'
          AND LENGTH(source_set_sha256) = 64
          AND source_set_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
        supersession_set_version INTEGER NOT NULL CHECK(
          TYPEOF(supersession_set_version) = 'integer'
          AND supersession_set_version = 1
        ),
        supersession_set_count INTEGER NOT NULL CHECK(
          TYPEOF(supersession_set_count) = 'integer'
          AND (
            supersession_set_count = 0
            OR supersession_set_count BETWEEN 2 AND ${
              MEMORY_FACT_CONTRIBUTION_MAX_SUPERSESSION_EDGES + 1
            }
          )
        ),
        supersession_set_sha256 TEXT NOT NULL CHECK(
          TYPEOF(supersession_set_sha256) = 'text'
          AND LENGTH(supersession_set_sha256) = 64
          AND supersession_set_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
        payload_version INTEGER NOT NULL CHECK(payload_version = 1),
        payload_json TEXT NOT NULL CHECK(LENGTH(payload_json) > 0),
        payload_sha256 TEXT NOT NULL
          CHECK(
            LENGTH(payload_sha256) = 64
            AND payload_sha256 NOT GLOB '*[^0-9a-f]*'
          ),
        payload_byte_length INTEGER NOT NULL
          CHECK(payload_byte_length BETWEEN 1 AND 65536),
        contributed_at INTEGER NOT NULL CHECK(contributed_at >= 0),
        UNIQUE(
          memory_owner_id,
          memory_conversation_id,
          source_thread_id,
          task_id,
          producer_id,
          producer_event_id
        )
      );
      CREATE INDEX IF NOT EXISTS idx_memory_fact_contributions_fact
        ON memory_fact_contributions(fact_id, contributed_at, id);
      CREATE INDEX IF NOT EXISTS idx_memory_fact_contributions_scope
        ON memory_fact_contributions(
          memory_owner_id,
          memory_conversation_id,
          source_thread_id,
          task_id,
          contributed_at,
          id
        );

      CREATE TABLE IF NOT EXISTS memory_fact_contribution_sources (
        contribution_id TEXT NOT NULL,
        memory_owner_id TEXT NOT NULL CHECK(LENGTH(memory_owner_id) BETWEEN 1 AND 160),
        memory_conversation_id TEXT NOT NULL
          CHECK(LENGTH(memory_conversation_id) BETWEEN 1 AND 160),
        source_thread_id TEXT NOT NULL CHECK(LENGTH(source_thread_id) BETWEEN 1 AND 160),
        task_id TEXT NOT NULL CHECK(LENGTH(task_id) <= 160),
        source_kind TEXT NOT NULL CHECK(source_kind IN ('message', 'turn', 'run')),
        source_id TEXT NOT NULL CHECK(LENGTH(source_id) BETWEEN 1 AND 512),
        PRIMARY KEY(contribution_id, source_kind, source_id)
      );
      CREATE INDEX IF NOT EXISTS idx_memory_fact_contribution_sources_exact
        ON memory_fact_contribution_sources(
          memory_owner_id,
          memory_conversation_id,
          source_thread_id,
          task_id,
          source_kind,
          source_id,
          contribution_id
        );
      CREATE INDEX IF NOT EXISTS idx_memory_fact_contribution_sources_contribution
        ON memory_fact_contribution_sources(contribution_id, source_kind, source_id);

      CREATE TABLE IF NOT EXISTS memory_fact_contribution_supersession_snapshots (
        contribution_id TEXT PRIMARY KEY,
        successor_fact_id TEXT NOT NULL UNIQUE
          CHECK(LENGTH(successor_fact_id) BETWEEN 1 AND 512),
        superseded_at INTEGER NOT NULL CHECK(
          TYPEOF(superseded_at) = 'integer'
          AND superseded_at BETWEEN 0 AND 9007199254740991
        ),
        snapshot_version INTEGER NOT NULL CHECK(
          TYPEOF(snapshot_version) = 'integer'
          AND snapshot_version = 1
        ),
        pinned_input_explicit INTEGER NOT NULL CHECK(
          TYPEOF(pinned_input_explicit) = 'integer'
          AND pinned_input_explicit IN (0, 1)
        ),
        review_state_input_explicit INTEGER NOT NULL CHECK(
          TYPEOF(review_state_input_explicit) = 'integer'
          AND review_state_input_explicit IN (0, 1)
        ),
        successor_pinned_baseline INTEGER NOT NULL CHECK(
          TYPEOF(successor_pinned_baseline) = 'integer'
          AND successor_pinned_baseline IN (0, 1)
        ),
        successor_review_state_baseline TEXT NOT NULL CHECK(
          TYPEOF(successor_review_state_baseline) = 'text'
          AND successor_review_state_baseline IN (
            'auto', 'verified', 'pending_review', 'stale', 'conflicted', 'rejected'
          )
        ),
        successor_sensitivity_floor TEXT NOT NULL CHECK(
          TYPEOF(successor_sensitivity_floor) = 'text'
          AND successor_sensitivity_floor IN (
            'normal', 'personal', 'sensitive', 'restricted'
          )
        ),
        successor_sensitivity_policy_version INTEGER NOT NULL CHECK(
          TYPEOF(successor_sensitivity_policy_version) = 'integer'
          AND successor_sensitivity_policy_version BETWEEN 1 AND 2147483647
        )
      ) WITHOUT ROWID;

      CREATE TABLE IF NOT EXISTS memory_fact_contribution_supersessions (
        contribution_id TEXT NOT NULL,
        predecessor_fact_id TEXT NOT NULL CHECK(LENGTH(predecessor_fact_id) BETWEEN 1 AND 512),
        successor_fact_id TEXT NOT NULL CHECK(LENGTH(successor_fact_id) BETWEEN 1 AND 512),
        superseded_at INTEGER NOT NULL CHECK(
          TYPEOF(superseded_at) = 'integer'
          AND superseded_at BETWEEN 0 AND 9007199254740991
        ),
        CHECK(predecessor_fact_id != successor_fact_id),
        UNIQUE(predecessor_fact_id),
        PRIMARY KEY(contribution_id, predecessor_fact_id, successor_fact_id)
      );
      CREATE INDEX IF NOT EXISTS idx_memory_fact_contribution_supersessions_predecessor
        ON memory_fact_contribution_supersessions(predecessor_fact_id, superseded_at);
      CREATE INDEX IF NOT EXISTS idx_memory_fact_contribution_supersessions_successor
        ON memory_fact_contribution_supersessions(successor_fact_id, superseded_at);

      DROP TRIGGER IF EXISTS trg_memory_fact_contribution_parent_insert;
      DROP TRIGGER IF EXISTS trg_memory_fact_contribution_insert_immutable;
      DROP TRIGGER IF EXISTS trg_memory_fact_contribution_immutable;
      DROP TRIGGER IF EXISTS trg_memory_fact_contribution_delete_immutable;
      DROP TRIGGER IF EXISTS trg_memory_fact_contribution_source_parent_insert;
      DROP TRIGGER IF EXISTS trg_memory_fact_contribution_source_count;
      DROP TRIGGER IF EXISTS trg_memory_fact_contribution_source_immutable;
      DROP TRIGGER IF EXISTS trg_memory_fact_contribution_source_delete_immutable;
      DROP TRIGGER IF EXISTS trg_memory_fact_contribution_supersession_snapshot_parent_insert;
      DROP TRIGGER IF EXISTS trg_memory_fact_contribution_supersession_snapshot_immutable;
      DROP TRIGGER IF EXISTS trg_memory_fact_contribution_supersession_snapshot_delete_immutable;
      DROP TRIGGER IF EXISTS trg_memory_fact_contribution_supersession_parent_insert;
      DROP TRIGGER IF EXISTS trg_memory_fact_contribution_supersession_immutable;
      DROP TRIGGER IF EXISTS trg_memory_fact_contribution_supersession_delete_immutable;
      DROP TRIGGER IF EXISTS trg_memory_fact_contribution_supersession_delete_snapshot;
      DROP TRIGGER IF EXISTS trg_memory_fact_contribution_delete_dependents;
      DROP TRIGGER IF EXISTS trg_memory_fact_predecessor_delete_committed;
      DROP TRIGGER IF EXISTS trg_memory_fact_delete_contributions;

      CREATE TRIGGER IF NOT EXISTS trg_memory_fact_contribution_parent_insert
      BEFORE INSERT ON memory_fact_contributions
      WHEN NOT EXISTS (
        SELECT 1
          FROM memory_facts
         WHERE id = NEW.fact_id
           AND memory_owner_id = NEW.memory_owner_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'memory_fact_contribution_parent_invalid');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_memory_fact_contribution_insert_immutable
      BEFORE INSERT ON memory_fact_contributions
      WHEN EXISTS (
        SELECT 1
          FROM memory_fact_contributions
         WHERE id = NEW.id
            OR (
              memory_owner_id = NEW.memory_owner_id
              AND memory_conversation_id = NEW.memory_conversation_id
              AND source_thread_id = NEW.source_thread_id
              AND task_id = NEW.task_id
              AND producer_id = NEW.producer_id
              AND producer_event_id = NEW.producer_event_id
            )
      )
      OR EXISTS (
        SELECT 1
          FROM memory_retired_fact_contributions AS retired
          JOIN memory_source_retirement_groups AS retirement
            ON retirement.id = retired.retirement_group_id
         WHERE retired.contribution_id = NEW.id
           AND retirement.memory_owner_id = NEW.memory_owner_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'memory_fact_contribution_immutable');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_memory_fact_contribution_immutable
      BEFORE UPDATE ON memory_fact_contributions
      BEGIN
        SELECT RAISE(ABORT, 'memory_fact_contribution_immutable');
      END;

      CREATE TRIGGER trg_memory_fact_contribution_delete_immutable
      BEFORE DELETE ON memory_fact_contributions
      WHEN NOT EXISTS (
        SELECT 1
          FROM memory_retired_fact_contributions AS retired
          JOIN memory_source_retirement_groups AS retirement
            ON retirement.id = retired.retirement_group_id
         WHERE retired.contribution_id = OLD.id
           AND retirement.memory_owner_id = OLD.memory_owner_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'memory_fact_contribution_immutable');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_memory_fact_contribution_source_parent_insert
      BEFORE INSERT ON memory_fact_contribution_sources
      WHEN NOT EXISTS (
        SELECT 1
          FROM memory_fact_contributions
         WHERE id = NEW.contribution_id
           AND memory_owner_id = NEW.memory_owner_id
           AND memory_conversation_id = NEW.memory_conversation_id
           AND source_thread_id = NEW.source_thread_id
           AND task_id = NEW.task_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'memory_fact_contribution_source_parent_invalid');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_memory_fact_contribution_source_immutable
      BEFORE UPDATE ON memory_fact_contribution_sources
      BEGIN
        SELECT RAISE(ABORT, 'memory_fact_contribution_source_immutable');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_memory_fact_contribution_source_count
      BEFORE INSERT ON memory_fact_contribution_sources
      WHEN EXISTS (
        SELECT 1
          FROM memory_fact_contributions AS contribution
         WHERE contribution.id = NEW.contribution_id
           AND contribution.memory_owner_id = NEW.memory_owner_id
           AND contribution.memory_conversation_id = NEW.memory_conversation_id
           AND contribution.source_thread_id = NEW.source_thread_id
           AND contribution.task_id = NEW.task_id
           AND (
             SELECT COUNT(*)
               FROM memory_fact_contribution_sources AS source
              WHERE source.contribution_id = NEW.contribution_id
           ) >= contribution.source_set_count
      )
      BEGIN
        SELECT RAISE(ABORT, 'memory_fact_contribution_source_count_exceeded');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_memory_fact_contribution_source_delete_immutable
      BEFORE DELETE ON memory_fact_contribution_sources
      WHEN EXISTS (
        SELECT 1 FROM memory_fact_contributions WHERE id = OLD.contribution_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'memory_fact_contribution_source_immutable');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_memory_fact_contribution_supersession_snapshot_parent_insert
      BEFORE INSERT ON memory_fact_contribution_supersession_snapshots
      WHEN NOT EXISTS (
        SELECT 1
          FROM memory_fact_contributions AS contribution
          JOIN memory_facts AS successor ON successor.id = NEW.successor_fact_id
         WHERE contribution.id = NEW.contribution_id
           AND contribution.fact_id = NEW.successor_fact_id
           AND contribution.memory_owner_id = successor.memory_owner_id
           AND contribution.supersession_set_count >= 2
           AND contribution.contributed_at = NEW.superseded_at
           AND successor.created_at = NEW.superseded_at
           AND successor.invalid_at IS NULL
           AND successor.deleted_at IS NULL
           AND successor.pinned = NEW.successor_pinned_baseline
           AND successor.review_state = NEW.successor_review_state_baseline
           AND successor.sensitivity = NEW.successor_sensitivity_floor
           AND successor.sensitivity_policy_version =
                 NEW.successor_sensitivity_policy_version
      )
      BEGIN
        SELECT RAISE(ABORT, 'memory_fact_contribution_supersession_snapshot_parent_invalid');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_memory_fact_contribution_supersession_snapshot_immutable
      BEFORE UPDATE ON memory_fact_contribution_supersession_snapshots
      BEGIN
        SELECT RAISE(ABORT, 'memory_fact_contribution_supersession_snapshot_immutable');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_memory_fact_contribution_supersession_snapshot_delete_immutable
      BEFORE DELETE ON memory_fact_contribution_supersession_snapshots
      WHEN EXISTS (
        SELECT 1 FROM memory_fact_contributions WHERE id = OLD.contribution_id
      )
      AND EXISTS (
        SELECT 1
          FROM memory_fact_contribution_supersessions
         WHERE contribution_id = OLD.contribution_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'memory_fact_contribution_supersession_snapshot_immutable');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_memory_fact_contribution_supersession_parent_insert
      BEFORE INSERT ON memory_fact_contribution_supersessions
      WHEN NOT EXISTS (
        SELECT 1
          FROM memory_fact_contributions AS contribution
          JOIN memory_fact_contribution_supersession_snapshots AS snapshot
            ON snapshot.contribution_id = contribution.id
          JOIN memory_facts AS predecessor ON predecessor.id = NEW.predecessor_fact_id
          JOIN memory_facts AS successor ON successor.id = NEW.successor_fact_id
         WHERE contribution.id = NEW.contribution_id
           AND contribution.fact_id = NEW.successor_fact_id
           AND (
             SELECT COUNT(*)
               FROM memory_fact_contribution_supersessions AS edge
              WHERE edge.contribution_id = NEW.contribution_id
           ) < contribution.supersession_set_count - 1
           AND snapshot.successor_fact_id = NEW.successor_fact_id
           AND snapshot.superseded_at = NEW.superseded_at
           AND predecessor.memory_owner_id = contribution.memory_owner_id
           AND successor.memory_owner_id = contribution.memory_owner_id
           AND predecessor.subject_id = successor.subject_id
           AND predecessor.predicate = successor.predicate COLLATE NOCASE
           AND predecessor.scope = successor.scope
           AND predecessor.invalid_at = NEW.superseded_at
           AND (
             (
               successor.scope = 'global'
               AND predecessor.persona_id IS NULL
               AND successor.persona_id IS NULL
               AND predecessor.origin_conversation_id IS NULL
               AND successor.origin_conversation_id IS NULL
               AND predecessor.origin_thread_id IS NULL
               AND successor.origin_thread_id IS NULL
               AND predecessor.origin_task_id IS NULL
               AND successor.origin_task_id IS NULL
             )
             OR (
               successor.scope = 'persona'
               AND predecessor.persona_id = successor.persona_id
               AND predecessor.origin_conversation_id IS NULL
               AND successor.origin_conversation_id IS NULL
               AND predecessor.origin_thread_id IS NULL
               AND successor.origin_thread_id IS NULL
               AND predecessor.origin_task_id IS NULL
               AND successor.origin_task_id IS NULL
             )
             OR (
               successor.scope IN ('conversation', 'project')
               AND predecessor.persona_id IS NULL
               AND successor.persona_id IS NULL
               AND predecessor.origin_conversation_id = successor.origin_conversation_id
               AND predecessor.origin_task_id IS NULL
               AND successor.origin_task_id IS NULL
             )
             OR (
               successor.scope = 'session'
               AND predecessor.persona_id IS NULL
               AND successor.persona_id IS NULL
               AND predecessor.origin_conversation_id = successor.origin_conversation_id
               AND predecessor.origin_thread_id = successor.origin_thread_id
               AND predecessor.origin_task_id = successor.origin_task_id
             )
           )
      )
      BEGIN
        SELECT RAISE(ABORT, 'memory_fact_contribution_supersession_parent_invalid');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_memory_fact_contribution_supersession_immutable
      BEFORE UPDATE ON memory_fact_contribution_supersessions
      BEGIN
        SELECT RAISE(ABORT, 'memory_fact_contribution_supersession_immutable');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_memory_fact_contribution_supersession_delete_immutable
      BEFORE DELETE ON memory_fact_contribution_supersessions
      WHEN EXISTS (
        SELECT 1 FROM memory_fact_contributions WHERE id = OLD.contribution_id
      )
      AND EXISTS (SELECT 1 FROM memory_facts WHERE id = OLD.predecessor_fact_id)
      AND EXISTS (SELECT 1 FROM memory_facts WHERE id = OLD.successor_fact_id)
      BEGIN
        SELECT RAISE(ABORT, 'memory_fact_contribution_supersession_immutable');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_memory_fact_contribution_supersession_delete_snapshot
      AFTER DELETE ON memory_fact_contribution_supersessions
      WHEN NOT EXISTS (
        SELECT 1
          FROM memory_fact_contribution_supersessions
         WHERE contribution_id = OLD.contribution_id
      )
      BEGIN
        DELETE FROM memory_fact_contribution_supersession_snapshots
         WHERE contribution_id = OLD.contribution_id
           AND successor_fact_id = OLD.successor_fact_id
           AND superseded_at = OLD.superseded_at;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_memory_fact_contribution_delete_dependents
      AFTER DELETE ON memory_fact_contributions
      BEGIN
        DELETE FROM memory_fact_contribution_sources
         WHERE contribution_id = OLD.id;
        DELETE FROM memory_fact_contribution_supersessions
         WHERE contribution_id = OLD.id;
        DELETE FROM memory_fact_contribution_supersession_snapshots
         WHERE contribution_id = OLD.id;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_memory_fact_predecessor_delete_committed
      BEFORE DELETE ON memory_facts
      WHEN EXISTS (
        SELECT 1
          FROM memory_fact_contribution_supersessions AS edge
          JOIN memory_fact_contributions AS contribution
            ON contribution.id = edge.contribution_id
           AND contribution.fact_id = edge.successor_fact_id
         WHERE edge.predecessor_fact_id = OLD.id
      )
      BEGIN
        SELECT RAISE(ABORT, 'memory_fact_contribution_predecessor_delete_committed');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_memory_fact_delete_contributions
      AFTER DELETE ON memory_facts
      BEGIN
        DELETE FROM memory_fact_contributions WHERE fact_id = OLD.id;
        DELETE FROM memory_fact_contribution_supersessions
         WHERE predecessor_fact_id = OLD.id OR successor_fact_id = OLD.id;
      END;
    `);
  });
}

/** Drop the causal parent ledger inside the privileged full-reset boundary. */
export function dropFactContributionLedgerForStructuredReset(db: MemoryDb): void {
  runMemoryDatabaseSavepoint(db, (database) => {
    dropFactContributionFactReferenceTriggers(database);
    database.execSync(`
      DROP TABLE IF EXISTS memory_fact_contribution_supersessions;
      DROP TABLE IF EXISTS memory_fact_contribution_supersession_snapshots;
      DROP TABLE IF EXISTS memory_fact_contribution_sources;
      DROP TABLE IF EXISTS memory_fact_contributions;
    `);
  });
}
