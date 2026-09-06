jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

jest.mock('../../../src/services/memory/embeddingProviderSelection', () => ({
  resolveEmbeddingProviderPath: jest.fn(),
}));

jest.mock('../../../src/services/memory/embeddings', () => ({
  getEmbedding: jest.fn(),
}));

import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { ensureFactSchema, resetFactSchemaCacheForTests } from '../../../src/services/memory/schema';
import { recordFact } from '../../../src/services/memory/facts/mutations';
import { resolveEmbeddingProviderPath } from '../../../src/services/memory/embeddingProviderSelection';
import { getEmbedding } from '../../../src/services/memory/embeddings';
import { resetProviderEmbeddingRateLimiterForTests } from '../../../src/services/memory/providerEmbeddingRateLimiter';
import { maintainProviderFactEmbeddings } from '../../../src/services/memory/providerEmbeddingBackfill';
import { PROVIDER_EMBEDDING_MINIMUM_DIMENSIONS } from '../../../src/services/memory/providerSimilarity';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

const resolveEmbeddingProviderPathMock = resolveEmbeddingProviderPath as jest.MockedFunction<
  typeof resolveEmbeddingProviderPath
>;
const getEmbeddingMock = getEmbedding as jest.MockedFunction<typeof getEmbedding>;

const DIMENSIONS = PROVIDER_EMBEDDING_MINIMUM_DIMENSIONS;

const OPENAI_PATH = {
  providerId: 'openai-provider',
  providerFamily: 'openai' as const,
  config: { provider: 'openai' as const, model: 'text-embedding-3-small', dimensions: DIMENSIONS },
};

/** A well-formed (>= minimum dimensions), deterministic-per-input vector. */
function deterministicVector(text: string): number[] {
  const seed = text.length % 10;
  return [seed / 10, ...Array(DIMENSIONS - 1).fill(0.1)];
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  resetProviderEmbeddingRateLimiterForTests();
  jest.clearAllMocks();
  resolveEmbeddingProviderPathMock.mockResolvedValue(OPENAI_PATH);
  getEmbeddingMock.mockImplementation(async (text: string) => ({
    embedding: deterministicVector(text),
    model: 'text-embedding-3-small',
  }));
});

afterEach(() => {
  closeMemoryDb();
});

function providerColumns(factId: string): {
  provider_embedding_model: string | null;
  provider_embedding_dimensions: number | null;
  provider_embedding_vector: string | null;
} {
  return getMemoryDb().getFirstSync<{
    provider_embedding_model: string | null;
    provider_embedding_dimensions: number | null;
    provider_embedding_vector: string | null;
  }>(
    `SELECT provider_embedding_model, provider_embedding_dimensions, provider_embedding_vector
       FROM memory_facts WHERE id = ?`,
    factId,
  )!;
}

