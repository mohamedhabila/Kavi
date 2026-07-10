import type { MemoryDatabase } from '../access/schemaGuard';

/**
 * Early versions made content_hash globally unique. That prevents a valid
 * A -> B -> A timeline because the historical A row blocks a new validity
 * interval. Rebuild once without the constraint; active-row dedupe remains an
 * application invariant in recordFact.
 */
export function ensureCanonicalFactTable(db: MemoryDatabase): void {
  const table = db.getFirstSync<{ sql: string | null }>(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'memory_facts'",
  );
  if (!table?.sql || !/UNIQUE\s*\(\s*content_hash\s*\)/i.test(table.sql)) return;

  db.execSync('BEGIN IMMEDIATE TRANSACTION');
  try {
    db.execSync(`
      DROP TABLE IF EXISTS memory_facts_without_hash_constraint;
      CREATE TABLE memory_facts_without_hash_constraint (
        id TEXT PRIMARY KEY,
        subject_id TEXT NOT NULL,
        predicate TEXT NOT NULL,
        object_text TEXT NOT NULL,
        object_entity_id TEXT,
        attributes TEXT NOT NULL DEFAULT '{}',
        confidence REAL NOT NULL DEFAULT 1.0,
        source_message_id TEXT,
        source_run_id TEXT,
        content_hash TEXT NOT NULL,
        embedding TEXT,
        valid_at INTEGER NOT NULL,
        invalid_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER,
        pinned INTEGER NOT NULL DEFAULT 0,
        scope TEXT NOT NULL DEFAULT 'global',
        origin_conversation_id TEXT,
        origin_thread_id TEXT,
        origin_task_id TEXT,
        source_turn_id TEXT,
        source_summary TEXT,
        importance REAL NOT NULL DEFAULT 0.5,
        access_count INTEGER NOT NULL DEFAULT 0,
        repeated_mention_count INTEGER NOT NULL DEFAULT 0,
        last_recalled_at INTEGER,
        last_reinforced_at INTEGER,
        last_accessed_at INTEGER,
        decay_policy TEXT NOT NULL DEFAULT 'normal',
        expires_at INTEGER,
        source_actor_id TEXT,
        task_id TEXT,
        retrievability REAL NOT NULL DEFAULT 1.0,
        stability REAL NOT NULL DEFAULT 0.5,
        decay_rate REAL NOT NULL DEFAULT 0.03,
        last_presented_at INTEGER,
        last_confirmed_at INTEGER,
        last_conflicted_at INTEGER,
        review_state TEXT NOT NULL DEFAULT 'auto',
        sensitivity TEXT NOT NULL DEFAULT 'normal',
        memory_kind TEXT NOT NULL DEFAULT 'semantic_fact'
      );
      INSERT INTO memory_facts_without_hash_constraint (
        id, subject_id, predicate, object_text, object_entity_id, attributes,
        confidence, source_message_id, source_run_id, content_hash, embedding,
        valid_at, invalid_at, created_at, updated_at, deleted_at, pinned, scope,
        origin_conversation_id, origin_thread_id, origin_task_id, source_turn_id,
        source_summary, importance, access_count, repeated_mention_count,
        last_recalled_at, last_reinforced_at, last_accessed_at, decay_policy,
        expires_at, source_actor_id, task_id, retrievability, stability,
        decay_rate, last_presented_at, last_confirmed_at, last_conflicted_at,
        review_state, sensitivity, memory_kind
      )
      SELECT
        id, subject_id, predicate, object_text, object_entity_id, attributes,
        confidence, source_message_id, source_run_id, content_hash, embedding,
        valid_at, invalid_at, created_at, updated_at, deleted_at, pinned, scope,
        origin_conversation_id, origin_thread_id, origin_task_id, source_turn_id,
        source_summary, importance, access_count, repeated_mention_count,
        last_recalled_at, last_reinforced_at, last_accessed_at, decay_policy,
        expires_at, source_actor_id, task_id, retrievability, stability,
        decay_rate, last_presented_at, last_confirmed_at, last_conflicted_at,
        review_state, sensitivity, memory_kind
      FROM memory_facts;
      DROP TABLE memory_facts;
      ALTER TABLE memory_facts_without_hash_constraint RENAME TO memory_facts;
    `);
    db.execSync('COMMIT');
  } catch (error) {
    db.execSync('ROLLBACK');
    throw error;
  }
}
