// ---------------------------------------------------------------------------
// Tests - Living memory schema migrations
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import {
  clearStructuredMemory,
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { recordFact } from '../../../src/services/memory/facts/mutations';
import { upsertEntity } from '../../../src/services/memory/entities';
import {
  recordEpisode,
  recordThreadLocalEpisode,
  addFactEvidence,
} from '../../../src/services/memory/episodes/mutations';
import { getLocalMemoryVaultOwnerId } from '../../../src/services/memory/memoryVaultIdentity';
import { recordContributedSchemaFact } from '../../helpers/contributedSchemaFact';
import { codeOwnedClosedTurnEpisodeFields } from '../../helpers/memoryRetirementTestFixtures';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
});

afterEach(() => {
  closeMemoryDb();
  jest.restoreAllMocks();
});

function columnNames(table: string): string[] {
  return getMemoryDb()
    .getAllSync<{ name: string }>(`PRAGMA table_info(${table})`)
    .map((row) => row.name);
}

function indexNames(table: string): string[] {
  return getMemoryDb()
    .getAllSync<{ name: string }>(`PRAGMA index_list(${table})`)
    .map((row) => row.name);
}

function indexedColumns(index: string): string[] {
  return getMemoryDb()
    .getAllSync<{ name: string }>(`PRAGMA index_info(${index})`)
    .map((row) => row.name);
}

