jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { invalidateManagedMemoryFact } from '../../../src/services/memory/factExplicitOverrides';
import { recordFact } from '../../../src/services/memory/facts/mutations';
import {
  backfillCurrentFactLocalSimilarity,
  getLocalSimilarityDiagnostics,
  LOCAL_SIMILARITY_BACKFILL_P95_BUDGET_MS,
  maintainCurrentFactLocalSimilarity,
} from '../../../src/services/memory/localSimilarityBackfill';
import {
  LOCAL_SIMILARITY_DIMENSIONS,
  LOCAL_SIMILARITY_MODEL,
} from '../../../src/services/memory/localSimilarity';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import {
  captureMemoryAuthoritySnapshot,
  isMemoryProjectionSnapshotDurablyCurrent,
  isRestrictiveMemoryAuthoritySnapshotDurablyCurrent,
} from '../../../src/services/memory/memoryAuthority';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

afterEach(() => {
  closeMemoryDb();
});

function removeLocalSimilarity(factId: string): void {
  getMemoryDb().runSync(
    `UPDATE memory_facts
        SET local_similarity_model = NULL,
            local_similarity_dimensions = NULL,
            local_similarity_vector = NULL,
            local_similarity_updated_at = NULL
      WHERE id = ?`,
    factId,
  );
}

