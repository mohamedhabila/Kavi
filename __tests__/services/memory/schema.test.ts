// ---------------------------------------------------------------------------
// Tests - Living memory schema migrations
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/sqlite-store';
import {
  clearStructuredMemory,
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { recordFact } from '../../../src/services/memory/facts/mutations';
import { upsertEntity } from '../../../src/services/memory/entities';
import { recordEpisode, addFactEvidence } from '../../../src/services/memory/episodes/mutations';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
});

afterEach(() => {
  closeMemoryDb();
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

describe('ensureFactSchema', () => {
  it('migrates legacy unique hashes without losing fact history rows', () => {
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
        'idx_facts_active_content_hash',
        'idx_facts_subject',
        'idx_facts_subject_predicate',
        'idx_facts_subject_predicate_nocase',
        'idx_facts_valid',
        'idx_facts_pinned',
      ]),
    );
    expect(
      getMemoryDb().getFirstSync<{ id: string; predicate: string; content_hash: string }>(
        "SELECT id, predicate, content_hash FROM memory_facts WHERE id = 'legacy-fact'",
      ),
    ).toEqual({
      id: 'legacy-fact',
      predicate: 'LIVES_IN',
      content_hash: expect.stringMatching(/^v2_[0-9a-f]{32}$/),
    });
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
    expect(columnNames('memory_episodes')).toContain('summary');
    expect(columnNames('memory_fact_evidence')).toContain('fact_id');
    expect(columnNames('memory_ingestion_jobs')).toContain('provider_enrichment');
  });

  it('migrates ingestion jobs to bounded durable states without retaining raw errors', () => {
    ensureFactSchema();
    const freshIndexes = indexNames('memory_ingestion_jobs').sort();

    closeMemoryDb();
    expoSqlite.__resetExpoSqliteForTests();
    resetFactSchemaCacheForTests();
    getMemoryDb().execSync(`
      CREATE TABLE memory_ingestion_jobs (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        memory_conversation_id TEXT,
        task_id TEXT,
        source_start_message_id TEXT,
        source_end_message_id TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT 'turn_completed',
        status TEXT NOT NULL DEFAULT 'pending',
        attempt_count INTEGER NOT NULL DEFAULT 0,
        provider_enrichment INTEGER NOT NULL DEFAULT 1,
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER
      );
      INSERT INTO memory_ingestion_jobs VALUES
        ('pending-job', 'thread-1', NULL, NULL, 'u-1', 'a-1', 'turn_completed',
         'pending', 0, 1, 'raw provider response', 1, 2, NULL),
        ('stale-job', 'thread-2', 'memory-2', NULL, 'u-2', 'a-2', 'turn_completed',
         'processing', 2, 1, 'secret exception text', 3, 4, NULL),
        ('completed-job', 'thread-3', 'memory-3', NULL, 'u-3', 'a-3', 'turn_completed',
         'completed', 1, 1, 'old silent success', 5, 6, 7),
        ('duplicate-pending-job', 'thread-3', 'memory-3', NULL, 'u-3', 'a-3', 'turn_completed',
         'pending', 0, 1, 'duplicate callback', 5, 8, NULL);
    `);

    ensureFactSchema();

    expect(indexNames('memory_ingestion_jobs').sort()).toEqual(freshIndexes);
    expect(columnNames('memory_ingestion_jobs')).toEqual(
      expect.arrayContaining([
        'provider_outcome',
        'outcome_code',
        'next_attempt_at',
        'lease_expires_at',
        'structural_completed_at',
      ]),
    );
    expect(columnNames('memory_ingestion_jobs')).not.toContain('error');
    expect(
      getMemoryDb().getAllSync<{
        id: string;
        status: string;
        provider_outcome: string | null;
        outcome_code: string | null;
        next_attempt_at: number | null;
        structural_completed_at: number | null;
      }>(
        `SELECT id, status, provider_outcome, outcome_code, next_attempt_at,
                structural_completed_at
           FROM memory_ingestion_jobs
          ORDER BY id`,
      ),
    ).toEqual([
      {
        id: 'completed-job',
        status: 'completed_structural',
        provider_outcome: 'structural_only',
        outcome_code: null,
        next_attempt_at: null,
        structural_completed_at: 7,
      },
      {
        id: 'pending-job',
        status: 'pending',
        provider_outcome: null,
        outcome_code: null,
        next_attempt_at: 2,
        structural_completed_at: null,
      },
      {
        id: 'stale-job',
        status: 'retrying',
        provider_outcome: null,
        outcome_code: 'stale_processing_lease',
        next_attempt_at: 4,
        structural_completed_at: null,
      },
    ]);
    expect(() =>
      getMemoryDb().runSync(
        "UPDATE memory_ingestion_jobs SET outcome_code = 'raw exception text' WHERE id = 'pending-job'",
      ),
    ).toThrow();
    expect(() =>
      getMemoryDb().runSync(
        "UPDATE memory_ingestion_jobs SET status = 'completed' WHERE id = 'pending-job'",
      ),
    ).toThrow();
    expect(() =>
      getMemoryDb().runSync(
        "UPDATE memory_ingestion_jobs SET status = 'completed_structural' WHERE id = 'pending-job'",
      ),
    ).toThrow();
  });

  it('is idempotent and preserves existing rows across migration calls', () => {
    ensureFactSchema();
    const entity = upsertEntity({ name: 'user', type: 'self', now: 1 });
    const recorded = recordFact({
      subjectId: entity.id,
      predicate: 'prefers_tone',
      objectText: 'brief',
      now: 2,
    });
    const episode = recordEpisode({
      conversationId: 'conv-schema',
      summary: 'User prefers brief answers.',
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

  it('enforces exact active fact identity in SQLite', () => {
    ensureFactSchema();
    const recorded = recordFact({
      subjectId: 'entity-user',
      predicate: 'opaque_token',
      objectText: 'AbC',
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
        'AbC',
        recorded.fact.contentHash,
        11,
        11,
        11,
      ),
    ).toThrow();
  });

  it('maintains retrieval term statistics with fact term writes and clears', () => {
    ensureFactSchema();
    const entity = upsertEntity({ name: 'forum', type: 'project', now: 1 });
    recordFact({
      subjectId: entity.id,
      predicate: 'agent_run',
      objectText: 'Cyberpunk forum analysis produced reports/analysis.json',
      memoryKind: 'agent_run',
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

  it('indexes direct evidence span memories as first-class recall records', () => {
    ensureFactSchema();
    const entity = upsertEntity({ name: 'release', type: 'project', now: 1 });
    recordFact({
      subjectId: entity.id,
      predicate: 'evidence_span',
      objectText: 'release manifest path dist/release-manifest.json',
      memoryKind: 'evidence_span',
      now: 2,
    });

    const stats = getMemoryDb().getFirstSync<{ fact_count: number }>(
      `SELECT fact_count
         FROM memory_fact_term_stats
        WHERE unit = ?
          AND memory_kind = ?`,
      'manifest',
      'evidence_span',
    );
    expect(stats?.fact_count).toBe(1);
  });

  it('indexes source-run lexical expansion by source and query unit', () => {
    ensureFactSchema();

    expect(indexNames('memory_fact_terms')).toContain('idx_fact_terms_source_unit_fact');
    expect(indexedColumns('idx_fact_terms_source_unit_fact').slice(0, 3)).toEqual([
      'source_run_id',
      'unit',
      'fact_id',
    ]);
  });
});
