jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { upsertEntity } from '../../../src/services/memory/entities';
import {
  recordThreadLocalEpisode,
  addFactEvidence,
} from '../../../src/services/memory/episodes/mutations';
import {
  clearEmbeddingCache,
  DEFAULT_LOCAL_EMBEDDING_CONFIG,
  getEmbeddingCached,
} from '../../../src/services/memory/embeddings';
import {
  editPromptEligibleWorkingBlock,
  getWorkingBlock,
} from '../../../src/services/memory/workingBlocks';
import { forgetMemoryFactForManagement } from '../../../src/services/memory/memoryTools';
import { withdrawMemoryFact } from '../../../src/services/memory/withdrawal';
import { EMPTY_MEMORY_WITHDRAWAL_COUNTS } from '../../../src/services/memory/withdrawalTypes';
import { probeMemoryWithdrawalResiduals } from '../../../src/services/memory/withdrawalResidualProbe';
import {
  loadVerifiedFactRetirement,
  recordContributionBackedFact,
  retirementLedgerCounts,
} from '../../helpers/memoryRetirementTestFixtures';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

function recordScopedFact(value: string, sourceMessageId = 'message-old') {
  const entity = upsertEntity({ name: 'withdrawal-user', type: 'self', now: 100 });
  return recordContributionBackedFact(
    {
      subjectId: entity.id,
      predicate: 'private_value',
      objectText: value,
      scope: 'session',
      originConversationId: 'conversation-1',
      originThreadId: 'thread-1',
      originTaskId: 'task-1',
      sourceMessageId,
      sourceTurnId: 'turn-old',
      sourceRunId: 'run-old',
      supersedePrior: false,
      now: 200,
    },
    {
      memoryConversationId: 'conversation-1',
      sourceThreadId: 'thread-1',
      taskId: 'task-1',
      producerEventId: `withdrawal-guard-${sourceMessageId}`,
    },
  ).fact;
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  clearEmbeddingCache();
});

afterEach(() => {
  clearEmbeddingCache();
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
});