describe('local-similarity backfill', () => {
  function p95(values: ReadonlyArray<number>): number {
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.ceil(sorted.length * 0.95) - 1]!;
  }

  it('resumes in bounded batches without touching inactive or foreign-owned facts', () => {
    const activeOne = recordFact({
      subjectId: 'profile',
      predicate: 'first_preference',
      objectText: 'alpha',
      scope: 'global',
      now: 10,
    }).fact;
    const activeTwo = recordFact({
      subjectId: 'profile',
      predicate: 'second_preference',
      objectText: 'beta',
      scope: 'global',
      supersedePrior: false,
      now: 20,
    }).fact;
    const invalid = recordFact({
      subjectId: 'profile',
      predicate: 'invalid_preference',
      objectText: 'gamma',
      scope: 'global',
      supersedePrior: false,
      now: 30,
    }).fact;
    const expired = recordFact({
      subjectId: 'profile',
      predicate: 'expired_preference',
      objectText: 'delta',
      scope: 'global',
      supersedePrior: false,
      expiresAt: 900,
      now: 40,
    }).fact;
    const deleted = recordFact({
      subjectId: 'profile',
      predicate: 'deleted_preference',
      objectText: 'epsilon',
      scope: 'global',
      supersedePrior: false,
      now: 50,
    }).fact;
    const foreign = recordFact({
      subjectId: 'profile',
      predicate: 'foreign_preference',
      objectText: 'zeta',
      scope: 'global',
      supersedePrior: false,
      now: 60,
    }).fact;
    for (const fact of [activeOne, activeTwo, invalid, expired, deleted, foreign]) {
      removeLocalSimilarity(fact.id);
    }
    invalidateManagedMemoryFact({ factId: invalid.id, now: 100 });
    getMemoryDb().runSync('UPDATE memory_facts SET deleted_at = ? WHERE id = ?', 100, deleted.id);
    getMemoryDb().runSync(
      'UPDATE memory_facts SET memory_owner_id = ? WHERE id = ?',
      'foreign-owner',
      foreign.id,
    );

    expect(getLocalSimilarityDiagnostics(1_000)).toEqual({
      model: LOCAL_SIMILARITY_MODEL,
      dimensions: LOCAL_SIMILARITY_DIMENSIONS,
      currentFactCount: 2,
      currentVectorCount: 0,
      pendingVectorCount: 2,
    });
    const beforeBackfill = captureMemoryAuthoritySnapshot();
    if (!beforeBackfill) throw new Error('expected memory authority');
    expect(backfillCurrentFactLocalSimilarity({ limit: 1, now: 1_000 })).toEqual({
      processedCount: 1,
      hasMore: true,
      model: LOCAL_SIMILARITY_MODEL,
      dimensions: LOCAL_SIMILARITY_DIMENSIONS,
    });
    expect(backfillCurrentFactLocalSimilarity({ limit: 1, now: 1_001 })).toEqual({
      processedCount: 1,
      hasMore: false,
      model: LOCAL_SIMILARITY_MODEL,
      dimensions: LOCAL_SIMILARITY_DIMENSIONS,
    });
    expect(getLocalSimilarityDiagnostics(1_002)).toMatchObject({
      currentFactCount: 2,
      currentVectorCount: 2,
      pendingVectorCount: 0,
    });
    expect(isMemoryProjectionSnapshotDurablyCurrent(beforeBackfill)).toBe(false);
    expect(isRestrictiveMemoryAuthoritySnapshotDurablyCurrent(beforeBackfill)).toBe(true);

    const rows = getMemoryDb().getAllSync<{
      id: string;
      updated_at: number;
      local_similarity_model: string | null;
      local_similarity_updated_at: number | null;
    }>(
      `SELECT id, updated_at, local_similarity_model, local_similarity_updated_at
         FROM memory_facts
        ORDER BY created_at ASC`,
    );
    expect(rows[0]).toMatchObject({
      id: activeOne.id,
      updated_at: 10,
      local_similarity_model: LOCAL_SIMILARITY_MODEL,
      local_similarity_updated_at: 1_000,
    });
    expect(rows[1]).toMatchObject({
      id: activeTwo.id,
      updated_at: 20,
      local_similarity_model: LOCAL_SIMILARITY_MODEL,
      local_similarity_updated_at: 1_001,
    });
    expect(rows.slice(2).every((row) => row.local_similarity_model === null)).toBe(true);
  });

  it('detects and replaces malformed current-identity payloads', () => {
    const fact = recordFact({
      subjectId: 'profile',
      predicate: 'preferred_editor',
      objectText: 'Neovim',
      scope: 'global',
      now: 10,
    }).fact;
    getMemoryDb().runSync(
      `UPDATE memory_facts
          SET local_similarity_vector = ?, local_similarity_updated_at = ?
        WHERE id = ?`,
      '["not-a-number"]',
      11,
      fact.id,
    );

    expect(getLocalSimilarityDiagnostics(20)).toMatchObject({
      currentFactCount: 1,
      currentVectorCount: 0,
      pendingVectorCount: 1,
    });
    expect(backfillCurrentFactLocalSimilarity({ now: 20 })).toMatchObject({
      processedCount: 1,
      hasMore: false,
    });
    expect(getLocalSimilarityDiagnostics(21)).toMatchObject({
      currentVectorCount: 1,
      pendingVectorCount: 0,
    });

    getMemoryDb().runSync(
      `UPDATE memory_facts
          SET local_similarity_vector = ?, local_similarity_updated_at = ?
        WHERE id = ?`,
      JSON.stringify(
        Array.from({ length: LOCAL_SIMILARITY_DIMENSIONS }, (_, index) => (index === 0 ? 2 : 0)),
      ),
      22,
      fact.id,
    );

    expect(getLocalSimilarityDiagnostics(23)).toMatchObject({
      currentVectorCount: 0,
      pendingVectorCount: 1,
    });
    expect(backfillCurrentFactLocalSimilarity({ now: 23 })).toMatchObject({
      processedCount: 1,
      hasMore: false,
    });

    getMemoryDb().runSync(
      `UPDATE memory_facts
          SET local_similarity_model = NULL, local_similarity_updated_at = ?
        WHERE id = ?`,
      24,
      fact.id,
    );

    expect(getLocalSimilarityDiagnostics(25)).toMatchObject({
      currentVectorCount: 0,
      pendingVectorCount: 1,
    });
    expect(backfillCurrentFactLocalSimilarity({ now: 25 })).toMatchObject({
      processedCount: 1,
      hasMore: false,
    });
  });

  it('rejects invalid batch boundaries instead of silently expanding work', () => {
    for (const limit of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => backfillCurrentFactLocalSimilarity({ limit })).toThrow(
        'memory_local_similarity_backfill_limit_invalid',
      );
    }
  });

  it('fails maintenance closed without taking down lexical retrieval callers', () => {
    getMemoryDb().execSync('DROP TABLE memory_facts');

    expect(maintainCurrentFactLocalSimilarity({ now: 20 })).toBeNull();
  });

  it('skips completed maintenance until the durable projection changes', () => {
    recordFact({
      subjectId: 'profile',
      predicate: 'preferred_editor',
      objectText: 'Neovim',
      scope: 'global',
      now: 10,
    });
    const database = getMemoryDb();
    const getAllSpy = jest.spyOn(database, 'getAllSync');
    const maintenanceScanCount = () =>
      getAllSpy.mock.calls.filter(([sql]) =>
        String(sql).includes('AND NOT (\n  local_similarity_model IS ?'),
      ).length;

    expect(maintainCurrentFactLocalSimilarity({ now: 20 })).toMatchObject({
      processedCount: 0,
      hasMore: false,
    });
    const completedScanCount = maintenanceScanCount();
    expect(completedScanCount).toBeGreaterThan(0);

    expect(maintainCurrentFactLocalSimilarity({ now: 21 })).toMatchObject({
      processedCount: 0,
      hasMore: false,
    });
    expect(maintenanceScanCount()).toBe(completedScanCount);

    recordFact({
      subjectId: 'profile',
      predicate: 'preferred_terminal',
      objectText: 'iTerm',
      scope: 'global',
      supersedePrior: false,
      now: 22,
    });
    expect(maintainCurrentFactLocalSimilarity({ now: 23 })).toMatchObject({
      processedCount: 0,
      hasMore: false,
    });
    expect(maintenanceScanCount()).toBeGreaterThan(completedScanCount);
  });

  it('keeps full bounded batches within the recorded local maintenance budget', () => {
    for (let index = 0; index < 160; index += 1) {
      recordFact({
        subjectId: 'performance-profile',
        predicate: `preference_${index}`,
        objectText: `bounded local similarity value ${index}`,
        scope: 'global',
        supersedePrior: false,
        now: 100 + index,
      });
    }
    getMemoryDb().runSync(
      `UPDATE memory_facts
          SET local_similarity_model = NULL,
              local_similarity_dimensions = NULL,
              local_similarity_vector = NULL,
              local_similarity_updated_at = NULL`,
    );
    const durations: number[] = [];
    for (let index = 0; index < 10; index += 1) {
      const startedAt = performance.now();
      const result = backfillCurrentFactLocalSimilarity({ limit: 16, now: 1_000 + index });
      durations.push(performance.now() - startedAt);
      expect(result.processedCount).toBe(16);
      expect(result.hasMore).toBe(index < 9);
    }

    expect(p95(durations)).toBeLessThanOrEqual(LOCAL_SIMILARITY_BACKFILL_P95_BUDGET_MS);
  });
});
