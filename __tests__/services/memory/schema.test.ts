// ---------------------------------------------------------------------------
// Tests - Living memory schema migrations
// ---------------------------------------------------------------------------
// Legacy/fail-closed migration concerns live in schema.legacyMigrations.test.ts
// (split out to stay under the maintainability line budget). This file
// covers the current schema shape, idempotency, the provider-embedding
// column migration, and structured-memory clearing.

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

describe('ensureFactSchema', () => {
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
        'provider_embedding_model',
        'provider_embedding_dimensions',
        'provider_embedding_vector',
        'provider_embedding_updated_at',
      ]),
    );
    expect(columnNames('memory_episodes')).toEqual(
      expect.arrayContaining([
        'summary',
        'sensitivity',
        'embedding',
        'embedding_model',
        'embedding_dimensions',
        'embedding_updated_at',
      ]),
    );
    expect(indexNames('memory_facts')).toContain('idx_facts_provider_embedding_current');
    expect(indexNames('memory_episodes')).toContain('idx_episodes_embedding_current');
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

  it('applies the provider-embedding column migration idempotently and preserves written vectors', () => {
    ensureFactSchema();
    const entity = upsertEntity({ name: 'user', type: 'self', now: 1 });
    const recorded = recordContributedSchemaFact(entity.id);
    getMemoryDb().runSync(
      `UPDATE memory_facts
          SET provider_embedding_model = ?,
              provider_embedding_dimensions = ?,
              provider_embedding_vector = ?,
              provider_embedding_updated_at = ?
        WHERE id = ?`,
      'text-embedding-3-small',
      3,
      '[0.1,0.2,0.3]',
      5,
      recorded.fact.id,
    );
    const episode = recordThreadLocalEpisode({
      conversationId: 'conv-schema-embedding',
      summary: 'User prefers async updates.',
      ...codeOwnedClosedTurnEpisodeFields({
        sourceUserMessageId: 'schema-embedding-user-message',
        sourceAssistantMessageId: 'schema-embedding-assistant-turn',
        userContent: 'User prefers async updates.',
        assistantContent: 'Preference recorded.',
      }),
      now: 6,
    });
    expect(episode).not.toBeNull();
    getMemoryDb().runSync(
      `UPDATE memory_episodes
          SET embedding = ?, embedding_model = ?, embedding_dimensions = ?, embedding_updated_at = ?
        WHERE id = ?`,
      '[0.4,0.5,0.6]',
      'text-embedding-3-small',
      3,
      7,
      episode!.id,
    );

    const beforeFactColumns = columnNames('memory_facts').slice().sort();
    const beforeEpisodeColumns = columnNames('memory_episodes').slice().sort();

    resetFactSchemaCacheForTests();
    expect(() => ensureFactSchema()).not.toThrow();
    resetFactSchemaCacheForTests();
    expect(() => ensureFactSchema()).not.toThrow();

    expect(columnNames('memory_facts').slice().sort()).toEqual(beforeFactColumns);
    expect(columnNames('memory_episodes').slice().sort()).toEqual(beforeEpisodeColumns);

    const row = getMemoryDb().getFirstSync<{
      provider_embedding_model: string;
      provider_embedding_dimensions: number;
      provider_embedding_vector: string;
      provider_embedding_updated_at: number;
    }>(
      `SELECT provider_embedding_model, provider_embedding_dimensions,
              provider_embedding_vector, provider_embedding_updated_at
         FROM memory_facts WHERE id = ?`,
      recorded.fact.id,
    );
    expect(row).toEqual({
      provider_embedding_model: 'text-embedding-3-small',
      provider_embedding_dimensions: 3,
      provider_embedding_vector: '[0.1,0.2,0.3]',
      provider_embedding_updated_at: 5,
    });

    const episodeRow = getMemoryDb().getFirstSync<{
      embedding: string;
      embedding_model: string;
      embedding_dimensions: number;
      embedding_updated_at: number;
    }>(
      `SELECT embedding, embedding_model, embedding_dimensions, embedding_updated_at
         FROM memory_episodes WHERE id = ?`,
      episode!.id,
    );
    expect(episodeRow).toEqual({
      embedding: '[0.4,0.5,0.6]',
      embedding_model: 'text-embedding-3-small',
      embedding_dimensions: 3,
      embedding_updated_at: 7,
    });
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