function reopenLegacyFactContributionAdmissionBoundary(): void {
  getMemoryDb().execSync(`
    DROP TRIGGER IF EXISTS trg_memory_fact_contribution_admission_immutable;
    DROP TRIGGER IF EXISTS trg_memory_fact_contribution_admission_insert_immutable;
    DROP TRIGGER IF EXISTS trg_memory_fact_contribution_admission_delete_immutable;
    DELETE FROM memory_fact_contribution_admission;
  `);
}
describe('ensureFactSchema', () => {
  it('migrates legacy episodes to a fail-closed sensitive classification', () => {
    const db = getMemoryDb();
    db.execSync(`
      CREATE TABLE memory_episodes (
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
        deleted_at INTEGER,
        source_start_message_id TEXT,
        source_end_message_id TEXT
      );
      INSERT INTO memory_episodes (
        id, conversation_id, thread_id, started_at, ended_at, summary,
        message_ids_json, created_at, source_start_message_id, source_end_message_id
      ) VALUES (
        'legacy-episode', 'legacy-root', 'legacy-thread', 1, 2, 'Legacy episode',
        '["legacy-user","legacy-assistant"]', 2, 'legacy-user', 'legacy-assistant'
      );
    `);

    ensureFactSchema();

    expect(columnNames('memory_episodes')).toContain('sensitivity');
    expect(
      db.getFirstSync<{ sensitivity: string }>(
        'SELECT sensitivity FROM memory_episodes WHERE id = ?',
        'legacy-episode',
      )?.sensitivity,
    ).toBe('sensitive');
  });

  it('destroys legacy provider-editable raw blocks without recreating the table', () => {
    const db = getMemoryDb();
    db.execSync(`
      CREATE TABLE memory_blocks (
        label TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        char_limit INTEGER NOT NULL,
        description TEXT NOT NULL,
        pinned INTEGER NOT NULL,
        persona_id TEXT,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO memory_blocks (
        label, content, char_limit, description, pinned, persona_id, updated_at
      ) VALUES (
        'profile', 'PRIVATE-LEGACY-BLOCK-SENTINEL', 1000, 'legacy raw profile', 1, NULL, 1
      );
    `);

    ensureFactSchema();

    expect(
      db.getFirstSync(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_blocks'",
      ),
    ).toBeNull();

    resetFactSchemaCacheForTests();
    ensureFactSchema();
    expect(
      db.getFirstSync(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_blocks'",
      ),
    ).toBeNull();
  });

  it('renames the retired retrieval similarity columns in place', () => {
    ensureFactSchema();
    const db = getMemoryDb();
    db.execSync(`
      ALTER TABLE memory_retrieval_events
        RENAME COLUMN local_similarity_outcome TO local_semantic_outcome;
      ALTER TABLE memory_retrieval_events
        RENAME COLUMN candidate_local_similarity_count TO candidate_local_semantic_count;
    `);

    resetFactSchemaCacheForTests();
    ensureFactSchema();

    const columns = columnNames('memory_retrieval_events');
    expect(columns).toEqual(
      expect.arrayContaining(['local_similarity_outcome', 'candidate_local_similarity_count']),
    );
    expect(columns).not.toContain('local_semantic_outcome');
    expect(columns).not.toContain('candidate_local_semantic_count');
  });

  it('canonicalizes legacy unique hashes before purging source-less content', () => {
    ensureFactSchema();
    const freshIndexes = indexNames('memory_facts').sort();

    closeMemoryDb();
    expoSqlite.__resetExpoSqliteForTests();
    resetFactSchemaCacheForTests();
    getMemoryDb().execSync(`
      CREATE TABLE memory_facts (
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
      INSERT INTO memory_facts (
        id, subject_id, predicate, object_text, content_hash,
        valid_at, created_at, updated_at
      ) VALUES ('legacy-fact', 'legacy-user', 'LIVES_IN', 'Amsterdam', 'hash-a', 1, 1, 1);
    `);

    ensureFactSchema();

    const tableSql = getMemoryDb().getFirstSync<{ sql: string }>(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'memory_facts'",
    )?.sql;
    expect(tableSql).not.toMatch(/UNIQUE\s*\(\s*content_hash\s*\)/i);
    expect(indexNames('memory_facts').sort()).toEqual(freshIndexes);
    expect(indexNames('memory_facts')).toEqual(
      expect.arrayContaining([
        'idx_facts_content_hash',
        'idx_facts_subject',
        'idx_facts_subject_predicate',
        'idx_facts_subject_predicate_nocase',
        'idx_facts_valid',
        'idx_facts_pinned',
        'idx_facts_grounded_source',
      ]),
    );
    expect(indexedColumns('idx_facts_grounded_source')).toEqual([
      'memory_owner_id',
      'subject_id',
      'source_message_id',
      'scope',
      'fact_class',
      'source_authority',
      'invalid_at',
      'deleted_at',
    ]);
    expect(indexNames('memory_facts')).not.toContain('idx_facts_active_content_hash');
    expect(
      getMemoryDb().getFirstSync<{ id: string; predicate: string; content_hash: string }>(
        "SELECT id, predicate, content_hash FROM memory_facts WHERE id = 'legacy-fact'",
      ),
    ).toBeNull();
    expect(
      getMemoryDb().getFirstSync<{ fact_id: string; reason: string }>(
        "SELECT fact_id, reason FROM memory_fact_legacy_quarantine WHERE fact_id = 'legacy-fact'",
      ),
    ).toEqual({ fact_id: 'legacy-fact', reason: 'source_missing' });
  });

  it('purges structurally inferred provenance that lacks exact causal sources', () => {
    ensureFactSchema();
    reopenLegacyFactContributionAdmissionBoundary();
    getMemoryDb().execSync(`
      INSERT INTO memory_entities(
        id, canonical_name, type, aliases, attributes, first_seen_at, last_seen_at
      ) VALUES
        ('legacy-self', 'user', 'self', '[]', '{}', 1, 1),
        ('legacy-project', 'release', 'project', '[]', '{}', 1, 1),
        ('legacy-concept', 'weather', 'concept', '[]', '{}', 1, 1);
      INSERT INTO memory_facts(
        id, subject_id, predicate, object_text, attributes, content_hash,
        valid_at, created_at, updated_at, scope, memory_kind
      ) VALUES
        ('legacy-preference', 'legacy-self', 'prefers_tone', 'brief', '{}',
         'legacy-preference-hash', 1, 1, 1, 'global', 'semantic_fact'),
        ('legacy-procedure', 'legacy-project', 'release_goal', 'ship safely', '{}',
         'legacy-procedure-hash', 1, 1, 1, 'project', 'goal'),
        ('legacy-unverifiable', 'legacy-concept', 'temperature', '22 C',
         '{"factClass":"objective","sourceAuthority":"external_source"}',
         'legacy-unverifiable-hash', 1, 1, 1, 'global', 'semantic_fact'),
        ('legacy-unbound-persona', 'legacy-self', 'tone', 'warm', '{}',
         'legacy-persona-hash', 1, 1, 1, 'persona', 'semantic_fact'),
        ('legacy-malformed-scope', 'legacy-self', 'timezone', 'UTC', '{}',
         'legacy-malformed-hash', 1, 1, 1, 'malformed', 'semantic_fact');
    `);

    resetFactSchemaCacheForTests();
    ensureFactSchema();

    const readQuarantine = () =>
      getMemoryDb().getAllSync<{ fact_id: string; reason: string }>(
        `SELECT fact_id, reason FROM memory_fact_legacy_quarantine ORDER BY fact_id`,
      );
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        "SELECT COUNT(*) AS count FROM memory_facts WHERE id LIKE 'legacy-%'",
      )?.count,
    ).toBe(0);
    const quarantined = readQuarantine();
    expect(quarantined.map(({ fact_id }) => fact_id)).toEqual([
      'legacy-malformed-scope',
      'legacy-preference',
      'legacy-procedure',
      'legacy-unbound-persona',
      'legacy-unverifiable',
    ]);

    resetFactSchemaCacheForTests();
    ensureFactSchema();
    expect(readQuarantine()).toEqual(quarantined);
  });

  it('atomically canonicalizes task-only and equal dual task identities', () => {
    ensureFactSchema();
    reopenLegacyFactContributionAdmissionBoundary();
    const db = getMemoryDb();
    const indexesBefore = indexNames('memory_facts').sort();
    db.execSync('ALTER TABLE memory_facts ADD COLUMN task_id TEXT;');
    const memoryOwnerId = getLocalMemoryVaultOwnerId(db);
    db.runSync(
      `INSERT INTO memory_facts(
        id, subject_id, predicate, object_text, content_hash, valid_at, created_at,
        updated_at, scope, origin_conversation_id, origin_thread_id, origin_task_id,
        task_id, memory_owner_id, source_message_id
      ) VALUES
        ('legacy-task-only', 'subject-1', 'state', 'one', 'legacy-task-only-hash',
         1, 1, 1, 'session', 'conversation-1', 'thread-1', NULL, 'task-1', ?,
         'legacy-task-only-message'),
        ('legacy-task-equal', 'subject-2', 'state', 'two', 'legacy-task-equal-hash',
         1, 1, 1, 'session', 'conversation-1', 'thread-1', 'task-2', 'task-2', ?,
         'legacy-task-equal-message')`,
      memoryOwnerId,
      memoryOwnerId,
    );
    const execSpy = jest.spyOn(db, 'execSync');

    resetFactSchemaCacheForTests();
    ensureFactSchema();

    expect(columnNames('memory_facts')).not.toContain('task_id');
    expect(
      db.getAllSync<{ id: string; origin_task_id: string | null }>(
        `SELECT id, origin_task_id
           FROM memory_facts
          WHERE id IN ('legacy-task-only', 'legacy-task-equal')
          ORDER BY id`,
      ),
    ).toEqual([
      { id: 'legacy-task-equal', origin_task_id: 'task-2' },
      { id: 'legacy-task-only', origin_task_id: 'task-1' },
    ]);
    expect(indexNames('memory_facts').sort()).toEqual(indexesBefore);
    expect(execSpy.mock.calls.some(([sql]) => /DROP\s+COLUMN/i.test(sql))).toBe(false);
  });

  it('fails closed when canonical and legacy task identities conflict', () => {
    ensureFactSchema();
    const db = getMemoryDb();
    db.execSync(`
      ALTER TABLE memory_facts ADD COLUMN task_id TEXT;
      INSERT INTO memory_facts(
        id, subject_id, predicate, object_text, content_hash, valid_at, created_at,
        updated_at, scope, origin_conversation_id, origin_thread_id, origin_task_id,
        task_id
      ) VALUES (
        'legacy-task-conflict', 'subject-1', 'state', 'one', 'legacy-task-conflict-hash',
        1, 1, 1, 'session', 'conversation-1', 'thread-1', 'canonical-task', 'legacy-task'
      );
    `);

    resetFactSchemaCacheForTests();
    expect(() => ensureFactSchema()).toThrow('memory_fact_task_identity_conflict');
    expect(columnNames('memory_facts')).toContain('task_id');
    expect(
      db.getFirstSync<{ origin_task_id: string; task_id: string }>(
        `SELECT origin_task_id, task_id
           FROM memory_facts
          WHERE id = 'legacy-task-conflict'`,
      ),
    ).toEqual({ origin_task_id: 'canonical-task', task_id: 'legacy-task' });
  });

  it.each([
    ['index', 'idx_legacy_fact_task', 'CREATE INDEX idx_legacy_fact_task ON memory_facts(task_id)'],
    [
      'trigger',
      'trg_legacy_fact_task',
      `CREATE TRIGGER trg_legacy_fact_task
         AFTER UPDATE OF task_id ON memory_facts
         BEGIN
           SELECT NEW.task_id;
         END`,
    ],
  ])('fails closed on a legacy task-dependent %s', (_kind, objectName, objectSql) => {
    ensureFactSchema();
    const db = getMemoryDb();
    db.execSync(`
      ALTER TABLE memory_facts ADD COLUMN task_id TEXT;
      INSERT INTO memory_facts(
        id, subject_id, predicate, object_text, content_hash, valid_at, created_at,
        updated_at, scope, origin_conversation_id, origin_thread_id, task_id
      ) VALUES (
        'legacy-task-object', 'subject-1', 'state', 'one', 'legacy-task-object-hash',
        1, 1, 1, 'session', 'conversation-1', 'thread-1', 'task-1'
      );
    `);
    db.execSync(objectSql);

    resetFactSchemaCacheForTests();
    expect(() => ensureFactSchema()).toThrow('memory_fact_legacy_task_schema_object_unsupported');

    expect(columnNames('memory_facts')).toContain('task_id');
    expect(
      db.getFirstSync<{ origin_task_id: string | null; task_id: string }>(
        `SELECT origin_task_id, task_id
           FROM memory_facts
          WHERE id = 'legacy-task-object'`,
      ),
    ).toEqual({ origin_task_id: null, task_id: 'task-1' });
    expect(
      db.getFirstSync<{ name: string }>('SELECT name FROM sqlite_master WHERE name = ?', objectName)
        ?.name,
    ).toBe(objectName);
  });

  it('fails closed on an unknown fact schema object during canonical rebuild', () => {
    ensureFactSchema();
    const db = getMemoryDb();
    db.execSync(`
      ALTER TABLE memory_facts ADD COLUMN task_id TEXT;
      CREATE INDEX idx_extension_fact_predicate ON memory_facts(predicate);
      INSERT INTO memory_facts(
        id, subject_id, predicate, object_text, content_hash, valid_at, created_at,
        updated_at, scope, task_id
      ) VALUES (
        'extension-object-fact', 'subject-1', 'state', 'one', 'extension-object-hash',
        1, 1, 1, 'session', 'task-1'
      );
    `);

    resetFactSchemaCacheForTests();
    expect(() => ensureFactSchema()).toThrow('memory_fact_schema_object_unsupported');
    expect(columnNames('memory_facts')).toContain('task_id');
    expect(indexNames('memory_facts')).toContain('idx_extension_fact_predicate');
    expect(
      db.getFirstSync<{ object_text: string; task_id: string }>(
        "SELECT object_text, task_id FROM memory_facts WHERE id = 'extension-object-fact'",
      ),
    ).toEqual({ object_text: 'one', task_id: 'task-1' });
  });

  it('fails closed instead of discarding unsupported fact columns', () => {
    ensureFactSchema();
    const db = getMemoryDb();
    db.execSync(`
      ALTER TABLE memory_facts ADD COLUMN task_id TEXT;
      ALTER TABLE memory_facts ADD COLUMN extension_payload TEXT;
    `);

    resetFactSchemaCacheForTests();
    expect(() => ensureFactSchema()).toThrow('memory_fact_schema_column_unsupported');
    expect(columnNames('memory_facts')).toEqual(
      expect.arrayContaining(['task_id', 'extension_payload']),
    );
  });

  it('creates scoped fact provenance columns and episodic tables', () => {
    ensureFactSchema();

    expect(columnNames('memory_facts')).toEqual(
      expect.arrayContaining([
        'scope',
        'origin_conversation_id',
        'origin_thread_id',
        'origin_task_id',
        'source_turn_id',
        'source_summary',
        'importance',
        'access_count',
        'last_recalled_at',
        'decay_policy',
      ]),
    );
    expect(columnNames('memory_episodes')).toEqual(
      expect.arrayContaining(['summary', 'sensitivity']),
    );
    expect(columnNames('memory_fact_evidence')).toContain('fact_id');
    expect(columnNames('memory_ingestion_jobs')).toContain('provider_enrichment');
    expect(columnNames('memory_ingestion_receipts')).toEqual(
      expect.arrayContaining([
        'job_id',
        'attempt_number',
        'episode_id',
        'deterministic_fact_ids_json',
        'provider_fact_ids_json',
        'invalidated_fact_ids_json',
        'bridged_evidence_fact_ids_json',
        'agent_run_memory_fact_ids_json',
        'active_focus_updated',
        'open_threads_updated',
        'provider_outcome',
        'provider_outcome_code',
        'persisted_at',
      ]),
    );
    expect(indexNames('memory_ingestion_receipts')).toContain(
      'idx_ingestion_receipts_persisted_at',
    );
    expect(columnNames('memory_ingestion_structural_receipts')).toEqual(
      expect.arrayContaining([
        'job_id',
        'attempt_number',
        'memory_conversation_id',
        'source_thread_id',
        'persona_id',
        'task_id',
        'source_run_id',
        'source_start_message_id',
        'source_end_message_id',
        'source_snapshot_sha256',
        'source_at',
        'episode_id',
        'deterministic_fact_ids_json',
        'provider_fact_ids_json',
        'invalidated_fact_ids_json',
        'bridged_evidence_fact_ids_json',
        'agent_run_memory_fact_ids_json',
        'active_focus_updated',
        'open_threads_updated',
        'persisted_at',
      ]),
    );
    expect(indexNames('memory_ingestion_structural_receipts')).toContain(
      'idx_ingestion_structural_receipts_persisted_at',
    );
  });

  it('is idempotent and preserves existing rows across migration calls', () => {
    ensureFactSchema();
    const entity = upsertEntity({ name: 'user', type: 'self', now: 1 });
    const recorded = recordContributedSchemaFact(entity.id);
    const episode = recordThreadLocalEpisode({
      conversationId: 'conv-schema',
      summary: 'User prefers brief answers.',
      ...codeOwnedClosedTurnEpisodeFields({
        sourceUserMessageId: 'schema-user-message',
        sourceAssistantMessageId: 'schema-assistant-turn',
        userContent: 'User prefers brief answers.',
        assistantContent: 'Preference recorded.',
      }),
      now: 3,
    });
    expect(episode).not.toBeNull();
    addFactEvidence({ factId: recorded.fact.id, episodeId: episode?.id, messageId: 'u-1', now: 4 });

    resetFactSchemaCacheForTests();
    expect(() => ensureFactSchema()).not.toThrow();

    const factCount = getMemoryDb().getFirstSync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM memory_facts',
    );
    const episodeCount = getMemoryDb().getFirstSync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM memory_episodes',
    );
    const evidenceCount = getMemoryDb().getFirstSync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM memory_fact_evidence',
    );
    expect(factCount?.count).toBe(1);
    expect(episodeCount?.count).toBe(1);
    expect(evidenceCount?.count).toBe(1);
  });

  it('treats content hashes as index hints and dedupes exact identity in the writer', () => {
    ensureFactSchema();
    const recorded = recordFact({
      subjectId: 'entity-user',
      predicate: 'opaque_token',
      objectText: 'AbC',
      scope: 'global',
      now: 10,
    });

    expect(() =>
      getMemoryDb().runSync(
        `INSERT INTO memory_facts
           (id, subject_id, predicate, object_text, content_hash, valid_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        'duplicate-active-fact',
        'entity-user',
        'opaque_token',
        'different-value-with-forced-hash',
        recorded.fact.contentHash,
        11,
        11,
        11,
      ),
    ).not.toThrow();

    const duplicate = recordFact({
      subjectId: 'entity-user',
      predicate: 'opaque_token',
      objectText: 'AbC',
      scope: 'global',
      now: 12,
    });
    expect(duplicate.status).toBe('duplicate');
    expect(duplicate.fact.id).toBe(recorded.fact.id);
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_facts WHERE content_hash = ?',
        recorded.fact.contentHash,
      )?.count,
    ).toBe(2);
  });

  it('maintains retrieval term statistics with fact term writes and clears', () => {
    ensureFactSchema();
    const entity = upsertEntity({ name: 'forum', type: 'project', now: 1 });
    recordFact({
      subjectId: entity.id,
      predicate: 'agent_run',
      objectText: 'Cyberpunk forum analysis produced reports/analysis.json',
      memoryKind: 'agent_run',
      scope: 'global',
      now: 2,
    });

    const stats = getMemoryDb().getFirstSync<{ fact_count: number }>(
      `SELECT fact_count
         FROM memory_fact_term_stats
        WHERE unit = ?
          AND memory_kind = ?`,
      'cyberpunk',
      'agent_run',
    );
    expect(stats?.fact_count).toBe(1);

    clearStructuredMemory();
    const statsAfterClear = getMemoryDb().getFirstSync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM memory_fact_term_stats',
    );
    expect(statsAfterClear?.count).toBe(0);
  });

  it('clears episode access policy state while preserving the local vault identity', () => {
    ensureFactSchema();
    const ownerId = getLocalMemoryVaultOwnerId(getMemoryDb());
    const episode = recordEpisode({
      conversationId: 'clear-root',
      threadId: 'clear-thread',
      taskId: null,
      summary: 'Clear this authorized episode.',
      ...codeOwnedClosedTurnEpisodeFields({
        sourceUserMessageId: 'clear-user',
        sourceAssistantMessageId: 'clear-assistant',
        userContent: 'Clear this authorized episode.',
        assistantContent: 'Cleared.',
      }),
      accessPolicy: {
        memoryConversationId: 'clear-root',
        sourceThreadId: 'clear-thread',
        personaId: 'default',
        taskId: null,
        shareability: 'thread_only',
      },
      now: 10,
    });
    expect(episode).not.toBeNull();
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_episode_access_policies',
      )?.count,
    ).toBe(1);

    clearStructuredMemory();

    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_episode_access_policies',
      )?.count,
    ).toBe(0);
    expect(
      getMemoryDb().getFirstSync<{ count: number }>('SELECT COUNT(*) AS count FROM memory_episodes')
        ?.count,
    ).toBe(0);
    expect(getLocalMemoryVaultOwnerId(getMemoryDb())).toBe(ownerId);
  });

});