describe('memory withdrawal guards', () => {
  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid timestamp %s before any write',
    (now) => {
      const fact = recordScopedFact('timestamp guard');

      expect(() => withdrawMemoryFact(fact.id, now)).toThrow('withdrawal_timestamp_invalid');
      expect(
        getMemoryDb().getFirstSync<{ count: number }>(
          'SELECT COUNT(*) AS count FROM memory_facts WHERE id = ?',
          fact.id,
        )?.count,
      ).toBe(1);
      expect(retirementLedgerCounts()).toEqual({
        groups: 0,
        requests: 0,
        sources: 0,
        contributions: 0,
        facts: 0,
      });
    },
  );

  it('is idempotent and does not clear caches on an already-withdrawn replay', async () => {
    const fact = recordScopedFact('private cache value');
    await getEmbeddingCached('cache before first withdrawal', DEFAULT_LOCAL_EMBEDDING_CONFIG);

    const first = withdrawMemoryFact(fact.id, 1_000);
    expect(first.status).toBe('withdrawn');
    if (first.status !== 'withdrawn') throw new Error('expected withdrawal');
    expect(first.receipt.counts.embeddingCacheEntries).toBe(0);
    expect(clearEmbeddingCache()).toBe(0);

    await getEmbeddingCached('cache after first withdrawal', DEFAULT_LOCAL_EMBEDDING_CONFIG);
    const replay = withdrawMemoryFact(fact.id, 2_000);

    expect(replay.status).toBe('already_withdrawn');
    if (replay.status !== 'already_withdrawn') throw new Error('expected replay');
    expect(replay.receipt.counts).toEqual(EMPTY_MEMORY_WITHDRAWAL_COUNTS);
    expect(replay.receipt.withdrawalId).toBe(first.receipt.withdrawalId);
    expect(replay.receipt.withdrawnAt).toBe(first.receipt.withdrawnAt);
    expect(clearEmbeddingCache()).toBe(1);
    expect(retirementLedgerCounts()).toEqual({
      groups: 1,
      requests: 3,
      sources: 3,
      contributions: 1,
      facts: 1,
    });
    expect(loadVerifiedFactRetirement(fact.id)).toMatchObject({
      retirementGroupId: first.receipt.withdrawalId,
      reason: 'fact_withdrawal',
      retiredFactIds: [fact.id],
    });
  });

  it('rolls every database surface back and returns only a generic tool error', async () => {
    const privateValue = 'PRIVATE-ROLLBACK-SENTINEL';
    const fact = recordScopedFact(privateValue);
    const episode = recordThreadLocalEpisode({
      conversationId: 'conversation-1',
      threadId: 'thread-1',
      taskId: 'task-1',
      summary: privateValue,
      messageIds: ['message-old'],
      sourceStartMessageId: 'message-old',
      sourceEndMessageId: 'turn-old',
      now: 300,
    });
    if (!episode) throw new Error('expected episode');
    addFactEvidence({
      factId: fact.id,
      episodeId: episode.id,
      messageId: 'message-old',
      quote: privateValue,
      now: 400,
    });
    await getEmbeddingCached('rollback cache entry', DEFAULT_LOCAL_EMBEDDING_CONFIG);
    getMemoryDb().execSync(`
      CREATE TRIGGER reject_withdrawal_fact_tombstone
      BEFORE UPDATE OF deleted_at ON memory_facts
      WHEN OLD.id = '${fact.id}' AND OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
      BEGIN
        SELECT RAISE(ABORT, 'forced private rollback detail');
      END;
    `);

    const result = forgetMemoryFactForManagement({ factId: fact.id });

    expect(result).toEqual({
      ok: false,
      code: 'internal',
      error: 'Memory withdrawal failed.',
    });
    expect(JSON.stringify(result)).not.toContain('forced private rollback detail');
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_facts WHERE id = ?',
        fact.id,
      )?.count,
    ).toBe(1);
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_episodes WHERE id = ?',
        episode.id,
      )?.count,
    ).toBe(1);
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_fact_evidence WHERE fact_id = ?',
        fact.id,
      )?.count,
    ).toBe(1);
    expect(retirementLedgerCounts()).toEqual({
      groups: 0,
      requests: 0,
      sources: 0,
      contributions: 0,
      facts: 0,
    });
    expect(clearEmbeddingCache()).toBe(1);
  });

  it('rolls retirement and lineage cleanup back when physical payload deletion fails', async () => {
    const fact = recordScopedFact('PRIVATE-PURGE-ROLLBACK-SENTINEL');
    const contribution = getMemoryDb().getFirstSync<{ id: string }>(
      'SELECT id FROM memory_fact_contributions WHERE fact_id = ? LIMIT 1',
      fact.id,
    );
    if (!contribution) throw new Error('expected contribution');
    await getEmbeddingCached('purge rollback cache entry', DEFAULT_LOCAL_EMBEDDING_CONFIG);
    getMemoryDb().execSync(`
      CREATE TRIGGER reject_retired_payload_delete
      BEFORE DELETE ON memory_fact_contributions
      WHEN OLD.id = '${contribution.id}'
      BEGIN
        SELECT RAISE(ABORT, 'forced private purge rollback detail');
      END;
    `);

    const result = forgetMemoryFactForManagement({ factId: fact.id });

    expect(result).toEqual({
      ok: false,
      code: 'internal',
      error: 'Memory withdrawal failed.',
    });
    expect(JSON.stringify(result)).not.toContain('forced private purge rollback detail');
    expect(
      getMemoryDb().getFirstSync<{ object_text: string }>(
        'SELECT object_text FROM memory_facts WHERE id = ?',
        fact.id,
      )?.object_text,
    ).toBe('PRIVATE-PURGE-ROLLBACK-SENTINEL');
    expect(
      getMemoryDb().getFirstSync<{ id: string }>(
        'SELECT id FROM memory_fact_contributions WHERE id = ?',
        contribution.id,
      )?.id,
    ).toBe(contribution.id);
    expect(retirementLedgerCounts()).toEqual({
      groups: 0,
      requests: 0,
      sources: 0,
      contributions: 0,
      facts: 0,
    });
    expect(clearEmbeddingCache()).toBe(1);
  });

  it('preserves independently scoped working state while deleting exact linked memory', () => {
    editPromptEligibleWorkingBlock(
      'active_focus',
      'independent working focus',
      { conversationId: 'independent-conversation', threadId: 'independent-thread' },
      { now: 200 },
    );
    const entity = upsertEntity({ name: 'global-user', type: 'self', now: 100 });
    const fact = recordContributionBackedFact(
      {
        subjectId: entity.id,
        predicate: 'private_global',
        objectText: 'private global value',
        scope: 'global',
        sourceMessageId: 'global-message',
        sourceTurnId: 'global-turn',
        supersedePrior: false,
        now: 300,
      },
      {
        memoryConversationId: 'global-conversation',
        sourceThreadId: 'global-thread',
        producerEventId: 'withdrawal-guard-global',
      },
    ).fact;
    const episode = recordThreadLocalEpisode({
      summary: 'private global episode',
      messageIds: ['global-message'],
      sourceStartMessageId: 'global-message',
      sourceEndMessageId: 'global-turn',
      now: 301,
    });
    if (!episode) throw new Error('expected global episode');
    const evidence = addFactEvidence({
      factId: fact.id,
      episodeId: episode.id,
      messageId: 'global-message',
      quote: 'private global evidence',
      now: 302,
    });
    if (!evidence) throw new Error('expected global evidence');

    const result = withdrawMemoryFact(fact.id, 400);

    expect(result.status).toBe('withdrawn');
    if (result.status !== 'withdrawn') throw new Error('expected withdrawal');
    expect(result.receipt.counts).toEqual(
      expect.objectContaining({ facts: 1, factEvidence: 1, episodes: 1 }),
    );
    expect(
      getWorkingBlock('active_focus', {
        conversationId: 'independent-conversation',
        threadId: 'independent-thread',
      })?.content,
    ).toBe('independent working focus');
    expect(
      getMemoryDb().getFirstSync('SELECT id FROM memory_facts WHERE id = ?', fact.id),
    ).toBeNull();
    expect(
      getMemoryDb().getFirstSync('SELECT id FROM memory_episodes WHERE id = ?', episode.id),
    ).toBeNull();
    expect(
      getMemoryDb().getFirstSync('SELECT id FROM memory_fact_evidence WHERE id = ?', evidence.id),
    ).toBeNull();
  });

  it('allows a new assertion with a new source after withdrawal', () => {
    const privateValue = 'value may be asserted again';
    const oldFact = recordScopedFact(privateValue, 'message-old');
    expect(withdrawMemoryFact(oldFact.id, 1_000).status).toBe('withdrawn');

    const newEntity = upsertEntity({ name: 'withdrawal-user', type: 'self', now: 1_100 });
    const next = recordContributionBackedFact(
      {
        subjectId: newEntity.id,
        predicate: 'private_value',
        objectText: privateValue,
        scope: 'session',
        originConversationId: 'conversation-1',
        originThreadId: 'thread-1',
        originTaskId: 'task-1',
        sourceMessageId: 'message-new',
        sourceTurnId: 'turn-new',
        sourceRunId: 'run-new',
        supersedePrior: false,
        now: 1_200,
      },
      {
        memoryConversationId: 'conversation-1',
        sourceThreadId: 'thread-1',
        taskId: 'task-1',
        producerEventId: 'withdrawal-guard-new-assertion',
      },
    );

    expect(next.status).toBe('created');
    expect(next.fact.id).not.toBe(oldFact.id);
    expect(next.fact.objectText).toBe(privateValue);
    expect(
      getMemoryDb().getFirstSync<{ count: number }>(
        `SELECT COUNT(*) AS count FROM memory_retired_sources
          WHERE source_kind = 'message' AND source_id = 'message-new'`,
      )?.count,
    ).toBe(0);
  });

  it('audits exported evidence from the affected scope independently of source filters', () => {
    const entity = upsertEntity({ name: 'scoped-export-user', type: 'self', now: 100 });
    const fact = recordContributionBackedFact(
      {
        subjectId: entity.id,
        predicate: 'scoped_export_value',
        objectText: 'scoped private value',
        scope: 'session',
        originConversationId: 'conversation-scoped-export',
        originThreadId: 'thread-scoped-export',
        originTaskId: 'task-scoped-export',
        sourceMessageId: 'message-scoped-export',
        sourceTurnId: 'turn-scoped-export',
        supersedePrior: false,
        now: 200,
      },
      {
        memoryConversationId: 'conversation-scoped-export',
        sourceThreadId: 'thread-scoped-export',
        taskId: 'task-scoped-export',
        producerEventId: 'withdrawal-guard-scoped-export',
      },
    ).fact;
    const probe = probeMemoryWithdrawalResiduals(getMemoryDb(), {
      factIds: [fact.id],
      retrievalTermStats: [],
      evidenceIds: [],
      observationIds: [],
      verifiedProcedureObservationIds: [],
      episodeIds: [],
      reflectionIds: [],
      workingBlocks: [],
      entityIds: [],
      ingestionJobIds: [],
      ingestionReceiptJobIds: [],
      affectedScopes: [
        {
          memoryConversationId: 'conversation-scoped-export',
          sourceThreadId: 'thread-scoped-export',
          taskId: 'task-scoped-export',
        },
      ],
      sources: [],
      checkEmbeddingCache: false,
    });

    expect(probe.counts.exports).toBe(1);
    expect(withdrawMemoryFact(fact.id, 300).status).toBe('withdrawn');
  });

  it('reports orphan and zero retrieval-term stats as an explicit residual surface', () => {
    getMemoryDb().runSync(
      `INSERT INTO memory_fact_term_stats(unit, memory_kind, fact_count, total_weight)
       VALUES ('orphan-unit', 'semantic_fact', 1, 1)`,
    );
    getMemoryDb().runSync(
      `INSERT INTO memory_fact_term_stats(unit, memory_kind, fact_count, total_weight)
       VALUES ('zero-unit', 'semantic_fact', 0, 0)`,
    );

    const probe = probeMemoryWithdrawalResiduals(getMemoryDb(), {
      factIds: [],
      retrievalTermStats: [],
      evidenceIds: [],
      observationIds: [],
      verifiedProcedureObservationIds: [],
      episodeIds: [],
      reflectionIds: [],
      workingBlocks: [],
      entityIds: [],
      ingestionJobIds: [],
      ingestionReceiptJobIds: [],
      affectedScopes: [],
      sources: [],
      auditAllRetrievalTermStats: true,
    });

    expect(probe.status).toBe('residual');
    expect(probe.counts.retrievalTermStats).toBe(2);
  });

  it('does not let unrelated retrieval-term corruption block an exact withdrawal', () => {
    const fact = recordScopedFact('targeted term-stat guard');
    getMemoryDb().runSync(
      `INSERT INTO memory_fact_term_stats(unit, memory_kind, fact_count, total_weight)
       VALUES ('unrelated-orphan-unit', 'semantic_fact', 1, 1)`,
    );

    expect(withdrawMemoryFact(fact.id, 2_000).status).toBe('withdrawn');
    expect(
      getMemoryDb().getFirstSync<{ fact_count: number }>(
        `SELECT fact_count FROM memory_fact_term_stats
          WHERE unit = 'unrelated-orphan-unit' AND memory_kind = 'semantic_fact'`,
      )?.fact_count,
    ).toBe(1);
  });

  it('rolls back when an affected retrieval-term aggregate cannot be reconciled', () => {
    const fact = recordScopedFact('targeted aggregate corruption');
    const term = getMemoryDb().getFirstSync<{ unit: string; memory_kind: string }>(
      'SELECT unit, memory_kind FROM memory_fact_terms WHERE fact_id = ? LIMIT 1',
      fact.id,
    );
    if (!term) throw new Error('expected indexed term');
    getMemoryDb().runSync(
      `UPDATE memory_fact_term_stats SET fact_count = fact_count + 1
        WHERE unit = ? AND memory_kind = ?`,
      term.unit,
      term.memory_kind,
    );

    expect(() => withdrawMemoryFact(fact.id, 2_100)).toThrow(
      'memory_source_retirement_retrieval_stat_invalid',
    );
    expect(
      getMemoryDb().getFirstSync<{ present: number }>(
        'SELECT 1 AS present FROM memory_facts WHERE id = ?',
        fact.id,
      ),
    ).toEqual({ present: 1 });
    expect(retirementLedgerCounts()).toEqual({
      groups: 0,
      requests: 0,
      sources: 0,
      contributions: 0,
      facts: 0,
    });
  });
});
