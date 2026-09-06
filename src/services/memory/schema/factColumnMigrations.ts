// ---------------------------------------------------------------------------
// Kavi — Additive column migrations for memory_facts / memory_episodes
// ---------------------------------------------------------------------------
// `ensureColumn` is an idempotent `ALTER TABLE ... ADD COLUMN` guarded by
// `PRAGMA table_info`. `ensureFactColumns` lists every additive column this
// schema has grown over time, including the local-similarity and
// provider-embedding vector columns. Split out of `schema.ts` to keep that
// file's bootstrap DDL under the maintainability line budget.
// ---------------------------------------------------------------------------

import { getMemoryDb } from '../database';
import { ensureFactSensitivityPolicyColumn } from './factSensitivityPolicyColumn';

export function ensureColumn(
  db: ReturnType<typeof getMemoryDb>,
  table: string,
  column: string,
  definition: string,
): void {
  const rows = db.getAllSync<{ name: string }>(`PRAGMA table_info(${table})`);
  if (rows.some((row) => row.name === column)) return;
  db.execSync(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

export function ensureFactColumns(db: ReturnType<typeof getMemoryDb>): void {
  ensureColumn(db, 'memory_facts', 'scope', "scope TEXT NOT NULL DEFAULT 'global'");
  ensureColumn(db, 'memory_facts', 'origin_conversation_id', 'origin_conversation_id TEXT');
  ensureColumn(db, 'memory_facts', 'origin_thread_id', 'origin_thread_id TEXT');
  ensureColumn(db, 'memory_facts', 'origin_task_id', 'origin_task_id TEXT');
  ensureColumn(db, 'memory_facts', 'source_turn_id', 'source_turn_id TEXT');
  ensureColumn(db, 'memory_facts', 'source_summary', 'source_summary TEXT');
  ensureColumn(db, 'memory_facts', 'local_similarity_model', 'local_similarity_model TEXT');
  ensureColumn(
    db,
    'memory_facts',
    'local_similarity_dimensions',
    'local_similarity_dimensions INTEGER',
  );
  ensureColumn(db, 'memory_facts', 'local_similarity_vector', 'local_similarity_vector TEXT');
  ensureColumn(
    db,
    'memory_facts',
    'local_similarity_updated_at',
    'local_similarity_updated_at INTEGER',
  );
  ensureColumn(db, 'memory_facts', 'provider_embedding_model', 'provider_embedding_model TEXT');
  ensureColumn(
    db,
    'memory_facts',
    'provider_embedding_dimensions',
    'provider_embedding_dimensions INTEGER',
  );
  ensureColumn(db, 'memory_facts', 'provider_embedding_vector', 'provider_embedding_vector TEXT');
  ensureColumn(
    db,
    'memory_facts',
    'provider_embedding_updated_at',
    'provider_embedding_updated_at INTEGER',
  );
  ensureColumn(db, 'memory_facts', 'importance', 'importance REAL NOT NULL DEFAULT 0.5');
  ensureColumn(db, 'memory_facts', 'access_count', 'access_count INTEGER NOT NULL DEFAULT 0');
  ensureColumn(
    db,
    'memory_facts',
    'repeated_mention_count',
    'repeated_mention_count INTEGER NOT NULL DEFAULT 0',
  );
  ensureColumn(db, 'memory_facts', 'last_recalled_at', 'last_recalled_at INTEGER');
  ensureColumn(db, 'memory_facts', 'last_reinforced_at', 'last_reinforced_at INTEGER');
  ensureColumn(db, 'memory_facts', 'last_accessed_at', 'last_accessed_at INTEGER');
  ensureColumn(db, 'memory_facts', 'decay_policy', "decay_policy TEXT NOT NULL DEFAULT 'normal'");
  ensureColumn(db, 'memory_facts', 'expires_at', 'expires_at INTEGER');
  ensureColumn(db, 'memory_episodes', 'source_start_message_id', 'source_start_message_id TEXT');
  ensureColumn(db, 'memory_episodes', 'source_end_message_id', 'source_end_message_id TEXT');
  ensureColumn(
    db,
    'memory_episodes',
    'source_identity_manifest_json',
    `source_identity_manifest_json TEXT NOT NULL DEFAULT '{"version":1,"sources":[]}'`,
  );
  ensureColumn(
    db,
    'memory_episodes',
    'sensitivity',
    "sensitivity TEXT NOT NULL DEFAULT 'sensitive' CHECK(sensitivity IN ('normal', 'private', 'sensitive'))",
  );
  ensureColumn(db, 'memory_episodes', 'embedding_model', 'embedding_model TEXT');
  ensureColumn(db, 'memory_episodes', 'embedding_dimensions', 'embedding_dimensions INTEGER');
  ensureColumn(db, 'memory_episodes', 'embedding_updated_at', 'embedding_updated_at INTEGER');
  ensureColumn(db, 'memory_facts', 'source_actor_id', 'source_actor_id TEXT');
  ensureColumn(db, 'memory_facts', 'memory_owner_id', 'memory_owner_id TEXT');
  ensureColumn(db, 'memory_facts', 'persona_id', 'persona_id TEXT');
  ensureColumn(
    db,
    'memory_facts',
    'fact_class',
    "fact_class TEXT NOT NULL DEFAULT 'unknown' CHECK(fact_class IN ('subjective_user', 'objective', 'workflow', 'unknown'))",
  );
  ensureColumn(
    db,
    'memory_facts',
    'source_authority',
    "source_authority TEXT NOT NULL DEFAULT 'unknown' CHECK(source_authority IN ('grounded_user', 'tool_observed', 'external_source', 'assistant_inferred', 'unknown'))",
  );
  ensureColumn(db, 'memory_facts', 'retrievability', 'retrievability REAL NOT NULL DEFAULT 1.0');
  ensureColumn(db, 'memory_facts', 'stability', 'stability REAL NOT NULL DEFAULT 0.5');
  ensureColumn(db, 'memory_facts', 'decay_rate', 'decay_rate REAL NOT NULL DEFAULT 0.03');
  ensureColumn(db, 'memory_facts', 'last_presented_at', 'last_presented_at INTEGER');
  ensureColumn(db, 'memory_facts', 'last_confirmed_at', 'last_confirmed_at INTEGER');
  ensureColumn(db, 'memory_facts', 'last_conflicted_at', 'last_conflicted_at INTEGER');
  ensureColumn(db, 'memory_facts', 'review_state', "review_state TEXT NOT NULL DEFAULT 'auto'");
  ensureColumn(db, 'memory_facts', 'sensitivity', "sensitivity TEXT NOT NULL DEFAULT 'normal'");
  ensureFactSensitivityPolicyColumn(db);
  ensureColumn(
    db,
    'memory_facts',
    'memory_kind',
    "memory_kind TEXT NOT NULL DEFAULT 'semantic_fact'",
  );
  db.execSync(
    "UPDATE memory_facts SET memory_kind = 'semantic_fact' WHERE memory_kind = 'semantic'",
  );
}
