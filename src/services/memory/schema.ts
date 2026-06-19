// ---------------------------------------------------------------------------
// Kavi — Memory schema bootstrap + shared internal utilities
// ---------------------------------------------------------------------------
// Schema for the new single-thread memory primitives:
//   • memory_entities  — canonical entity registry (alias rollup)
//   • memory_facts     — bi-temporal facts (Graphiti-style supersession)
//   • memory_blocks    — Letta-style char-capped, agent-editable blocks
//
// These tables sit alongside the legacy `memory_chunks` table in the same
// kavi-memory.db so older persisted memories remain readable during migration.
// ---------------------------------------------------------------------------

import { getMemoryDb } from './sqlite-store';

let schemaReady = false;

export function ensureFactSchema(): void {
  if (schemaReady) return;
  const db = getMemoryDb();
  db.execSync(`
    CREATE TABLE IF NOT EXISTS memory_entities (
      id TEXT PRIMARY KEY,
      canonical_name TEXT NOT NULL,
      type TEXT NOT NULL,
      aliases TEXT NOT NULL DEFAULT '[]',
      attributes TEXT NOT NULL DEFAULT '{}',
      first_seen_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      deleted_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_entities_canonical
      ON memory_entities(canonical_name);
    CREATE INDEX IF NOT EXISTS idx_entities_type
      ON memory_entities(type);

    CREATE TABLE IF NOT EXISTS memory_facts (
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
      UNIQUE(content_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_facts_subject
      ON memory_facts(subject_id);
    CREATE INDEX IF NOT EXISTS idx_facts_subject_predicate
      ON memory_facts(subject_id, predicate);
    CREATE INDEX IF NOT EXISTS idx_facts_valid
      ON memory_facts(invalid_at, deleted_at);
    CREATE INDEX IF NOT EXISTS idx_facts_pinned
      ON memory_facts(pinned);

    CREATE TABLE IF NOT EXISTS memory_blocks (
      label TEXT PRIMARY KEY,
      content TEXT NOT NULL DEFAULT '',
      char_limit INTEGER NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      pinned INTEGER NOT NULL DEFAULT 0,
      persona_id TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_blocks_persona
      ON memory_blocks(persona_id);

    CREATE TABLE IF NOT EXISTS memory_working_blocks (
      label TEXT NOT NULL,
      scope_key TEXT NOT NULL,
      conversation_id TEXT,
      thread_id TEXT,
      task_id TEXT,
      content TEXT NOT NULL DEFAULT '',
      char_limit INTEGER NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (label, scope_key)
    );
    CREATE INDEX IF NOT EXISTS idx_working_blocks_conversation
      ON memory_working_blocks(conversation_id, label, updated_at);
    CREATE INDEX IF NOT EXISTS idx_working_blocks_thread
      ON memory_working_blocks(thread_id, label, updated_at);
    CREATE INDEX IF NOT EXISTS idx_working_blocks_recent
      ON memory_working_blocks(label, updated_at);

    CREATE TABLE IF NOT EXISTS memory_consolidation_state (
      thread_id TEXT PRIMARY KEY,
      last_consolidated_message_id TEXT,
      last_consolidated_at INTEGER NOT NULL DEFAULT 0,
      turns_since_last INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory_migration_state (
      conversation_id TEXT PRIMARY KEY,
      last_seeded_message_id TEXT,
      seeded_turns INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_migration_status
      ON memory_migration_state(status);

    CREATE TABLE IF NOT EXISTS memory_episodes (
      id TEXT PRIMARY KEY,
      conversation_id TEXT,
      thread_id TEXT,
      task_id TEXT,
      started_at INTEGER NOT NULL,
      ended_at INTEGER NOT NULL,
      summary TEXT NOT NULL,
      entities_json TEXT NOT NULL DEFAULT '[]',
      message_ids_json TEXT NOT NULL DEFAULT '[]',
      tool_names_json TEXT NOT NULL DEFAULT '[]',
      importance REAL NOT NULL DEFAULT 0.5,
      embedding TEXT,
      created_at INTEGER NOT NULL,
      deleted_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_episodes_conversation
      ON memory_episodes(conversation_id, deleted_at);
    CREATE INDEX IF NOT EXISTS idx_episodes_task
      ON memory_episodes(task_id, deleted_at);
    CREATE INDEX IF NOT EXISTS idx_episodes_ended
      ON memory_episodes(ended_at);

    CREATE TABLE IF NOT EXISTS memory_fact_evidence (
      id TEXT PRIMARY KEY,
      fact_id TEXT NOT NULL,
      episode_id TEXT,
      message_id TEXT,
      role TEXT,
      quote TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_fact_evidence_fact
      ON memory_fact_evidence(fact_id);
    CREATE INDEX IF NOT EXISTS idx_fact_evidence_episode
      ON memory_fact_evidence(episode_id);

    CREATE TABLE IF NOT EXISTS memory_ingestion_jobs (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      task_id TEXT,
      source_start_message_id TEXT,
      source_end_message_id TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT 'turn_completed',
      status TEXT NOT NULL DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_status
      ON memory_ingestion_jobs(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_thread
      ON memory_ingestion_jobs(thread_id, source_end_message_id);

    CREATE TABLE IF NOT EXISTS memory_tasks (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      title TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'active',
      started_at INTEGER NOT NULL,
      last_active_at INTEGER NOT NULL,
      ended_at INTEGER,
      parent_task_id TEXT,
      summary TEXT,
      embedding TEXT,
      confidence REAL NOT NULL DEFAULT 0.5,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_memory_tasks_thread
      ON memory_tasks(thread_id, deleted_at, last_active_at DESC);
    CREATE INDEX IF NOT EXISTS idx_memory_tasks_state
      ON memory_tasks(thread_id, state, deleted_at);

    CREATE TABLE IF NOT EXISTS memory_reflections (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      thread_id TEXT,
      task_id TEXT,
      period_start INTEGER NOT NULL,
      period_end INTEGER NOT NULL,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      source_episode_ids_json TEXT NOT NULL DEFAULT '[]',
      source_fact_ids_json TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_memory_reflections_thread
      ON memory_reflections(thread_id, kind, period_start DESC);
    CREATE INDEX IF NOT EXISTS idx_memory_reflections_task
      ON memory_reflections(task_id, deleted_at);
  `);
  ensureFactColumns(db);
  db.execSync(`
    CREATE INDEX IF NOT EXISTS idx_facts_scope_origin
      ON memory_facts(scope, origin_conversation_id, deleted_at, invalid_at);
    CREATE INDEX IF NOT EXISTS idx_facts_scope_task
      ON memory_facts(scope, origin_task_id, deleted_at, invalid_at);
    CREATE INDEX IF NOT EXISTS idx_facts_subject_predicate_scope
      ON memory_facts(subject_id, predicate, scope);
    CREATE INDEX IF NOT EXISTS idx_facts_last_recalled
      ON memory_facts(last_recalled_at);
    CREATE INDEX IF NOT EXISTS idx_facts_importance
      ON memory_facts(importance);
  `);
  schemaReady = true;
}

