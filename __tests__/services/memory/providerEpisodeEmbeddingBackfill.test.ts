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
import { recordThreadLocalEpisode } from '../../../src/services/memory/episodes/mutations';
import { codeOwnedClosedTurnEpisodeFields } from '../../helpers/memoryRetirementTestFixtures';
import { resolveEmbeddingProviderPath } from '../../../src/services/memory/embeddingProviderSelection';
import { getEmbedding } from '../../../src/services/memory/embeddings';
import { resetProviderEmbeddingRateLimiterForTests } from '../../../src/services/memory/providerEmbeddingRateLimiter';
import { maintainProviderEpisodeEmbeddings } from '../../../src/services/memory/providerEpisodeEmbeddingBackfill';
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

function makeEpisode(id: string, summary: string, now: number) {
  return recordThreadLocalEpisode({
    conversationId: 'conv-root',
    threadId: 'thread-1',
    summary,
    ...codeOwnedClosedTurnEpisodeFields({
      sourceUserMessageId: `${id}-user`,
      sourceAssistantMessageId: `${id}-assistant`,
      userContent: summary,
      assistantContent: 'Acknowledged.',
    }),
    now,
  });
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

function providerColumns(episodeId: string): {
  embedding_model: string | null;
  embedding_dimensions: number | null;
  embedding: string | null;
} {
  return getMemoryDb().getFirstSync<{
    embedding_model: string | null;
    embedding_dimensions: number | null;
    embedding: string | null;
  }>(
    `SELECT embedding_model, embedding_dimensions, embedding FROM memory_episodes WHERE id = ?`,
    episodeId,
  )!;
}

describe('maintainProviderEpisodeEmbeddings', () => {
  it('returns null and calls no provider when embeddings are not resolved', async () => {
    resolveEmbeddingProviderPathMock.mockResolvedValue(null);
    const episode = makeEpisode('ep-1', 'User prefers concise answers.', 10);
    expect(episode).not.toBeNull();

    expect(await maintainProviderEpisodeEmbeddings({ now: 20 })).toBeNull();
    expect(getEmbeddingMock).not.toHaveBeenCalled();
  });

  it('embeds pending episodes in bounded batches and resumes across passes', async () => {
    const episodes = [
      makeEpisode('ep-1', 'User prefers concise answers.', 10),
      makeEpisode('ep-2', 'User asked about the release plan.', 20),
      makeEpisode('ep-3', 'User confirmed the deploy window.', 30),
    ];
    expect(episodes.every(Boolean)).toBe(true);

    const firstPass = await maintainProviderEpisodeEmbeddings({ limit: 2, now: 100 });
    expect(firstPass).toMatchObject({
      attempted: 2,
      processedCount: 2,
      failedCount: 0,
      hasMore: true,
      model: 'text-embedding-3-small',
      dimensions: DIMENSIONS,
    });

    const secondPass = await maintainProviderEpisodeEmbeddings({ limit: 2, now: 200 });
    expect(secondPass).toMatchObject({ attempted: 1, processedCount: 1, hasMore: false });

    for (const episode of episodes) {
      const row = providerColumns(episode!.id);
      expect(row.embedding_model).toBe('text-embedding-3-small');
      expect(row.embedding_dimensions).toBe(DIMENSIONS);
      expect(row.embedding).not.toBeNull();
    }

    const thirdPass = await maintainProviderEpisodeEmbeddings({ limit: 2, now: 300 });
    expect(thirdPass).toMatchObject({ attempted: 0, processedCount: 0, hasMore: false });
  });

  it('re-embeds an episode whose stored vector came from a since-changed model', async () => {
    const episode = makeEpisode('ep-stale', 'User changed their timezone.', 10);
    getMemoryDb().runSync(
      `UPDATE memory_episodes
          SET embedding = ?, embedding_model = ?, embedding_dimensions = ?, embedding_updated_at = ?
        WHERE id = ?`,
      '[0,0,0,0,0,0,0,0]',
      'stale-embedding-model',
      8,
      5,
      episode!.id,
    );

    const result = await maintainProviderEpisodeEmbeddings({ now: 50 });
    expect(result).toMatchObject({ processedCount: 1, failedCount: 0, hasMore: false });
    const row = providerColumns(episode!.id);
    expect(row.embedding_model).toBe('text-embedding-3-small');
    expect(row.embedding_dimensions).toBe(DIMENSIONS);
  });

  it('isolates a per-episode provider failure instead of failing the whole batch', async () => {
    const failing = makeEpisode('ep-fail', 'This episode summary always fails.', 10);
    const succeeding = makeEpisode('ep-ok', 'This episode summary always succeeds.', 20);
    getEmbeddingMock.mockImplementation(async (text: string) => {
      if (text.includes('always fails')) throw new Error('provider_rate_limited');
      return { embedding: deterministicVector(text), model: 'text-embedding-3-small' };
    });

    const result = await maintainProviderEpisodeEmbeddings({ now: 100 });
    expect(result).toMatchObject({ attempted: 2, processedCount: 1, failedCount: 1, hasMore: false });
    expect(providerColumns(failing!.id).embedding).toBeNull();
    expect(providerColumns(succeeding!.id).embedding).not.toBeNull();
  });

  it('discards a malformed provider result instead of persisting it', async () => {
    const episode = makeEpisode('ep-malformed', 'Malformed vector episode.', 10);
    getEmbeddingMock.mockResolvedValue({ embedding: [0.1, 0.2], model: 'text-embedding-3-small' });

    const result = await maintainProviderEpisodeEmbeddings({ now: 50 });
    expect(result).toMatchObject({ processedCount: 0, failedCount: 1 });
    expect(providerColumns(episode!.id).embedding).toBeNull();
  });

  it('returns null instead of throwing on an invalid limit', async () => {
    for (const limit of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(maintainProviderEpisodeEmbeddings({ limit, now: 10 })).resolves.toBeNull();
    }
    expect(getEmbeddingMock).not.toHaveBeenCalled();
  });

  it('returns null instead of throwing on an invalid clock value', async () => {
    await expect(
      maintainProviderEpisodeEmbeddings({ now: Number.NEGATIVE_INFINITY }),
    ).resolves.toBeNull();
  });

  it('fails maintenance closed without throwing when the schema is unavailable', async () => {
    getMemoryDb().execSync('DROP TABLE memory_episodes');
    await expect(maintainProviderEpisodeEmbeddings({ now: 10 })).resolves.toBeNull();
  });

  it('never embeds a structural-turn episode (its summary is JSON, not prose)', async () => {
    const structural = recordThreadLocalEpisode({
      conversationId: 'conv-root',
      threadId: 'thread-1',
      summary: JSON.stringify({
        kind: 'structural_turn',
        version: 1,
        messageCount: 2,
        toolCallCount: 0,
        completedToolCallCount: 0,
        hasCodeBlock: false,
        hasAttachments: false,
      }),
      summaryKind: 'structural_turn',
      ...codeOwnedClosedTurnEpisodeFields({
        sourceUserMessageId: 'structural-user',
        sourceAssistantMessageId: 'structural-assistant',
        userContent: 'structural',
        assistantContent: 'Acknowledged.',
      }),
      now: 10,
    });
    expect(structural).not.toBeNull();
    const narrative = makeEpisode('ep-narrative', 'User asked about the release plan.', 20);
    expect(narrative).not.toBeNull();

    const result = await maintainProviderEpisodeEmbeddings({ now: 100 });
    expect(result).toMatchObject({ attempted: 1, processedCount: 1, hasMore: false });
    expect(getEmbeddingMock).toHaveBeenCalledTimes(1);
    expect(providerColumns(structural!.id)).toMatchObject({
      embedding_model: null,
      embedding_dimensions: null,
      embedding: null,
    });
    expect(providerColumns(narrative!.id).embedding).not.toBeNull();

    // A later pass never revisits the structural episode either.
    const secondPass = await maintainProviderEpisodeEmbeddings({ now: 200 });
    expect(secondPass).toMatchObject({ attempted: 0, processedCount: 0, hasMore: false });
  });

  it('never embeds an episode that has not ended yet', async () => {
    const episode = makeEpisode('ep-future', 'Not yet ended.', 500);
    expect(episode).not.toBeNull();

    const result = await maintainProviderEpisodeEmbeddings({ now: 10 });
    expect(result).toMatchObject({ attempted: 0, processedCount: 0, hasMore: false });
    expect(providerColumns(episode!.id).embedding).toBeNull();
  });
});
