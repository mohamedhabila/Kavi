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
      ]),
    );
    expect(columnNames('memory_episodes')).toContain('summary');
    expect(columnNames('memory_fact_evidence')).toContain('fact_id');
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

  it('maintains retrieval term statistics with fact term writes and clears', () => {
    ensureFactSchema();
    const entity = upsertEntity({ name: 'forum', type: 'project', now: 1 });
    recordFact({
      subjectId: entity.id,
      predicate: 'ui_inventory',
      objectText: 'Cyberpunk forum Hide this forum',
      memoryKind: 'ui_inventory',
      now: 2,
    });

    const stats = getMemoryDb().getFirstSync<{ fact_count: number }>(
      `SELECT fact_count
         FROM memory_fact_term_stats
        WHERE unit = ?
          AND memory_kind = ?`,
      'cyberpunk',
      'ui_inventory',
    );
    expect(stats?.fact_count).toBe(1);

    clearStructuredMemory();
    const statsAfterClear = getMemoryDb().getFirstSync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM memory_fact_term_stats',
    );
    expect(statsAfterClear?.count).toBe(0);
  });
});