function ensureColumn(
  db: ReturnType<typeof getMemoryDb>,
  table: string,
  column: string,
  definition: string,
): void {
  const rows = db.getAllSync<{ name: string }>(`PRAGMA table_info(${table})`);
  if (rows.some((row) => row.name === column)) return;
  db.execSync(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

function ensureFactColumns(db: ReturnType<typeof getMemoryDb>): void {
  ensureColumn(db, 'memory_facts', 'scope', "scope TEXT NOT NULL DEFAULT 'global'");
  ensureColumn(db, 'memory_facts', 'origin_conversation_id', 'origin_conversation_id TEXT');
  ensureColumn(db, 'memory_facts', 'origin_thread_id', 'origin_thread_id TEXT');
  ensureColumn(db, 'memory_facts', 'origin_task_id', 'origin_task_id TEXT');
  ensureColumn(db, 'memory_facts', 'source_turn_id', 'source_turn_id TEXT');
  ensureColumn(db, 'memory_facts', 'source_summary', 'source_summary TEXT');
  ensureColumn(db, 'memory_facts', 'importance', 'importance REAL NOT NULL DEFAULT 0.5');
  ensureColumn(db, 'memory_facts', 'access_count', 'access_count INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'memory_facts', 'repeated_mention_count', 'repeated_mention_count INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'memory_facts', 'last_recalled_at', 'last_recalled_at INTEGER');
  ensureColumn(db, 'memory_facts', 'last_reinforced_at', 'last_reinforced_at INTEGER');
  ensureColumn(db, 'memory_facts', 'last_accessed_at', 'last_accessed_at INTEGER');
  ensureColumn(db, 'memory_facts', 'decay_policy', "decay_policy TEXT NOT NULL DEFAULT 'normal'");
  ensureColumn(db, 'memory_facts', 'expires_at', 'expires_at INTEGER');
  ensureColumn(db, 'memory_episodes', 'source_start_message_id', 'source_start_message_id TEXT');
  ensureColumn(db, 'memory_episodes', 'source_end_message_id', 'source_end_message_id TEXT');
  ensureColumn(db, 'memory_facts', 'source_actor_id', 'source_actor_id TEXT');
  ensureColumn(db, 'memory_facts', 'task_id', 'task_id TEXT');
  ensureColumn(db, 'memory_facts', 'retrievability', 'retrievability REAL NOT NULL DEFAULT 1.0');
  ensureColumn(db, 'memory_facts', 'stability', 'stability REAL NOT NULL DEFAULT 0.5');
  ensureColumn(db, 'memory_facts', 'decay_rate', 'decay_rate REAL NOT NULL DEFAULT 0.03');
  ensureColumn(db, 'memory_facts', 'last_presented_at', 'last_presented_at INTEGER');
  ensureColumn(db, 'memory_facts', 'last_confirmed_at', 'last_confirmed_at INTEGER');
  ensureColumn(db, 'memory_facts', 'last_conflicted_at', 'last_conflicted_at INTEGER');
  ensureColumn(db, 'memory_facts', 'review_state', "review_state TEXT NOT NULL DEFAULT 'auto'");
  ensureColumn(db, 'memory_facts', 'sensitivity', "sensitivity TEXT NOT NULL DEFAULT 'normal'");
  ensureColumn(db, 'memory_facts', 'memory_kind', "memory_kind TEXT NOT NULL DEFAULT 'semantic'");
}

export function resetFactSchemaCacheForTests(): void {
  schemaReady = false;
}

export function clearStructuredMemory(): void {
  ensureFactSchema();
  const db = getMemoryDb();
  db.execSync(`
    DELETE FROM memory_fact_evidence;
    DELETE FROM memory_episodes;
    DELETE FROM memory_facts;
    DELETE FROM memory_entities;
    DELETE FROM memory_blocks;
    DELETE FROM memory_working_blocks;
    DELETE FROM memory_consolidation_state;
    DELETE FROM memory_migration_state;
    DELETE FROM memory_ingestion_jobs;
    DELETE FROM memory_tasks;
    DELETE FROM memory_reflections;
    DELETE FROM memory_chunks;
  `);
}

// ── Shared internal helpers ──────────────────────────────────────────────

export function fnv1aHash(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

let idCounter = 0;
export function newId(prefix: string): string {
  idCounter = (idCounter + 1) >>> 0;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}_${Math.floor(
    Math.random() * 0xffff,
  ).toString(36)}`;
}

export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function safeParseArray<T>(raw: string): T[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function safeParseObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Escape SQL `LIKE` wildcards for use as a JSON-substring prefilter. */
export function jsonLikeEscape(s: string): string {
  return s.replace(/[\\%_]/g, '\\$&').replace(/"/g, '\\"');
}