describe('maintainProviderFactEmbeddings', () => {
  it('returns null and calls no provider when embeddings are not resolved', async () => {
    resolveEmbeddingProviderPathMock.mockResolvedValue(null);
    recordFact({
      subjectId: 'profile',
      predicate: 'first_preference',
      objectText: 'alpha',
      scope: 'global',
      now: 10,
    });

    expect(await maintainProviderFactEmbeddings({ now: 20 })).toBeNull();
    expect(getEmbeddingMock).not.toHaveBeenCalled();
  });

  it('embeds pending facts in bounded batches and resumes across passes', async () => {
    const facts = [
      recordFact({
        subjectId: 'profile',
        predicate: 'first_preference',
        objectText: 'alpha',
        scope: 'global',
        now: 10,
      }).fact,
      recordFact({
        subjectId: 'profile',
        predicate: 'second_preference',
        objectText: 'beta',
        scope: 'global',
        supersedePrior: false,
        now: 20,
      }).fact,
      recordFact({
        subjectId: 'profile',
        predicate: 'third_preference',
        objectText: 'gamma',
        scope: 'global',
        supersedePrior: false,
        now: 30,
      }).fact,
    ];

    const firstPass = await maintainProviderFactEmbeddings({ limit: 2, now: 100 });
    expect(firstPass).toMatchObject({
      attempted: 2,
      processedCount: 2,
      failedCount: 0,
      hasMore: true,
      model: 'text-embedding-3-small',
      dimensions: DIMENSIONS,
    });

    const secondPass = await maintainProviderFactEmbeddings({ limit: 2, now: 200 });
    expect(secondPass).toMatchObject({
      attempted: 1,
      processedCount: 1,
      failedCount: 0,
      hasMore: false,
    });

    for (const fact of facts) {
      const row = providerColumns(fact.id);
      expect(row.provider_embedding_model).toBe('text-embedding-3-small');
      expect(row.provider_embedding_dimensions).toBe(DIMENSIONS);
      expect(row.provider_embedding_vector).not.toBeNull();
    }

    // Idempotent: a further pass finds nothing left to embed.
    const thirdPass = await maintainProviderFactEmbeddings({ limit: 2, now: 300 });
    expect(thirdPass).toMatchObject({ attempted: 0, processedCount: 0, hasMore: false });
    expect(getEmbeddingMock).toHaveBeenCalledTimes(3);
  });

  it('re-embeds a fact whose stored vector came from a since-changed model', async () => {
    const fact = recordFact({
      subjectId: 'profile',
      predicate: 'first_preference',
      objectText: 'alpha',
      scope: 'global',
      now: 10,
    }).fact;
    getMemoryDb().runSync(
      `UPDATE memory_facts
          SET provider_embedding_model = ?, provider_embedding_dimensions = ?,
              provider_embedding_vector = ?, provider_embedding_updated_at = ?
        WHERE id = ?`,
      'stale-embedding-model',
      8,
      '[0,0,0,0,0,0,0,0]',
      5,
      fact.id,
    );

    const result = await maintainProviderFactEmbeddings({ now: 50 });
    expect(result).toMatchObject({ processedCount: 1, failedCount: 0, hasMore: false });
    const row = providerColumns(fact.id);
    expect(row.provider_embedding_model).toBe('text-embedding-3-small');
    expect(row.provider_embedding_dimensions).toBe(DIMENSIONS);
  });

  it('isolates a per-fact provider failure instead of failing the whole batch', async () => {
    const failing = recordFact({
      subjectId: 'profile',
      predicate: 'failing_preference',
      objectText: 'alpha-fails',
      scope: 'global',
      now: 10,
    }).fact;
    const succeeding = recordFact({
      subjectId: 'profile',
      predicate: 'succeeding_preference',
      objectText: 'beta-ok',
      scope: 'global',
      supersedePrior: false,
      now: 20,
    }).fact;
    getEmbeddingMock.mockImplementation(async (text: string) => {
      if (text.includes('alpha-fails')) throw new Error('provider_rate_limited');
      return { embedding: deterministicVector(text), model: 'text-embedding-3-small' };
    });

    const result = await maintainProviderFactEmbeddings({ now: 100 });
    expect(result).toMatchObject({ attempted: 2, processedCount: 1, failedCount: 1, hasMore: false });
    expect(providerColumns(failing.id).provider_embedding_vector).toBeNull();
    expect(providerColumns(succeeding.id).provider_embedding_vector).not.toBeNull();
  });

  it('discards a malformed provider result instead of persisting it', async () => {
    const fact = recordFact({
      subjectId: 'profile',
      predicate: 'malformed_preference',
      objectText: 'alpha',
      scope: 'global',
      now: 10,
    }).fact;
    getEmbeddingMock.mockResolvedValue({ embedding: [0.1, 0.2], model: 'text-embedding-3-small' });

    const result = await maintainProviderFactEmbeddings({ now: 50 });
    expect(result).toMatchObject({ processedCount: 0, failedCount: 1 });
    expect(providerColumns(fact.id).provider_embedding_vector).toBeNull();
  });

  it('returns null instead of throwing on an invalid limit', async () => {
    for (const limit of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(maintainProviderFactEmbeddings({ limit, now: 10 })).resolves.toBeNull();
    }
    expect(getEmbeddingMock).not.toHaveBeenCalled();
  });

  it('returns null instead of throwing on an invalid clock value', async () => {
    await expect(
      maintainProviderFactEmbeddings({ now: Number.NEGATIVE_INFINITY }),
    ).resolves.toBeNull();
  });

  it('fails maintenance closed without throwing when the schema is unavailable', async () => {
    getMemoryDb().execSync('DROP TABLE memory_facts');
    await expect(maintainProviderFactEmbeddings({ now: 10 })).resolves.toBeNull();
  });

  it('paces successive provider calls at least the configured minimum interval apart', async () => {
    recordFact({
      subjectId: 'profile',
      predicate: 'first_preference',
      objectText: 'alpha',
      scope: 'global',
      now: 10,
    });
    recordFact({
      subjectId: 'profile',
      predicate: 'second_preference',
      objectText: 'beta',
      scope: 'global',
      supersedePrior: false,
      now: 20,
    });
    const callTimestamps: number[] = [];
    getEmbeddingMock.mockImplementation(async (text: string) => {
      callTimestamps.push(Date.now());
      return { embedding: deterministicVector(text), model: 'text-embedding-3-small' };
    });

    await maintainProviderFactEmbeddings({ now: 100 });

    expect(callTimestamps).toHaveLength(2);
    expect(callTimestamps[1] - callTimestamps[0]).toBeGreaterThanOrEqual(119);
  }, 10_000);
});
