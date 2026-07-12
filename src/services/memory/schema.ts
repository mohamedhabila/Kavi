// ---------------------------------------------------------------------------
// Kavi — Memory schema bootstrap + shared internal utilities
// ---------------------------------------------------------------------------
// Schema for the new single-thread memory primitives:
//   • memory_entities  — canonical entity registry (alias rollup)
//   • memory_facts     — bi-temporal facts (Graphiti-style supersession)
//   • memory_working_blocks — scoped, code-owned structural working state
//
// These are the canonical memory tables in kavi-memory.db.
// ---------------------------------------------------------------------------

import { getMemoryDb } from './database';
import { runMemoryDatabaseSavepoint } from './access/databaseSavepoint';
import { buildFactContentHash } from './facts/contentIdentity';
import { ensureIngestionQueueSchema } from './ingestionQueueSchema';
import { ensureMigrationStateSchema } from './migrationStateSchema';
import { ensureRetrievalEventSchema } from './retrievalEventSchema';
import { ensureRetrievalOutcomeSchema } from './retrievalOutcomeSchema';
import { ensureVerifiedProcedureObservationSchema } from './verifiedProcedure/observationSchema';
import { CLEARED_STRUCTURED_MEMORY_TABLES } from './structuredMemoryTableRegistry';
import { ensureWithdrawalSchema } from './withdrawalSchema';
import { ensureEpisodeAccessPolicySchema } from './episodes/accessPolicySchema';
import { ensureEpisodeRetrievalIndexSchema } from './episodes/retrievalIndex';
import { ensureCanonicalFactTable } from './schema/canonicalFactTable';
import { ensureFactSensitivityPolicyColumn } from './schema/factSensitivityPolicyColumn';
import { ensureMemoryVaultIdentitySchema, getLocalMemoryVaultOwnerId } from './memoryVaultIdentity';

let schemaReady = false;

