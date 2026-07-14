import { runMemoryDatabaseSavepoint } from './access/databaseSavepoint';
import type { getMemoryDb } from './database';
import {
  MEMORY_FACT_REVIEW_STATES,
  MEMORY_FACT_SENSITIVITY_LEVELS,
} from './facts/applicabilityProvenance';

type MemoryDb = ReturnType<typeof getMemoryDb>;

const MAX_SAFE_TIMESTAMP = Number.MAX_SAFE_INTEGER;
const REVIEW_STATES_SQL = MEMORY_FACT_REVIEW_STATES.map((value) => `'${value}'`).join(', ');
const SENSITIVITY_LEVELS_SQL = MEMORY_FACT_SENSITIVITY_LEVELS.map((value) => `'${value}'`).join(
  ', ',
);

/** Remove only explicit-override triggers that reference memory_facts before its rebuild. */
export function dropFactExplicitOverrideFactReferenceTriggers(db: MemoryDb): void {
  db.execSync(`
    DROP TRIGGER IF EXISTS trg_memory_fact_explicit_override_parent_insert;
    DROP TRIGGER IF EXISTS trg_memory_fact_explicit_override_insert_immutable;
    DROP TRIGGER IF EXISTS trg_memory_fact_explicit_override_update_guard;
    DROP TRIGGER IF EXISTS trg_memory_fact_explicit_override_delete_immutable;
    DROP TRIGGER IF EXISTS trg_memory_fact_explicit_override_parent_identity_immutable;
    DROP TRIGGER IF EXISTS trg_memory_fact_explicit_override_parent_insert_immutable;
    DROP TRIGGER IF EXISTS trg_memory_fact_delete_explicit_override;
    DROP TRIGGER IF EXISTS trg_memory_fact_retire_explicit_override;
  `);
}

/**
 * Canonical explicit intent sidecar. memory_facts remains a disposable projection;
 * this schema never infers intent from its projected columns.
 */
