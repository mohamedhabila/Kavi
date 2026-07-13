import { runMemoryDatabaseSavepoint } from './access/databaseSavepoint';
import type { getMemoryDb } from './database';

type MemoryDb = ReturnType<typeof getMemoryDb>;

export const MEMORY_FACT_CONTRIBUTION_ADMISSION_VERSION = 1 as const;

export const MEMORY_FACT_LEGACY_QUARANTINE_REASONS = [
  'identity_invalid',
  'payload_invalid',
  'source_missing',
  'source_scope_unproven',
  'source_scope_ambiguous',
  'source_retired',
  'limits_exceeded',
] as const;

/**
 * Permanent one-way migration state for the immutable fact-contribution ledger.
 *
 * The completion marker is intentionally preserved by structured-memory clears:
 * once a database has crossed the contribution boundary, runtime code must never
 * reinterpret later facts as legacy rows. Quarantine contains opaque diagnostics
 * only and is cleared with the user's structured memory.
 */
export function ensureFactContributionAdmissionSchema(db: MemoryDb): void {
  runMemoryDatabaseSavepoint(db, (database) => {
    database.execSync(`
      CREATE TABLE IF NOT EXISTS memory_fact_contribution_admission (
        singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
        version INTEGER NOT NULL CHECK(version = ${MEMORY_FACT_CONTRIBUTION_ADMISSION_VERSION}),
        completed_at INTEGER NOT NULL CHECK(completed_at >= 0),
        admitted_count INTEGER NOT NULL CHECK(admitted_count >= 0),
        quarantined_count INTEGER NOT NULL CHECK(quarantined_count >= 0)
      );

      CREATE TABLE IF NOT EXISTS memory_fact_legacy_quarantine (
        fact_id TEXT PRIMARY KEY CHECK(LENGTH(fact_id) BETWEEN 1 AND 512),
        reason TEXT NOT NULL CHECK(reason IN (
          ${MEMORY_FACT_LEGACY_QUARANTINE_REASONS.map((reason) => `'${reason}'`).join(', ')}
        )),
        quarantined_at INTEGER NOT NULL CHECK(quarantined_at >= 0)
      );
      CREATE INDEX IF NOT EXISTS idx_memory_fact_legacy_quarantine_reason
        ON memory_fact_legacy_quarantine(reason, quarantined_at, fact_id);

      CREATE TRIGGER IF NOT EXISTS trg_memory_fact_contribution_admission_immutable
      BEFORE UPDATE ON memory_fact_contribution_admission
      BEGIN
        SELECT RAISE(ABORT, 'memory_fact_contribution_admission_immutable');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_memory_fact_contribution_admission_delete_immutable
      BEFORE DELETE ON memory_fact_contribution_admission
      BEGIN
        SELECT RAISE(ABORT, 'memory_fact_contribution_admission_immutable');
      END;
    `);
  });
}