export function ensureFactSchema(): void {
  if (schemaReady) return;
  const db = getMemoryDb();
  db.execSync(`
    DROP TABLE IF EXISTS memory_blocks;

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
      sensitivity_policy_version INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_facts_subject
      ON memory_facts(subject_id);
    CREATE INDEX IF NOT EXISTS idx_facts_subject_predicate
      ON memory_facts(subject_id, predicate);
    CREATE INDEX IF NOT EXISTS idx_facts_subject_predicate_nocase
      ON memory_facts(subject_id, predicate COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_facts_valid
      ON memory_facts(invalid_at, deleted_at);
    CREATE INDEX IF NOT EXISTS idx_facts_pinned
      ON memory_facts(pinned);

    CREATE TABLE IF NOT EXISTS memory_fact_terms (
      fact_id TEXT NOT NULL,
      unit TEXT NOT NULL,
      source_run_id TEXT,
      memory_kind TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1.0,
      PRIMARY KEY (fact_id, unit)
    );
    CREATE INDEX IF NOT EXISTS idx_fact_terms_unit_kind_fact
      ON memory_fact_terms(unit, memory_kind, fact_id, weight);
    CREATE INDEX IF NOT EXISTS idx_fact_terms_fact
      ON memory_fact_terms(fact_id);
    CREATE INDEX IF NOT EXISTS idx_fact_terms_source_unit_fact
      ON memory_fact_terms(source_run_id, unit, fact_id, weight);

    CREATE TABLE IF NOT EXISTS memory_fact_term_stats (
      unit TEXT NOT NULL,
      memory_kind TEXT NOT NULL,
      fact_count INTEGER NOT NULL DEFAULT 0,
      total_weight REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (unit, memory_kind)
    );
    CREATE TRIGGER IF NOT EXISTS trg_memory_fact_terms_insert_stats
      AFTER INSERT ON memory_fact_terms
      BEGIN
        INSERT INTO memory_fact_term_stats(unit, memory_kind, fact_count, total_weight)
        VALUES (NEW.unit, NEW.memory_kind, 1, NEW.weight)
        ON CONFLICT(unit, memory_kind) DO UPDATE SET
          fact_count = fact_count + 1,
          total_weight = total_weight + NEW.weight;
      END;
    CREATE TRIGGER IF NOT EXISTS trg_memory_fact_terms_delete_stats
      AFTER DELETE ON memory_fact_terms
      BEGIN
        UPDATE memory_fact_term_stats
           SET fact_count = MAX(0, fact_count - 1),
               total_weight = MAX(0, total_weight - OLD.weight)
         WHERE unit = OLD.unit
           AND memory_kind = OLD.memory_kind;
        DELETE FROM memory_fact_term_stats
         WHERE unit = OLD.unit
           AND memory_kind = OLD.memory_kind
           AND fact_count <= 0;
      END;

    CREATE TABLE IF NOT EXISTS memory_working_blocks (
      label TEXT NOT NULL,
      scope_key TEXT NOT NULL,
      conversation_id TEXT,
      thread_id TEXT,
      task_id TEXT,
      content TEXT NOT NULL DEFAULT '',
      char_limit INTEGER NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      prompt_eligibility TEXT NOT NULL DEFAULT 'untrusted'
        CHECK(prompt_eligibility IN ('trusted_structural', 'untrusted')),
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (label, scope_key)
    );
    CREATE INDEX IF NOT EXISTS idx_working_blocks_conversation
      ON memory_working_blocks(conversation_id, label, updated_at);
    CREATE INDEX IF NOT EXISTS idx_working_blocks_thread
      ON memory_working_blocks(thread_id, label, updated_at);
    CREATE INDEX IF NOT EXISTS idx_working_blocks_evidence_scope
      ON memory_working_blocks(conversation_id, thread_id, label, scope_key);
    CREATE INDEX IF NOT EXISTS idx_working_blocks_recent
      ON memory_working_blocks(label, updated_at);

    CREATE TABLE IF NOT EXISTS memory_consolidation_state (
      thread_id TEXT PRIMARY KEY,
      last_consolidated_message_id TEXT,
      last_consolidated_at INTEGER NOT NULL DEFAULT 0,
      turns_since_last INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory_episodes (
      id TEXT PRIMARY KEY,
      conversation_id TEXT,
      thread_id TEXT,
      task_id TEXT,
      started_at INTEGER NOT NULL,
      ended_at INTEGER NOT NULL,
      summary TEXT NOT NULL,
      sensitivity TEXT NOT NULL DEFAULT 'sensitive'
        CHECK(sensitivity IN ('normal', 'private', 'sensitive')),
      entities_json TEXT NOT NULL DEFAULT '[]',
      message_ids_json TEXT NOT NULL DEFAULT '[]',
      tool_names_json TEXT NOT NULL DEFAULT '[]',
      importance REAL NOT NULL DEFAULT 0.5,
      embedding TEXT,
      created_at INTEGER NOT NULL,
      deleted_at INTEGER,
      source_start_message_id TEXT,
      source_end_message_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_episodes_conversation
      ON memory_episodes(conversation_id, deleted_at);
    CREATE INDEX IF NOT EXISTS idx_episodes_evidence_scope
      ON memory_episodes(conversation_id, thread_id, id);
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

    CREATE TABLE IF NOT EXISTS memory_fact_observations (
      id TEXT PRIMARY KEY,
      fact_id TEXT NOT NULL,
      relation TEXT NOT NULL CHECK(relation IN ('supports', 'conflicts')),
      memory_owner_id TEXT NOT NULL,
      fact_class TEXT NOT NULL
        CHECK(fact_class IN ('subjective_user', 'objective', 'workflow', 'unknown')),
      source_authority TEXT NOT NULL
        CHECK(source_authority IN ('grounded_user', 'tool_observed', 'external_source')),
      source_kind TEXT NOT NULL
        CHECK(source_kind IN ('user_message', 'tool_run', 'external_record')),
      source_id TEXT NOT NULL,
      source_conversation_id TEXT NOT NULL,
      source_thread_id TEXT NOT NULL,
      source_persona_id TEXT NOT NULL,
      source_task_id TEXT,
      observed_at INTEGER NOT NULL CHECK(observed_at >= 0),
      created_at INTEGER NOT NULL CHECK(created_at >= observed_at)
    );
    DROP INDEX IF EXISTS idx_fact_observations_identity;
    CREATE UNIQUE INDEX idx_fact_observations_identity
      ON memory_fact_observations(
        fact_id,
        memory_owner_id,
        source_kind,
        source_id
      );
    CREATE INDEX IF NOT EXISTS idx_fact_observations_active
      ON memory_fact_observations(fact_id, relation, observed_at DESC, id);

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
  ensureRetrievalEventSchema(db);
  ensureWithdrawalSchema(db);
  ensureMigrationStateSchema(db);
  ensureMemoryVaultIdentitySchema(db);
  ensureRetrievalOutcomeSchema(db);
  ensureVerifiedProcedureObservationSchema(db);
  ensureEpisodeAccessPolicySchema(db);
  ensureEpisodeRetrievalIndexSchema(db);
  ensureFactColumns(db);
  ensureIngestionQueueSchema(db);
  ensureColumn(
    db,
    'memory_working_blocks',
    'prompt_eligibility',
    "prompt_eligibility TEXT NOT NULL DEFAULT 'untrusted' CHECK(prompt_eligibility IN ('trusted_structural', 'untrusted'))",
  );
  ensureEpisodeSourceIdentity(db);
  ensureFactEvidenceIdentity(db);
  ensureCanonicalFactTable(db);
  ensureFactContentIdentityV3(db);
  ensureFactTermStats(db);
  db.execSync(`
    DROP INDEX IF EXISTS idx_fact_terms_unit_kind;
    DROP INDEX IF EXISTS idx_fact_terms_source;
    CREATE INDEX IF NOT EXISTS idx_facts_subject
      ON memory_facts(subject_id);
    CREATE INDEX IF NOT EXISTS idx_facts_subject_predicate
      ON memory_facts(subject_id, predicate);
    CREATE INDEX IF NOT EXISTS idx_facts_subject_predicate_nocase
      ON memory_facts(subject_id, predicate COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_facts_valid
      ON memory_facts(invalid_at, deleted_at);
    CREATE INDEX IF NOT EXISTS idx_facts_pinned
      ON memory_facts(pinned);
    CREATE INDEX IF NOT EXISTS idx_fact_terms_source_unit_fact
      ON memory_fact_terms(source_run_id, unit, fact_id, weight);
    CREATE INDEX IF NOT EXISTS idx_facts_scope_origin
      ON memory_facts(scope, origin_conversation_id, deleted_at, invalid_at);
    CREATE INDEX IF NOT EXISTS idx_facts_evidence_scope
      ON memory_facts(origin_conversation_id, origin_thread_id, id);
    CREATE INDEX IF NOT EXISTS idx_facts_scope_task
      ON memory_facts(scope, origin_task_id, deleted_at, invalid_at);
    CREATE INDEX IF NOT EXISTS idx_facts_subject_predicate_scope
      ON memory_facts(subject_id, predicate, scope);
    CREATE INDEX IF NOT EXISTS idx_facts_content_hash
      ON memory_facts(content_hash);
    DROP INDEX IF EXISTS idx_facts_active_content_hash;
    CREATE INDEX IF NOT EXISTS idx_facts_last_recalled
      ON memory_facts(last_recalled_at);
    CREATE INDEX IF NOT EXISTS idx_facts_importance
      ON memory_facts(importance);
    CREATE INDEX IF NOT EXISTS idx_facts_live_kind_rank
      ON memory_facts(
        memory_kind,
        invalid_at,
        deleted_at,
        pinned DESC,
        retrievability DESC,
        importance DESC,
        updated_at DESC
      );
    CREATE INDEX IF NOT EXISTS idx_facts_scope_origin_kind_rank
      ON memory_facts(
        scope,
        origin_conversation_id,
        memory_kind,
        deleted_at,
        invalid_at,
        pinned DESC,
        importance DESC,
        updated_at DESC
      );
    CREATE INDEX IF NOT EXISTS idx_facts_scope_task_kind_rank
      ON memory_facts(
        scope,
        origin_task_id,
        memory_kind,
        deleted_at,
        invalid_at,
        pinned DESC,
        importance DESC,
        updated_at DESC
      );
    CREATE INDEX IF NOT EXISTS idx_facts_scope_kind_rank
      ON memory_facts(
        scope,
        memory_kind,
        invalid_at,
        deleted_at,
        pinned DESC,
        retrievability DESC,
        importance DESC,
        updated_at DESC
      );
    CREATE INDEX IF NOT EXISTS idx_facts_source_kind_rank
      ON memory_facts(
        source_run_id,
        memory_kind,
        invalid_at,
        deleted_at,
        updated_at DESC
      );
    CREATE INDEX IF NOT EXISTS idx_facts_applicability_scope
      ON memory_facts(
        memory_owner_id,
        persona_id,
        fact_class,
        source_authority,
        deleted_at,
        invalid_at
      );
    CREATE INDEX IF NOT EXISTS idx_facts_grounded_source
      ON memory_facts(
        memory_owner_id,
        subject_id,
        source_message_id,
        scope,
        fact_class,
        source_authority,
        invalid_at,
        deleted_at
      );
    CREATE INDEX IF NOT EXISTS idx_facts_local_similarity_current
      ON memory_facts(
        memory_owner_id,
        invalid_at,
        deleted_at,
        local_similarity_model,
        local_similarity_dimensions
      );
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
    'sensitivity',
    "sensitivity TEXT NOT NULL DEFAULT 'sensitive' CHECK(sensitivity IN ('normal', 'private', 'sensitive'))",
  );
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

function ensureEpisodeSourceIdentity(db: ReturnType<typeof getMemoryDb>): void {
  db.execSync(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_episodes_active_source_window
      ON memory_episodes(
        COALESCE(conversation_id, ''),
        COALESCE(thread_id, ''),
        source_end_message_id
      )
      WHERE deleted_at IS NULL AND source_end_message_id IS NOT NULL;
  `);
}

function ensureFactEvidenceIdentity(db: ReturnType<typeof getMemoryDb>): void {
  db.execSync(`
    DELETE FROM memory_fact_evidence
      WHERE message_id IS NOT NULL
        AND rowid NOT IN (
          SELECT MIN(rowid)
            FROM memory_fact_evidence
           WHERE message_id IS NOT NULL
           GROUP BY fact_id, message_id
        );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_fact_evidence_fact_message
      ON memory_fact_evidence(fact_id, message_id)
      WHERE message_id IS NOT NULL;
  `);
}

interface FactContentIdentityRow {
  id: string;
  memory_owner_id: string | null;
  memory_kind: string | null;
  scope: string | null;
  origin_conversation_id: string | null;
  origin_thread_id: string | null;
  origin_task_id: string | null;
  persona_id: string | null;
  subject_id: string;
  predicate: string;
  object_text: string;
  object_entity_id: string | null;
}

/**
 * Migrate only facts written with the pre-v3 identity. Stored predicate and
 * object text remain untouched because they are user-visible, case-sensitive
 * data; normalization belongs in the derived identity only.
 */
function ensureFactContentIdentityV3(db: ReturnType<typeof getMemoryDb>): void {
  db.execSync('BEGIN IMMEDIATE TRANSACTION');
  try {
    db.runSync(
      `UPDATE memory_facts
          SET memory_owner_id = ?
        WHERE memory_owner_id IS NULL
          AND scope IN ('global', 'project', 'conversation', 'session')`,
      getLocalMemoryVaultOwnerId(db),
    );
    db.runSync(
      `UPDATE memory_facts
          SET fact_class = 'subjective_user',
              source_authority = 'assistant_inferred'
        WHERE fact_class = 'unknown'
          AND source_authority = 'unknown'
          AND memory_owner_id IS NOT NULL
          AND scope != 'persona'
          AND EXISTS (
            SELECT 1
              FROM memory_entities AS subject
             WHERE subject.id = memory_facts.subject_id
               AND subject.type = 'self'
          )`,
    );
    db.runSync(
      `UPDATE memory_facts
          SET fact_class = 'workflow',
              source_authority = 'assistant_inferred'
        WHERE fact_class = 'unknown'
          AND source_authority = 'unknown'
          AND memory_owner_id IS NOT NULL
          AND scope != 'persona'
          AND memory_kind IN (
            'episodic_event', 'goal', 'tool_result', 'decision', 'risk', 'artifact',
            'summary', 'evidence_span', 'agent_run', 'gotcha'
          )`,
    );
    const rows = db.getAllSync<FactContentIdentityRow>(
      `SELECT id, memory_owner_id, memory_kind, scope, origin_conversation_id, origin_thread_id,
              origin_task_id, persona_id, subject_id, predicate, object_text, object_entity_id
         FROM memory_facts
        WHERE SUBSTR(content_hash, 1, 3) != 'v3_'`,
    );
    for (const row of rows) {
      if (typeof row.scope !== 'string') {
        throw new Error('memory_fact_content_identity_scope_invalid');
      }
      const contentHash = buildFactContentHash({
        memoryOwnerId: row.memory_owner_id,
        memoryKind: row.memory_kind,
        scope: row.scope,
        originConversationId: row.origin_conversation_id,
        originThreadId: row.origin_thread_id,
        originTaskId: row.origin_task_id,
        personaId: row.persona_id,
        subjectId: row.subject_id,
        predicate: row.predicate,
        objectText: row.object_text,
        objectEntityId: row.object_entity_id,
      });
      db.runSync('UPDATE memory_facts SET content_hash = ? WHERE id = ?', contentHash, row.id);
    }
    db.execSync('COMMIT');
  } catch (error) {
    db.execSync('ROLLBACK');
    throw error;
  }
}

export function resetFactSchemaCacheForTests(): void {
  schemaReady = false;
}

export function clearStructuredMemoryDatabase(db: ReturnType<typeof getMemoryDb>): void {
  runMemoryDatabaseSavepoint(db, (database) => {
    for (const table of CLEARED_STRUCTURED_MEMORY_TABLES) {
      const exists = database.getFirstSync<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        table,
      );
      if (exists) database.runSync(`DELETE FROM ${table}`);
    }
  });
}

export function clearStructuredMemory(): void {
  ensureFactSchema();
  clearStructuredMemoryDatabase(getMemoryDb());
}

function ensureFactTermStats(db: ReturnType<typeof getMemoryDb>): void {
  const statsCount =
    db.getFirstSync<{ count: number }>('SELECT COUNT(*) AS count FROM memory_fact_term_stats')
      ?.count ?? 0;
  if (statsCount > 0) return;
  const termsCount =
    db.getFirstSync<{ count: number }>('SELECT COUNT(*) AS count FROM memory_fact_terms')?.count ??
    0;
  if (termsCount === 0) return;
  db.execSync(`
    INSERT OR REPLACE INTO memory_fact_term_stats(unit, memory_kind, fact_count, total_weight)
    SELECT unit, memory_kind, COUNT(*) AS fact_count, SUM(weight) AS total_weight
      FROM memory_fact_terms
     GROUP BY unit, memory_kind;
  `);
}

// ── Shared internal helpers ──────────────────────────────────────────────

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