export function ensureFactExplicitOverrideSchema(db: MemoryDb): void {
  runMemoryDatabaseSavepoint(db, (database) => {
    database.execSync(`
      CREATE TABLE IF NOT EXISTS memory_fact_explicit_overrides (
        fact_id TEXT PRIMARY KEY CHECK(LENGTH(fact_id) BETWEEN 1 AND 512),
        memory_owner_id TEXT NOT NULL CHECK(LENGTH(memory_owner_id) BETWEEN 1 AND 160),
        pinned_override INTEGER CHECK(pinned_override IN (0, 1)),
        pinned_at INTEGER CHECK(
          pinned_at IS NULL
          OR (TYPEOF(pinned_at) = 'integer' AND pinned_at BETWEEN 0 AND ${MAX_SAFE_TIMESTAMP})
        ),
        review_state_override TEXT CHECK(review_state_override IN (${REVIEW_STATES_SQL})),
        review_state_at INTEGER CHECK(
          review_state_at IS NULL
          OR (
            TYPEOF(review_state_at) = 'integer'
            AND review_state_at BETWEEN 0 AND ${MAX_SAFE_TIMESTAMP}
          )
        ),
        sensitivity_floor TEXT CHECK(sensitivity_floor IN (${SENSITIVITY_LEVELS_SQL})),
        sensitivity_floor_at INTEGER CHECK(
          sensitivity_floor_at IS NULL
          OR (
            TYPEOF(sensitivity_floor_at) = 'integer'
            AND sensitivity_floor_at BETWEEN 0 AND ${MAX_SAFE_TIMESTAMP}
          )
        ),
        explicit_invalidated_at INTEGER CHECK(
          explicit_invalidated_at IS NULL
          OR (
            TYPEOF(explicit_invalidated_at) = 'integer'
            AND explicit_invalidated_at BETWEEN 0 AND ${MAX_SAFE_TIMESTAMP}
          )
        ),
        created_at INTEGER NOT NULL CHECK(
          TYPEOF(created_at) = 'integer'
          AND created_at BETWEEN 0 AND ${MAX_SAFE_TIMESTAMP}
        ),
        updated_at INTEGER NOT NULL CHECK(
          TYPEOF(updated_at) = 'integer'
          AND updated_at BETWEEN created_at AND ${MAX_SAFE_TIMESTAMP}
        ),
        CHECK((pinned_override IS NULL) = (pinned_at IS NULL)),
        CHECK((review_state_override IS NULL) = (review_state_at IS NULL)),
        CHECK((sensitivity_floor IS NULL) = (sensitivity_floor_at IS NULL)),
        CHECK(pinned_at IS NULL OR pinned_at BETWEEN created_at AND updated_at),
        CHECK(review_state_at IS NULL OR review_state_at BETWEEN created_at AND updated_at),
        CHECK(
          sensitivity_floor_at IS NULL
          OR sensitivity_floor_at BETWEEN created_at AND updated_at
        ),
        CHECK(
          explicit_invalidated_at IS NULL
          OR explicit_invalidated_at <= updated_at
        ),
        CHECK(
          pinned_override IS NOT NULL
          OR review_state_override IS NOT NULL
          OR sensitivity_floor IS NOT NULL
          OR explicit_invalidated_at IS NOT NULL
        )
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS idx_memory_fact_explicit_overrides_owner
        ON memory_fact_explicit_overrides(memory_owner_id, updated_at, fact_id);

      DROP TRIGGER IF EXISTS trg_memory_fact_explicit_override_parent_insert;
      DROP TRIGGER IF EXISTS trg_memory_fact_explicit_override_insert_immutable;
      DROP TRIGGER IF EXISTS trg_memory_fact_explicit_override_update_guard;
      DROP TRIGGER IF EXISTS trg_memory_fact_explicit_override_delete_immutable;
      DROP TRIGGER IF EXISTS trg_memory_fact_explicit_override_parent_identity_immutable;
      DROP TRIGGER IF EXISTS trg_memory_fact_explicit_override_parent_insert_immutable;
      DROP TRIGGER IF EXISTS trg_memory_fact_delete_explicit_override;
      DROP TRIGGER IF EXISTS trg_memory_fact_retire_explicit_override;

      CREATE TRIGGER trg_memory_fact_explicit_override_parent_insert
      BEFORE INSERT ON memory_fact_explicit_overrides
      WHEN NOT EXISTS (
        SELECT 1
          FROM memory_facts
         WHERE id = NEW.fact_id
           AND memory_owner_id = NEW.memory_owner_id
           AND deleted_at IS NULL
      )
      BEGIN
        SELECT RAISE(ABORT, 'memory_fact_explicit_override_parent_invalid');
      END;

      CREATE TRIGGER trg_memory_fact_explicit_override_insert_immutable
      BEFORE INSERT ON memory_fact_explicit_overrides
      WHEN EXISTS (
        SELECT 1 FROM memory_fact_explicit_overrides WHERE fact_id = NEW.fact_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'memory_fact_explicit_override_insert_immutable');
      END;

      CREATE TRIGGER trg_memory_fact_explicit_override_update_guard
      BEFORE UPDATE ON memory_fact_explicit_overrides
      BEGIN
        SELECT CASE
          WHEN NEW.fact_id != OLD.fact_id OR NEW.memory_owner_id != OLD.memory_owner_id
          THEN RAISE(ABORT, 'memory_fact_explicit_override_identity_immutable')
        END;
        SELECT CASE
          WHEN NOT EXISTS (
            SELECT 1
              FROM memory_facts
             WHERE id = NEW.fact_id
               AND memory_owner_id = NEW.memory_owner_id
               AND deleted_at IS NULL
          )
          THEN RAISE(ABORT, 'memory_fact_explicit_override_parent_invalid')
        END;
        SELECT CASE
          WHEN NEW.created_at != OLD.created_at OR NEW.updated_at < OLD.updated_at
          THEN RAISE(ABORT, 'memory_fact_explicit_override_clock_regression')
        END;
        SELECT CASE
          WHEN OLD.pinned_at IS NOT NULL AND NEW.pinned_at IS NULL
            OR (
              NEW.pinned_override IS OLD.pinned_override
              AND NEW.pinned_at IS NOT OLD.pinned_at
            )
            OR (
              NEW.pinned_override IS NOT OLD.pinned_override
              AND OLD.pinned_at IS NOT NULL
              AND NEW.pinned_at <= OLD.pinned_at
            )
          THEN RAISE(ABORT, 'memory_fact_explicit_override_pin_clock_invalid')
        END;
        SELECT CASE
          WHEN OLD.review_state_at IS NOT NULL AND NEW.review_state_at IS NULL
            OR (
              NEW.review_state_override IS OLD.review_state_override
              AND NEW.review_state_at IS NOT OLD.review_state_at
            )
            OR (
              NEW.review_state_override IS NOT OLD.review_state_override
              AND OLD.review_state_at IS NOT NULL
              AND NEW.review_state_at <= OLD.review_state_at
            )
          THEN RAISE(ABORT, 'memory_fact_explicit_override_review_clock_invalid')
        END;
        SELECT CASE
          WHEN OLD.sensitivity_floor_at IS NOT NULL AND NEW.sensitivity_floor_at IS NULL
            OR (
              NEW.sensitivity_floor IS OLD.sensitivity_floor
              AND NEW.sensitivity_floor_at IS NOT OLD.sensitivity_floor_at
            )
            OR (
              NEW.sensitivity_floor IS NOT OLD.sensitivity_floor
              AND OLD.sensitivity_floor_at IS NOT NULL
              AND NEW.sensitivity_floor_at <= OLD.sensitivity_floor_at
            )
            OR CASE OLD.sensitivity_floor
              WHEN 'normal' THEN 0
              WHEN 'personal' THEN 1
              WHEN 'sensitive' THEN 2
              WHEN 'restricted' THEN 3
              ELSE -1
            END > CASE NEW.sensitivity_floor
              WHEN 'normal' THEN 0
              WHEN 'personal' THEN 1
              WHEN 'sensitive' THEN 2
              WHEN 'restricted' THEN 3
              ELSE -1
            END
          THEN RAISE(ABORT, 'memory_fact_explicit_override_sensitivity_floor_invalid')
        END;
        SELECT CASE
          WHEN OLD.explicit_invalidated_at IS NOT NULL
            AND NEW.explicit_invalidated_at IS NOT OLD.explicit_invalidated_at
          THEN RAISE(ABORT, 'memory_fact_explicit_override_invalidation_immutable')
        END;
      END;

      CREATE TRIGGER trg_memory_fact_explicit_override_delete_immutable
      BEFORE DELETE ON memory_fact_explicit_overrides
      WHEN EXISTS (
        SELECT 1
          FROM memory_facts
         WHERE id = OLD.fact_id
           AND memory_owner_id = OLD.memory_owner_id
           AND deleted_at IS NULL
      )
      BEGIN
        SELECT RAISE(ABORT, 'memory_fact_explicit_override_delete_immutable');
      END;

      CREATE TRIGGER trg_memory_fact_explicit_override_parent_identity_immutable
      BEFORE UPDATE OF id, memory_owner_id ON memory_facts
      WHEN (NEW.id != OLD.id OR NEW.memory_owner_id IS NOT OLD.memory_owner_id)
        AND EXISTS (
          SELECT 1 FROM memory_fact_explicit_overrides WHERE fact_id = OLD.id
        )
      BEGIN
        SELECT RAISE(ABORT, 'memory_fact_explicit_override_parent_identity_immutable');
      END;

      CREATE TRIGGER trg_memory_fact_explicit_override_parent_insert_immutable
      BEFORE INSERT ON memory_facts
      WHEN EXISTS (
        SELECT 1 FROM memory_fact_explicit_overrides WHERE fact_id = NEW.id
      )
      BEGIN
        SELECT RAISE(ABORT, 'memory_fact_explicit_override_parent_insert_immutable');
      END;

      CREATE TRIGGER trg_memory_fact_delete_explicit_override
      AFTER DELETE ON memory_facts
      BEGIN
        DELETE FROM memory_fact_explicit_overrides WHERE fact_id = OLD.id;
      END;

    `);
  });
}
