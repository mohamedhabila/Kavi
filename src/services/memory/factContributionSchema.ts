import { runMemoryDatabaseSavepoint } from './access/databaseSavepoint';
import type { getMemoryDb } from './database';

type MemoryDb = ReturnType<typeof getMemoryDb>;

function ensureSupersessionProjectionIntentColumns(db: MemoryDb): void {
  const columns = new Set(
    db
      .getAllSync<{ name: string }>('PRAGMA table_info(memory_fact_contribution_supersessions)')
      .map((column) => column.name),
  );
  if (!columns.has('pinned_input_explicit')) {
    db.execSync(
      `ALTER TABLE memory_fact_contribution_supersessions
         ADD COLUMN pinned_input_explicit INTEGER NOT NULL DEFAULT 0
         CHECK(pinned_input_explicit IN (0, 1))`,
    );
  }
  if (!columns.has('review_state_input_explicit')) {
    db.execSync(
      `ALTER TABLE memory_fact_contribution_supersessions
         ADD COLUMN review_state_input_explicit INTEGER NOT NULL DEFAULT 0
         CHECK(review_state_input_explicit IN (0, 1))`,
    );
  }
}

/** Remove only triggers that reference memory_facts before its canonical table rebuild. */
export function dropFactContributionFactReferenceTriggers(db: MemoryDb): void {
  db.execSync(`
    DROP TRIGGER IF EXISTS trg_memory_fact_contribution_parent_insert;
    DROP TRIGGER IF EXISTS trg_memory_fact_contribution_supersession_parent_insert;
    DROP TRIGGER IF EXISTS trg_memory_fact_contribution_supersession_delete_immutable;
    DROP TRIGGER IF EXISTS trg_memory_fact_contribution_delete_immutable;
    DROP TRIGGER IF EXISTS trg_memory_fact_delete_contributions;
  `);
}

/** Canonical immutable ledger substrate. Population and replay are owned by later slices. */
export function ensureFactContributionSchema(db: MemoryDb): void {
  runMemoryDatabaseSavepoint(db, (database) => {
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

      CREATE TABLE IF NOT EXISTS memory_fact_contribution_supersessions (
        contribution_id TEXT NOT NULL,
        predecessor_fact_id TEXT NOT NULL CHECK(LENGTH(predecessor_fact_id) BETWEEN 1 AND 512),
        successor_fact_id TEXT NOT NULL CHECK(LENGTH(successor_fact_id) BETWEEN 1 AND 512),
        superseded_at INTEGER NOT NULL CHECK(superseded_at >= 0),
        pinned_input_explicit INTEGER NOT NULL DEFAULT 0
          CHECK(pinned_input_explicit IN (0, 1)),
        review_state_input_explicit INTEGER NOT NULL DEFAULT 0
          CHECK(review_state_input_explicit IN (0, 1)),
        CHECK(predecessor_fact_id != successor_fact_id),
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
      DROP TRIGGER IF EXISTS trg_memory_fact_contribution_source_immutable;
      DROP TRIGGER IF EXISTS trg_memory_fact_contribution_source_delete_immutable;
      DROP TRIGGER IF EXISTS trg_memory_fact_contribution_supersession_parent_insert;
      DROP TRIGGER IF EXISTS trg_memory_fact_contribution_supersession_immutable;
      DROP TRIGGER IF EXISTS trg_memory_fact_contribution_supersession_delete_immutable;
      DROP TRIGGER IF EXISTS trg_memory_fact_contribution_delete_dependents;
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
      BEGIN
        SELECT RAISE(ABORT, 'memory_fact_contribution_immutable');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_memory_fact_contribution_immutable
      BEFORE UPDATE ON memory_fact_contributions
      BEGIN
        SELECT RAISE(ABORT, 'memory_fact_contribution_immutable');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_memory_fact_contribution_delete_immutable
      BEFORE DELETE ON memory_fact_contributions
      WHEN EXISTS (SELECT 1 FROM memory_facts WHERE id = OLD.fact_id)
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

      CREATE TRIGGER IF NOT EXISTS trg_memory_fact_contribution_source_delete_immutable
      BEFORE DELETE ON memory_fact_contribution_sources
      WHEN EXISTS (
        SELECT 1 FROM memory_fact_contributions WHERE id = OLD.contribution_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'memory_fact_contribution_source_immutable');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_memory_fact_contribution_supersession_parent_insert
      BEFORE INSERT ON memory_fact_contribution_supersessions
      WHEN NOT EXISTS (
        SELECT 1
          FROM memory_fact_contributions AS contribution
          JOIN memory_facts AS predecessor ON predecessor.id = NEW.predecessor_fact_id
          JOIN memory_facts AS successor ON successor.id = NEW.successor_fact_id
         WHERE contribution.id = NEW.contribution_id
           AND contribution.fact_id = NEW.successor_fact_id
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

      CREATE TRIGGER IF NOT EXISTS trg_memory_fact_contribution_delete_dependents
      AFTER DELETE ON memory_fact_contributions
      BEGIN
        DELETE FROM memory_fact_contribution_sources
         WHERE contribution_id = OLD.id;
        DELETE FROM memory_fact_contribution_supersessions
         WHERE contribution_id = OLD.id;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_memory_fact_delete_contributions
      AFTER DELETE ON memory_facts
      BEGIN
        DELETE FROM memory_fact_contributions WHERE fact_id = OLD.id;
        DELETE FROM memory_fact_contribution_supersessions
         WHERE predecessor_fact_id = OLD.id OR successor_fact_id = OLD.id;
      END;
    `);
    ensureSupersessionProjectionIntentColumns(database);
  });
}

/** Privileged full-reset boundary; ordinary contribution deletion remains impossible. */
export function clearFactContributionLedgerForStructuredReset(db: MemoryDb): void {
  runMemoryDatabaseSavepoint(db, (database) => {
    database.execSync('DROP TRIGGER IF EXISTS trg_memory_fact_contribution_delete_immutable;');
    database.runSync('DELETE FROM memory_fact_contributions');
    ensureFactContributionSchema(database);
  });
}
