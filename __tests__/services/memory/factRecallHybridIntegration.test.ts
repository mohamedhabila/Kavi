jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { upsertEntity } from '../../../src/services/memory/entities';
import {
  invalidateFact,
  setFactLocalSimilarity,
} from '../../../src/services/memory/facts/mutations';
import { createCurrentLocalSimilarityVector } from '../../../src/services/memory/localSimilarity';
import type { RecallFactsTiming } from '../../../src/services/memory/factRecall';
import {
  recallScoredTestFacts as recallScoredFactsForQuery,
  recordRecallTestFact as recordFact,
} from '../../helpers/memoryRecallTestHarness';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/sqlite-store';

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

describe('hybrid fact recall integration', () => {
  it('recovers entity-alias evidence beyond the bounded lexical prefix', async () => {
    const project = upsertEntity({
      name: 'Project Aurora',
      type: 'project',
      aliases: ['Northern Lights'],
    });
    const other = upsertEntity({ name: 'Other Project', type: 'project' });
    const target = recordFact({
      subjectId: project.id,
      predicate: 'deployment_status',
      objectText: 'green',
      now: 1,
    });
    const lexicalPrefix = recordFact({
      subjectId: other.id,
      predicate: 'deployment_status',
      objectText: 'amber',
      now: 2,
    });
    let timing: RecallFactsTiming | undefined;

    const lexical = await recallScoredFactsForQuery('Northern Lights deployment status', {
      candidateStrategy: 'lexical',
      candidatePoolLimit: 1,
      limit: 1,
      now: 3,
    });
    const hybrid = await recallScoredFactsForQuery('Northern Lights deployment status', {
      candidateStrategy: 'hybrid',
      candidatePoolLimit: 1,
      limit: 1,
      now: 3,
      onTiming: (value) => {
        timing = value;
      },
    });

    expect(lexical.map((entry) => entry.fact.id)).toEqual([lexicalPrefix.fact.id]);
    expect(hybrid.map((entry) => entry.fact.id)).toEqual([target.fact.id]);
    expect(hybrid[0].candidateProvenance.reasons).toEqual(
      expect.arrayContaining(['entity', 'temporal']),
    );
    expect(hybrid[0].candidateRelevanceScore).toBe(0);
    expect(hybrid[0].textScore).toBeGreaterThan(0);
    expect(timing?.candidateStages).toMatchObject({
      strategy: 'hybrid',
      eligibleScanCount: 2,
      entityCount: 1,
    });
  });

  it('uses an explicit year as a temporal relevance signal', async () => {
    const project = upsertEntity({ name: 'Timeline Project', type: 'project' });
    const in2021 = Date.UTC(2021, 0, 15);
    const target = recordFact({
      subjectId: project.id,
      predicate: 'milestone_code',
      objectText: 'blue-phase',
      now: in2021,
    });

    const lexical = await recallScoredFactsForQuery('What happened in 2021?', {
      candidateStrategy: 'lexical',
      now: Date.UTC(2021, 6, 1),
    });
    const hybrid = await recallScoredFactsForQuery('What happened in 2021?', {
      candidateStrategy: 'hybrid',
      now: Date.UTC(2021, 6, 1),
    });

    expect(lexical).toHaveLength(0);
    expect(hybrid.map((entry) => entry.fact.id)).toEqual([target.fact.id]);
    expect(hybrid[0].candidateRelevanceScore).toBeGreaterThan(0);
    expect(hybrid[0].candidateProvenance.reasons).toContain('temporal');
  });

  it('consumes only caller-supplied compatible local semantic vectors', async () => {
    const project = upsertEntity({ name: 'Semantic Project', type: 'project' });
    const target = recordFact({
      subjectId: project.id,
      predicate: 'opaque_signal',
      objectText: 'violet-cipher',
      now: 1_000,
    });
    recordFact({
      subjectId: project.id,
      predicate: 'other_signal',
      objectText: 'orange-cipher',
      supersedePrior: false,
      now: 1_001,
    });
    const queryVector = target.fact.localSimilarity!;
    let timing: RecallFactsTiming | undefined;

    const lexical = await recallScoredFactsForQuery('conceptually related memory', {
      candidateStrategy: 'lexical',
      now: 1_003,
    });
    const hybrid = await recallScoredFactsForQuery('conceptually related memory', {
      candidateStrategy: 'hybrid',
      localSemantic: { queryVector, minimumSimilarity: 0.99 },
      now: 1_003,
      onTiming: (value) => {
        timing = value;
      },
    });

    expect(lexical).toHaveLength(0);
    expect(hybrid.map((entry) => entry.fact.id)).toEqual([target.fact.id]);
    expect(hybrid[0].candidateProvenance.reasons).toEqual(
      expect.arrayContaining(['local_semantic']),
    );
    expect(hybrid[0].candidateProvenance.semanticSimilarity).toBeCloseTo(1);
    expect(timing?.candidateStages).toMatchObject({
      localSemanticOutcome: 'applied',
      localSemanticCount: 1,
    });
  });

  it('keeps lexical selection identical when compatible embeddings are unavailable', async () => {
    const profile = upsertEntity({ name: 'Recall Profile', type: 'concept' });
    const target = recordFact({
      subjectId: profile.id,
      predicate: 'color_preference',
      objectText: 'ocean teal',
      now: 100,
    });
    getMemoryDb().runSync(
      `UPDATE memory_facts
          SET local_similarity_model = NULL,
              local_similarity_dimensions = NULL,
              local_similarity_vector = NULL
        WHERE id = ?`,
      target.fact.id,
    );
    let timing: RecallFactsTiming | undefined;

    const lexical = await recallScoredFactsForQuery('ocean teal preference', {
      candidateStrategy: 'lexical',
      now: 101,
    });
    const hybrid = await recallScoredFactsForQuery('ocean teal preference', {
      candidateStrategy: 'hybrid',
      localSemantic: { queryVector: createCurrentLocalSimilarityVector('ocean teal preference') },
      now: 101,
      onTiming: (value) => {
        timing = value;
      },
    });

    expect(lexical.map((entry) => entry.fact.id)).toEqual([target.fact.id]);
    expect(hybrid.map((entry) => entry.fact.id)).toEqual(lexical.map((entry) => entry.fact.id));
    expect(hybrid.map((entry) => entry.score)).toEqual(lexical.map((entry) => entry.score));
    expect(timing?.candidateStages?.localSemanticOutcome).toBe('unavailable');
  });

  it('applies scope, validity, expiry, and deletion filters before semantic ranking', async () => {
    const subject = upsertEntity({ name: 'Filter Subject', type: 'concept' });
    const allowed = recordFact({
      subjectId: subject.id,
      predicate: 'allowed_signal',
      objectText: 'allowed-value',
      now: 1_000,
    });
    const expired = recordFact({
      subjectId: subject.id,
      predicate: 'expired_signal',
      objectText: 'expired-value',
      expiresAt: 1_500,
      supersedePrior: false,
      now: 1_000,
    });
    const invalidated = recordFact({
      subjectId: subject.id,
      predicate: 'invalid_signal',
      objectText: 'invalid-value',
      supersedePrior: false,
      now: 1_000,
    });
    const deleted = recordFact({
      subjectId: subject.id,
      predicate: 'deleted_signal',
      objectText: 'deleted-value',
      supersedePrior: false,
      now: 1_000,
    });
    const otherConversation = recordFact({
      subjectId: subject.id,
      predicate: 'private_signal',
      objectText: 'other-conversation-value',
      scope: 'conversation',
      originConversationId: 'other-conversation',
      supersedePrior: false,
      now: 1_000,
    });
    for (const fact of [allowed, expired, invalidated, deleted, otherConversation]) {
      setFactLocalSimilarity(fact.fact.id, allowed.fact.localSimilarity!, 1_100);
    }
    invalidateFact(invalidated.fact.id, 1_200);
    getMemoryDb().runSync(
      'UPDATE memory_facts SET deleted_at = ? WHERE id = ?',
      1_200,
      deleted.fact.id,
    );

    const hybrid = await recallScoredFactsForQuery(
      'unindexed conceptual query',
      {
        candidateStrategy: 'hybrid',
        localSemantic: { queryVector: allowed.fact.localSimilarity!, minimumSimilarity: 0.99 },
        asOf: 2_000,
        now: 2_000,
      },
      {
        memoryConversationId: 'active-conversation',
        sourceThreadId: 'active-conversation',
      },
    );

    expect(hybrid.map((entry) => entry.fact.id)).toEqual([allowed.fact.id]);
  });

  it('never turns generic temporal recency into relevance', async () => {
    const subject = upsertEntity({ name: 'Unrelated Subject', type: 'concept' });
    recordFact({
      subjectId: subject.id,
      predicate: 'opaque_value',
      objectText: 'not-query-evidence',
      now: 1_000,
    });
    let timing: RecallFactsTiming | undefined;

    const recalled = await recallScoredFactsForQuery('completely unrelated request', {
      candidateStrategy: 'hybrid',
      now: 1_001,
      onTiming: (value) => {
        timing = value;
      },
    });

    expect(recalled).toHaveLength(0);
    expect(timing?.candidateStages).toMatchObject({
      temporalCount: 1,
      unionCount: 1,
    });
  });

  it('normalizes every eligible-scan limit at the public recall boundary', async () => {
    const subject = upsertEntity({ name: 'Limit Subject', type: 'concept' });
    for (let index = 0; index < 501; index += 1) {
      recordFact({
        subjectId: subject.id,
        predicate: `bounded_${index}`,
        objectText: `opaque-${index}`,
        supersedePrior: false,
        now: 1_000 + index,
      });
    }

    const eligibleCount = async (eligibleScanLimit: number): Promise<number | undefined> => {
      let timing: RecallFactsTiming | undefined;
      await recallScoredFactsForQuery('no matching retrieval terms', {
        candidateStrategy: 'hybrid',
        eligibleScanLimit,
        now: 2_000,
        onTiming: (value) => {
          timing = value;
        },
      });
      return timing?.candidateStages?.eligibleScanCount;
    };

    await expect(eligibleCount(Number.NaN)).resolves.toBe(256);
    await expect(eligibleCount(Number.POSITIVE_INFINITY)).resolves.toBe(256);
    await expect(eligibleCount(Number.NEGATIVE_INFINITY)).resolves.toBe(256);
    await expect(eligibleCount(0)).resolves.toBe(1);
    await expect(eligibleCount(-12)).resolves.toBe(1);
    await expect(eligibleCount(2.9)).resolves.toBe(2);
    await expect(eligibleCount(10_000)).resolves.toBe(500);
  });
});
