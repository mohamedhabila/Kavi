import type { MemoryDatabase } from '../access/schemaGuard';
import { dropFactContributionFactReferenceTriggers } from '../factContributionSchema';
import { dropFactExplicitOverrideFactReferenceTriggers } from '../factExplicitOverrideSchema';

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
  if (!table?.sql) return;
  const columns = db.getAllSync<{ name: string }>('PRAGMA table_info(memory_facts)');
  const hasLegacyTaskId = columns.some((column) => column.name === 'task_id');
  const hasLegacyEmbedding = columns.some((column) => column.name === 'embedding');
  const hasUniqueContentHash = /UNIQUE\s*\(\s*content_hash\s*\)/i.test(table.sql);
  if (!hasLegacyTaskId && !hasLegacyEmbedding && !hasUniqueContentHash) return;
  if (
    hasLegacyTaskId &&
    db.getFirstSync<{ id: string }>(
      `SELECT id
         FROM memory_facts
        WHERE origin_task_id IS NOT NULL
          AND task_id IS NOT NULL
          AND origin_task_id != task_id
        LIMIT 1`,
    )
  ) {
    throw new Error('memory_fact_task_identity_conflict');
  }
  const canonicalColumns = new Set([
    'id',
    'subject_id',
    'predicate',
    'object_text',
    'object_entity_id',
    'attributes',
    'confidence',
    'source_message_id',
    'source_run_id',
    'memory_owner_id',
    'persona_id',
    'fact_class',
    'source_authority',
    'content_hash',
    'local_similarity_model',
    'local_similarity_dimensions',
    'local_similarity_vector',
    'local_similarity_updated_at',
    'valid_at',
    'invalid_at',
    'created_at',
    'updated_at',
    'deleted_at',
    'pinned',
    'scope',
    'origin_conversation_id',
    'origin_thread_id',
    'origin_task_id',
    'source_turn_id',
    'source_summary',
    'importance',
    'access_count',
    'repeated_mention_count',
    'last_recalled_at',
    'last_reinforced_at',
    'last_accessed_at',
    'decay_policy',
    'expires_at',
    'source_actor_id',
    'retrievability',
    'stability',
    'decay_rate',
    'last_presented_at',
    'last_confirmed_at',
    'last_conflicted_at',
    'review_state',
    'sensitivity',
    'sensitivity_policy_version',
    'memory_kind',
  ]);
  if (
    columns.some(
      (column) =>
        column.name !== 'task_id' &&
        column.name !== 'embedding' &&
        !canonicalColumns.has(column.name),
    )
  ) {
    throw new Error('memory_fact_schema_column_unsupported');
  }
  const canonicalSchemaObjects = new Set([
    'idx_facts_subject',
    'idx_facts_subject_predicate',
    'idx_facts_subject_predicate_nocase',
    'idx_facts_valid',
    'idx_facts_pinned',
    'idx_facts_scope_origin',
    'idx_facts_evidence_scope',
    'idx_facts_scope_task',
    'idx_facts_subject_predicate_scope',
    'idx_facts_content_hash',
    'idx_facts_active_content_hash',
    'idx_facts_last_recalled',
    'idx_facts_importance',
    'idx_facts_live_kind_rank',
    'idx_facts_scope_origin_kind_rank',
    'idx_facts_scope_task_kind_rank',
    'idx_facts_scope_kind_rank',
    'idx_facts_source_kind_rank',
    'idx_facts_applicability_scope',
    'idx_facts_grounded_source',
    'idx_facts_local_similarity_current',
  ]);
  const canonicalFactTriggers = new Set([
    'trg_memory_fact_delete_contributions',
    'trg_memory_fact_delete_explicit_override',
    'trg_memory_fact_explicit_override_parent_identity_immutable',
    'trg_memory_fact_explicit_override_parent_insert_immutable',
    'trg_memory_fact_retire_explicit_override',
  ]);
  const schemaObjects = db.getAllSync<{ type: string; name: string; sql: string }>(
    `SELECT type, name, sql
       FROM sqlite_master
      WHERE tbl_name = 'memory_facts'
        AND type IN ('index', 'trigger')
        AND sql IS NOT NULL
        AND name NOT LIKE 'sqlite_autoindex_%'
      ORDER BY type, name`,
  );
  for (const schemaObject of schemaObjects) {
    if (/\btask_id\b/i.test(schemaObject.sql)) {
      throw new Error('memory_fact_legacy_task_schema_object_unsupported');
    }
    if (schemaObject.type === 'trigger' && canonicalFactTriggers.has(schemaObject.name)) {
      continue;
    }
    if (schemaObject.type !== 'index' || !canonicalSchemaObjects.has(schemaObject.name)) {
      throw new Error('memory_fact_schema_object_unsupported');
    }
  }
  const originTaskProjection = hasLegacyTaskId
    ? 'COALESCE(origin_task_id, task_id)'
    : 'origin_task_id';

  db.execSync('BEGIN IMMEDIATE TRANSACTION');
  try {
    dropFactContributionFactReferenceTriggers(db);
    dropFactExplicitOverrideFactReferenceTriggers(db);
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
        memory_owner_id TEXT,
        persona_id TEXT,
        fact_class TEXT NOT NULL DEFAULT 'unknown'
          CHECK(fact_class IN ('subjective_user', 'objective', 'workflow', 'unknown')),
        source_authority TEXT NOT NULL DEFAULT 'unknown'
          CHECK(source_authority IN (
            'grounded_user', 'tool_observed', 'external_source', 'assistant_inferred', 'unknown'
          )),
        content_hash TEXT NOT NULL,
        local_similarity_model TEXT,
        local_similarity_dimensions INTEGER,
        local_similarity_vector TEXT,
        local_similarity_updated_at INTEGER,
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
        retrievability REAL NOT NULL DEFAULT 1.0,
        stability REAL NOT NULL DEFAULT 0.5,
        decay_rate REAL NOT NULL DEFAULT 0.03,
        last_presented_at INTEGER,
        last_confirmed_at INTEGER,
        last_conflicted_at INTEGER,
        review_state TEXT NOT NULL DEFAULT 'auto',
        sensitivity TEXT NOT NULL DEFAULT 'normal',
        sensitivity_policy_version INTEGER NOT NULL DEFAULT 0,
        memory_kind TEXT NOT NULL DEFAULT 'semantic_fact'
      );
      INSERT INTO memory_facts_without_hash_constraint (
        id, subject_id, predicate, object_text, object_entity_id, attributes,
        confidence, source_message_id, source_run_id, memory_owner_id, persona_id,
        fact_class, source_authority, content_hash, local_similarity_model,
        local_similarity_dimensions, local_similarity_vector, local_similarity_updated_at,
        valid_at, invalid_at, created_at, updated_at, deleted_at, pinned, scope,
        origin_conversation_id, origin_thread_id, origin_task_id, source_turn_id,
        source_summary, importance, access_count, repeated_mention_count,
        last_recalled_at, last_reinforced_at, last_accessed_at, decay_policy,
        expires_at, source_actor_id, retrievability, stability,
        decay_rate, last_presented_at, last_confirmed_at, last_conflicted_at,
        review_state, sensitivity, sensitivity_policy_version, memory_kind
      )
      SELECT
        id, subject_id, predicate, object_text, object_entity_id, attributes,
        confidence, source_message_id, source_run_id, memory_owner_id, persona_id,
        fact_class, source_authority, content_hash, local_similarity_model,
        local_similarity_dimensions, local_similarity_vector, local_similarity_updated_at,
        valid_at, invalid_at, created_at, updated_at, deleted_at, pinned, scope,
        origin_conversation_id, origin_thread_id, ${originTaskProjection}, source_turn_id,
        source_summary, importance, access_count, repeated_mention_count,
        last_recalled_at, last_reinforced_at, last_accessed_at, decay_policy,
        expires_at, source_actor_id, retrievability, stability,
        decay_rate, last_presented_at, last_confirmed_at, last_conflicted_at,
        review_state, sensitivity, sensitivity_policy_version, memory_kind
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
