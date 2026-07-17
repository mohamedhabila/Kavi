jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { upsertEntity } from '../../../src/services/memory/entities';
import { recordFact } from '../../../src/services/memory/facts/mutations';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
});

afterEach(() => {
  closeMemoryDb();
});

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

describe('memory schema retrieval indexes', () => {
  it('indexes direct evidence span memories as first-class recall records', () => {
    ensureFactSchema();
    const entity = upsertEntity({ name: 'release', type: 'project', now: 1 });
    recordFact({
      subjectId: entity.id,
      predicate: 'evidence_span',
      objectText: 'release manifest path dist/release-manifest.json',
      memoryKind: 'evidence_span',
      scope: 'global',
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
