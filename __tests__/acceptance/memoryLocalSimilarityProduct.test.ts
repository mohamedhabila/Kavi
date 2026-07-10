jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { upsertEntity } from '../../src/services/memory/entities';
import { recordFactWithApplicability } from '../../src/services/memory/facts/mutations';
import {
  createCurrentLocalSimilarityVector,
  LOCAL_SIMILARITY_MAXIMUM_INPUT_CHARS,
  LOCAL_SIMILARITY_MAXIMUM_SERIALIZED_CHARS,
  LOCAL_SIMILARITY_PRODUCT_RETRIEVAL_P95_BUDGET_MS,
  LOCAL_SIMILARITY_VECTOR_P95_BUDGET_MS,
  serializeCurrentLocalSimilarityVector,
} from '../../src/services/memory/localSimilarity';
import { buildUnifiedMemoryAccessContext } from '../../src/services/memory/memoryAccessGateway';
import {
  buildMemoryRetrievalScopeHash,
  readRecentMemoryRetrievalEvents,
} from '../../src/services/memory/retrievalLog';
import { ensureFactSchema, resetFactSchemaCacheForTests } from '../../src/services/memory/schema';
import { closeMemoryDb, getMemoryDb } from '../../src/services/memory/sqlite-store';
import type { Message } from '../../src/types/message';

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

function p95(values: ReadonlyArray<number>): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1]!;
}

function deterministicDenseText(): string {
  let state = 123_456_789;
  let text = '';
  while (text.length < LOCAL_SIMILARITY_MAXIMUM_INPUT_CHARS) {
    let word = '';
    for (let index = 0; index < 5; index += 1) {
      state = (Math.imul(1_664_525, state) + 1_013_904_223) >>> 0;
      word += String.fromCharCode(97 + (state % 26));
    }
    text += `${word} `;
  }
  return text.slice(0, LOCAL_SIMILARITY_MAXIMUM_INPUT_CHARS);
}

describe('production local-similarity retrieval', () => {
  it('beats lexical retrieval on a held-out spelling variation without network calls', async () => {
    const memoryConversationId = 'local-similarity-product';
    const entity = upsertEntity({ name: 'Similarity Profile', type: 'concept', now: 1 });
    const target = recordFactWithApplicability(
      {
        subjectId: entity.id,
        predicate: 'opaque_signal',
        objectText: 'violet-cipher',
        scope: 'conversation',
        originConversationId: memoryConversationId,
        now: 1_000,
      },
      { factClass: 'workflow', sourceAuthority: 'tool_observed' },
    ).fact;
    for (let index = 0; index < 300; index += 1) {
      recordFactWithApplicability(
        {
          subjectId: entity.id,
          predicate: `distractor_${index}`,
          objectText: `unrelated schedule ${index}`,
          scope: 'conversation',
          originConversationId: memoryConversationId,
          supersedePrior: false,
          now: 100 + index,
        },
        { factClass: 'workflow', sourceAuthority: 'tool_observed' },
      );
    }
    const query = 'opaqueness signalling violett ciphered';
    const messages: Message[] = [
      { id: 'user-query', role: 'user', content: query, timestamp: 2_000 } as Message,
    ];
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    try {
      await buildUnifiedMemoryAccessContext({
        messages,
        memoryConversationId,
        sourceThreadId: 'lexical-thread',
        personaId: 'default',
        taskId: null,
        mode: 'chat',
        retrievalStrategy: 'lexical_only',
        now: 2_000,
      });
      await buildUnifiedMemoryAccessContext({
        messages,
        memoryConversationId,
        sourceThreadId: 'hybrid-thread',
        personaId: 'default',
        taskId: null,
        mode: 'chat',
        retrievalStrategy: 'production',
        now: 2_001,
      });

      const lexicalHash = await buildMemoryRetrievalScopeHash('source_thread', 'lexical-thread');
      const hybridHash = await buildMemoryRetrievalScopeHash('source_thread', 'hybrid-thread');
      const lexicalEvent = readRecentMemoryRetrievalEvents({
        sourceThreadIdHash: lexicalHash!,
        limit: 1,
      })[0];
      const hybridEvent = readRecentMemoryRetrievalEvents({
        sourceThreadIdHash: hybridHash!,
        limit: 1,
      })[0];

      expect(lexicalEvent.counts.selectedFactIds).toEqual([]);
      expect(hybridEvent.counts.selectedFactIds).toEqual([target.id]);
      expect(hybridEvent.candidates).toMatchObject({
        strategy: 'hybrid',
        localSimilarityOutcome: 'applied',
        localSimilarityCount: expect.any(Number),
      });
      expect(hybridEvent.candidates.localSimilarityCount).toBeGreaterThan(0);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }

    for (let index = 0; index < 3; index += 1) {
      await buildUnifiedMemoryAccessContext({
        messages,
        memoryConversationId,
        sourceThreadId: `warm-${index}`,
        personaId: 'default',
        taskId: null,
        mode: 'chat',
        now: 2_100 + index,
      });
    }
    const durations: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      const startedAt = performance.now();
      await buildUnifiedMemoryAccessContext({
        messages,
        memoryConversationId,
        sourceThreadId: `measured-${index}`,
        personaId: 'default',
        taskId: null,
        mode: 'chat',
        now: 2_200 + index,
      });
      durations.push(performance.now() - startedAt);
    }
    expect(p95(durations)).toBeLessThanOrEqual(LOCAL_SIMILARITY_PRODUCT_RETRIEVAL_P95_BUDGET_MS);

    const storage = getMemoryDb().getFirstSync<{
      vector_count: number;
      maximum_chars: number;
      total_chars: number;
    }>(
      `SELECT COUNT(*) AS vector_count,
              MAX(LENGTH(local_similarity_vector)) AS maximum_chars,
              SUM(LENGTH(local_similarity_vector)) AS total_chars
         FROM memory_facts
        WHERE local_similarity_vector IS NOT NULL`,
    )!;
    expect(storage.vector_count).toBe(301);
    expect(storage.maximum_chars).toBeLessThanOrEqual(LOCAL_SIMILARITY_MAXIMUM_SERIALIZED_CHARS);
    expect(storage.total_chars).toBeLessThanOrEqual(
      storage.vector_count * LOCAL_SIMILARITY_MAXIMUM_SERIALIZED_CHARS,
    );
  });

  it('keeps bounded vector creation within its p95 and storage budgets', () => {
    const input = deterministicDenseText();
    for (let index = 0; index < 5; index += 1) createCurrentLocalSimilarityVector(input);
    const durations: number[] = [];
    for (let index = 0; index < 60; index += 1) {
      const startedAt = performance.now();
      createCurrentLocalSimilarityVector(input);
      durations.push(performance.now() - startedAt);
    }
    const vector = createCurrentLocalSimilarityVector(input);
    const serialized = serializeCurrentLocalSimilarityVector(vector);

    expect(p95(durations)).toBeLessThanOrEqual(LOCAL_SIMILARITY_VECTOR_P95_BUDGET_MS);
    expect(serialized.length).toBeLessThanOrEqual(LOCAL_SIMILARITY_MAXIMUM_SERIALIZED_CHARS);
    expect(createCurrentLocalSimilarityVector(`${input}ignored tail`)).toEqual(vector);
  });
});
