jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { upsertEntity } from '../../../src/services/memory/entities';
import {
  buildMemoryFactContributionId,
  encodeMemoryFactContributionPayload,
  normalizeMemoryFactContributionSourceScope,
  type MemoryFactContributionPayloadV1,
  type MemoryFactContributionProducerIdentity,
} from '../../../src/services/memory/factContributionCodec';
import { persistFactContributionSupersessionsInTransaction } from '../../../src/services/memory/factContributionStore';
import { recordFactWithApplicability } from '../../../src/services/memory/facts/mutations';
import { getLocalMemoryVaultOwnerId } from '../../../src/services/memory/memoryVaultIdentity';
import {
  clearStructuredMemory,
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
  expoSqlite.__resetExpoSqliteForTests();
});

function createFact(objectText: string) {
  const subject = upsertEntity({ type: 'self', name: 'user', now: 100 });
  return recordFactWithApplicability(
    {
      subjectId: subject.id,
      predicate: 'favorite_color',
      objectText,
      scope: 'global',
      sourceMessageId: 'user-message',
      sourceTurnId: 'assistant-message',
      now: 100,
    },
    { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
  ).fact;
}

function contributionPayload(
  subjectId: string,
  objectText: string,
): MemoryFactContributionPayloadV1 {
  return {
    version: 1,
    applicability: {
      factClass: 'subjective_user',
      sourceAuthority: 'grounded_user',
      personaId: null,
    },
    input: {
      subjectId,
      predicate: 'favorite_color',
      objectText,
      objectEntityId: null,
      attributes: {},
      confidence: 1,
      sourceMessageId: 'user-message',
      sourceRunId: 'run-1',
      scope: 'global',
      originConversationId: null,
      originThreadId: null,
      originTaskId: null,
      sourceTurnId: 'assistant-message',
      sourceSummary: null,
      importance: 0.5,
      decayPolicy: 'normal',
      expiresAt: null,
      validAt: 100,
      pinned: false,
      sourceActorId: null,
      retrievability: 1,
      stability: 0.5,
      decayRate: 0.03,
      reviewState: 'auto',
      memoryKind: 'semantic_fact',
      supersedePrior: false,
      now: 100,
    },
  };
}

function insertContribution(input: {
  factId: string;
  subjectId: string;
  objectText: string;
  producer: MemoryFactContributionProducerIdentity;
}) {
  const db = getMemoryDb();
  const scope = normalizeMemoryFactContributionSourceScope({
    memoryOwnerId: getLocalMemoryVaultOwnerId(db),
    memoryConversationId: 'conversation-1',
    sourceThreadId: 'thread-1',
    taskId: null,
  });
  const id = buildMemoryFactContributionId({
    scope,
    producer: input.producer,
  });
  const encoded = encodeMemoryFactContributionPayload(
    contributionPayload(input.subjectId, input.objectText),
  );
  const inserted = db.runSync(
    `INSERT INTO memory_fact_contributions(
       id, fact_id, memory_owner_id, memory_conversation_id, source_thread_id, task_id,
       producer_id, producer_event_id, payload_version, payload_json, payload_sha256,
       payload_byte_length, contributed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.factId,
    scope.memoryOwnerId,
    scope.memoryConversationId,
    scope.sourceThreadId,
    scope.taskId,
    input.producer.producerId,
    input.producer.producerEventId,
    encoded.payloadVersion,
    encoded.payloadJson,
    encoded.payloadSha256,
    encoded.payloadByteLength,
    100,
  );
  return { db, encoded, id, inserted, scope };
}

describe('fact contribution schema', () => {
  it('adds projection-intent columns to an existing supersession ledger', () => {
    const db = getMemoryDb();
    db.execSync(`
      CREATE TABLE memory_fact_contribution_supersessions (
        contribution_id TEXT NOT NULL,
        predecessor_fact_id TEXT NOT NULL,
        successor_fact_id TEXT NOT NULL,
        superseded_at INTEGER NOT NULL,
        PRIMARY KEY(contribution_id, predecessor_fact_id, successor_fact_id)
      );
    `);

    ensureFactSchema();
    resetFactSchemaCacheForTests();
    ensureFactSchema();

    expect(
      db
        .getAllSync<{
          name: string;
          notnull: number;
          dflt_value: string | null;
        }>('PRAGMA table_info(memory_fact_contribution_supersessions)')
        .filter((column) => column.name.endsWith('_input_explicit'))
        .map(({ name, notnull, dflt_value }) => ({ name, notnull, dflt_value })),
    ).toEqual([
      { name: 'pinned_input_explicit', notnull: 1, dflt_value: '0' },
      { name: 'review_state_input_explicit', notnull: 1, dflt_value: '0' },
    ]);
  });

  it('persists one immutable idempotent contribution with multiple exact source aliases', () => {
    ensureFactSchema();
    const fact = createFact('blue');
    const producer = { producerId: 'turn_structural', producerEventId: 'assistant-message:0' };
    const first = insertContribution({
      factId: fact.id,
      subjectId: fact.subjectId,
      objectText: fact.objectText,
      producer,
    });
    expect(first.inserted.changes).toBe(1);
    expect(() =>
      insertContribution({
        factId: fact.id,
        subjectId: fact.subjectId,
        objectText: fact.objectText,
        producer,
      }),
    ).toThrow('memory_fact_contribution_immutable');
    const uppercaseShaId = buildMemoryFactContributionId({
      scope: first.scope,
      producer: {
        producerId: 'turn_structural',
        producerEventId: 'assistant-message:uppercase-sha',
      },
    });
    expect(() =>
      first.db.runSync(
        `INSERT INTO memory_fact_contributions(
           id, fact_id, memory_owner_id, memory_conversation_id, source_thread_id, task_id,
           producer_id, producer_event_id, payload_version, payload_json, payload_sha256,
           payload_byte_length, contributed_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'turn_structural', 'assistant-message:uppercase-sha',
                   ?, ?, ?, ?, 100)`,
        uppercaseShaId,
        fact.id,
        first.scope.memoryOwnerId,
        first.scope.memoryConversationId,
        first.scope.sourceThreadId,
        first.scope.taskId,
        first.encoded.payloadVersion,
        first.encoded.payloadJson,
        first.encoded.payloadSha256.toUpperCase(),
        first.encoded.payloadByteLength,
      ),
    ).toThrow();

    for (const [sourceKind, sourceId] of [
      ['message', 'user-message'],
      ['turn', 'assistant-message'],
      ['run', 'run-1'],
    ] as const) {
      first.db.runSync(
        `INSERT INTO memory_fact_contribution_sources(
           contribution_id, memory_owner_id, memory_conversation_id, source_thread_id,
           task_id, source_kind, source_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        first.id,
        first.scope.memoryOwnerId,
        first.scope.memoryConversationId,
        first.scope.sourceThreadId,
        first.scope.taskId,
        sourceKind,
        sourceId,
      );
    }

    expect(
      first.db.getAllSync<{ source_kind: string; source_id: string }>(
        `SELECT source_kind, source_id
           FROM memory_fact_contribution_sources
          WHERE memory_owner_id = ? AND memory_conversation_id = ?
            AND source_thread_id = ? AND task_id = ?
          ORDER BY source_kind`,
        first.scope.memoryOwnerId,
        first.scope.memoryConversationId,
        first.scope.sourceThreadId,
        first.scope.taskId,
      ),
    ).toEqual([
      { source_kind: 'message', source_id: 'user-message' },
      { source_kind: 'run', source_id: 'run-1' },
      { source_kind: 'turn', source_id: 'assistant-message' },
    ]);
    expect(() =>
      first.db.runSync(
        `UPDATE memory_fact_contributions SET producer_id = 'changed' WHERE id = ?`,
        first.id,
      ),
    ).toThrow('memory_fact_contribution_immutable');
    expect(() =>
      first.db.runSync(
        `INSERT OR REPLACE INTO memory_fact_contributions(
           id, fact_id, memory_owner_id, memory_conversation_id, source_thread_id, task_id,
           producer_id, producer_event_id, payload_version, payload_json, payload_sha256,
           payload_byte_length, contributed_at
         ) SELECT id, fact_id, memory_owner_id, memory_conversation_id, source_thread_id, task_id,
                  producer_id, producer_event_id, payload_version, payload_json, payload_sha256,
                  payload_byte_length, contributed_at
             FROM memory_fact_contributions
            WHERE id = ?`,
        first.id,
      ),
    ).toThrow('memory_fact_contribution_immutable');
    expect(() =>
      first.db.runSync(
        `INSERT INTO memory_fact_contribution_sources(
           contribution_id, memory_owner_id, memory_conversation_id, source_thread_id,
           task_id, source_kind, source_id
         ) VALUES (?, ?, 'another-conversation', ?, ?, 'message', 'other-message')`,
        first.id,
        first.scope.memoryOwnerId,
        first.scope.sourceThreadId,
        first.scope.taskId,
      ),
    ).toThrow('memory_fact_contribution_source_parent_invalid');
    expect(() =>
      first.db.runSync(
        `INSERT INTO memory_fact_contribution_sources(
           contribution_id, memory_owner_id, memory_conversation_id, source_thread_id,
           task_id, source_kind, source_id
         ) VALUES ('mfc_${'0'.repeat(64)}', ?, ?, ?, ?, 'message', 'orphan-message')`,
        first.scope.memoryOwnerId,
        first.scope.memoryConversationId,
        first.scope.sourceThreadId,
        first.scope.taskId,
      ),
    ).toThrow('memory_fact_contribution_source_parent_invalid');
  });

  it('persists explicit supersession projection intent and verifies exact replay', () => {
    ensureFactSchema();
    const predecessor = createFact('blue');
    const successor = createFact('green');
    const contribution = insertContribution({
      factId: successor.id,
      subjectId: successor.subjectId,
      objectText: successor.objectText,
      producer: { producerId: 'memory_tool', producerEventId: 'projection-intent' },
    });
    contribution.db.runSync(
      'UPDATE memory_facts SET invalid_at = 200, updated_at = 200 WHERE id = ?',
      predecessor.id,
    );
    const edge = {
      contributionId: contribution.id,
      successorFactId: successor.id,
      superseded: [{ id: predecessor.id, invalidAt: 200 }],
      projectionIntent: { pinnedInputExplicit: true, reviewStateInputExplicit: true },
    } as const;

    persistFactContributionSupersessionsInTransaction(edge);
    expect(() => persistFactContributionSupersessionsInTransaction(edge)).not.toThrow();
    expect(
      contribution.db.getFirstSync(
        `SELECT pinned_input_explicit, review_state_input_explicit
           FROM memory_fact_contribution_supersessions
          WHERE contribution_id = ?`,
        contribution.id,
      ),
    ).toEqual({ pinned_input_explicit: 1, review_state_input_explicit: 1 });
    expect(() =>
      persistFactContributionSupersessionsInTransaction({
        ...edge,
        projectionIntent: { pinnedInputExplicit: false, reviewStateInputExplicit: true },
      }),
    ).toThrow('memory_fact_contribution_supersession_replay_mismatch');
    expect(() =>
      persistFactContributionSupersessionsInTransaction({
        ...edge,
        projectionIntent: { pinnedInputExplicit: true } as never,
      }),
    ).toThrow('memory_fact_contribution_supersession_projection_intent_invalid');
    expect(() =>
      persistFactContributionSupersessionsInTransaction({
        ...edge,
        projectionIntent: undefined as never,
      }),
    ).toThrow('memory_fact_contribution_supersession_projection_intent_invalid');
  });

  it('owns supersession edges and deletes all ledger dependents with their fact', () => {
    ensureFactSchema();
    const predecessor = createFact('blue');
    const successor = createFact('green');
    const contribution = insertContribution({
      factId: successor.id,
      subjectId: successor.subjectId,
      objectText: successor.objectText,
      producer: { producerId: 'memory_tool', producerEventId: 'tool-call-1' },
    });
    const crossOwner = createFact('red');
    const crossPredicate = createFact('yellow');
    const crossScope = createFact('purple');
    const differentMemoryKind = createFact('orange');
    contribution.db.runSync(
      "UPDATE memory_facts SET memory_owner_id = 'vault-owner-other' WHERE id = ?",
      crossOwner.id,
    );
    contribution.db.runSync(
      "UPDATE memory_facts SET predicate = 'different_predicate' WHERE id = ?",
      crossPredicate.id,
    );
    contribution.db.runSync(
      `UPDATE memory_facts
          SET scope = 'conversation', origin_conversation_id = 'conversation-1'
        WHERE id = ?`,
      crossScope.id,
    );
    for (const invalidPredecessorId of [crossOwner.id, crossPredicate.id, crossScope.id]) {
      expect(() =>
        contribution.db.runSync(
          `INSERT INTO memory_fact_contribution_supersessions(
             contribution_id, predecessor_fact_id, successor_fact_id, superseded_at
           ) VALUES (?, ?, ?, 100)`,
          contribution.id,
          invalidPredecessorId,
          successor.id,
        ),
      ).toThrow('memory_fact_contribution_supersession_parent_invalid');
    }
    contribution.db.runSync(
      "UPDATE memory_facts SET memory_kind = 'decision' WHERE id = ?",
      differentMemoryKind.id,
    );
    contribution.db.runSync(
      'UPDATE memory_facts SET invalid_at = 100, updated_at = 100 WHERE id IN (?, ?)',
      differentMemoryKind.id,
      predecessor.id,
    );
    for (const [pinnedInputExplicit, reviewStateInputExplicit] of [
      [2, 0],
      [0, -1],
    ]) {
      expect(() =>
        contribution.db.runSync(
          `INSERT INTO memory_fact_contribution_supersessions(
             contribution_id, predecessor_fact_id, successor_fact_id, superseded_at,
             pinned_input_explicit, review_state_input_explicit
           ) VALUES (?, ?, ?, 100, ?, ?)`,
          contribution.id,
          predecessor.id,
          successor.id,
          pinnedInputExplicit,
          reviewStateInputExplicit,
        ),
      ).toThrow();
    }
    contribution.db.runSync(
      `INSERT INTO memory_fact_contribution_supersessions(
         contribution_id, predecessor_fact_id, successor_fact_id, superseded_at
       ) VALUES (?, ?, ?, 100)`,
      contribution.id,
      differentMemoryKind.id,
      successor.id,
    );
    contribution.db.runSync(
      `INSERT INTO memory_fact_contribution_sources(
         contribution_id, memory_owner_id, memory_conversation_id, source_thread_id,
         task_id, source_kind, source_id
       ) VALUES (?, ?, ?, ?, ?, 'message', 'user-message')`,
      contribution.id,
      contribution.scope.memoryOwnerId,
      contribution.scope.memoryConversationId,
      contribution.scope.sourceThreadId,
      contribution.scope.taskId,
    );
    contribution.db.runSync(
      `INSERT INTO memory_fact_contribution_supersessions(
         contribution_id, predecessor_fact_id, successor_fact_id, superseded_at
       ) VALUES (?, ?, ?, 100)`,
      contribution.id,
      predecessor.id,
      successor.id,
    );
    expect(
      contribution.db.getFirstSync(
        `SELECT pinned_input_explicit, review_state_input_explicit
           FROM memory_fact_contribution_supersessions
          WHERE contribution_id = ? AND predecessor_fact_id = ?`,
        contribution.id,
        predecessor.id,
      ),
    ).toEqual({ pinned_input_explicit: 0, review_state_input_explicit: 0 });
    expect(() =>
      contribution.db.runSync(
        `UPDATE memory_fact_contribution_supersessions
            SET pinned_input_explicit = 1
          WHERE contribution_id = ? AND predecessor_fact_id = ?`,
        contribution.id,
        predecessor.id,
      ),
    ).toThrow('memory_fact_contribution_supersession_immutable');

    expect(() =>
      contribution.db.runSync(
        'DELETE FROM memory_fact_contributions WHERE id = ?',
        contribution.id,
      ),
    ).toThrow('memory_fact_contribution_immutable');
    expect(() =>
      contribution.db.runSync(
        `DELETE FROM memory_fact_contribution_sources
          WHERE contribution_id = ? AND source_id = 'user-message'`,
        contribution.id,
      ),
    ).toThrow('memory_fact_contribution_source_immutable');
    expect(() =>
      contribution.db.runSync(
        `DELETE FROM memory_fact_contribution_supersessions
          WHERE contribution_id = ? AND predecessor_fact_id = ?`,
        contribution.id,
        predecessor.id,
      ),
    ).toThrow('memory_fact_contribution_supersession_immutable');

    contribution.db.runSync('DELETE FROM memory_facts WHERE id = ?', successor.id);

    expect(
      contribution.db.getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_fact_contributions',
      )?.count,
    ).toBe(0);
    expect(
      contribution.db.getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_fact_contribution_sources',
      )?.count,
    ).toBe(0);
    expect(
      contribution.db.getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_fact_contribution_supersessions',
      )?.count,
    ).toBe(0);
  });

  it('clears the full contribution ledger while preserving the vault identity', () => {
    ensureFactSchema();
    const fact = createFact('blue');
    const contribution = insertContribution({
      factId: fact.id,
      subjectId: fact.subjectId,
      objectText: fact.objectText,
      producer: { producerId: 'turn_provider', producerEventId: 'assistant-message:0' },
    });
    contribution.db.runSync(
      `INSERT INTO memory_fact_contribution_sources(
         contribution_id, memory_owner_id, memory_conversation_id, source_thread_id,
         task_id, source_kind, source_id
       ) VALUES (?, ?, ?, ?, ?, 'turn', 'assistant-message')`,
      contribution.id,
      contribution.scope.memoryOwnerId,
      contribution.scope.memoryConversationId,
      contribution.scope.sourceThreadId,
      contribution.scope.taskId,
    );
    const ownerId = contribution.scope.memoryOwnerId;

    clearStructuredMemory();

    for (const table of [
      'memory_fact_contribution_supersessions',
      'memory_fact_contribution_sources',
      'memory_fact_contributions',
    ]) {
      expect(
        contribution.db.getFirstSync<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`)
          ?.count,
      ).toBe(0);
    }
    expect(getLocalMemoryVaultOwnerId(contribution.db)).toBe(ownerId);

    const freshFact = createFact('green');
    const freshContribution = insertContribution({
      factId: freshFact.id,
      subjectId: freshFact.subjectId,
      objectText: freshFact.objectText,
      producer: { producerId: 'turn_provider', producerEventId: 'assistant-message:1' },
    });
    expect(() =>
      freshContribution.db.runSync(
        'DELETE FROM memory_fact_contributions WHERE id = ?',
        freshContribution.id,
      ),
    ).toThrow('memory_fact_contribution_immutable');
  });

  it('removes an owned edge when its predecessor fact is deleted', () => {
    ensureFactSchema();
    const predecessor = createFact('blue');
    const successor = createFact('green');
    const contribution = insertContribution({
      factId: successor.id,
      subjectId: successor.subjectId,
      objectText: successor.objectText,
      producer: { producerId: 'memory_tool', producerEventId: 'predecessor-delete' },
    });
    contribution.db.runSync(
      'UPDATE memory_facts SET invalid_at = 100, updated_at = 100 WHERE id = ?',
      predecessor.id,
    );
    contribution.db.runSync(
      `INSERT INTO memory_fact_contribution_supersessions(
         contribution_id, predecessor_fact_id, successor_fact_id, superseded_at
       ) VALUES (?, ?, ?, 100)`,
      contribution.id,
      predecessor.id,
      successor.id,
    );

    contribution.db.runSync('DELETE FROM memory_facts WHERE id = ?', predecessor.id);

    expect(
      contribution.db.getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_fact_contribution_supersessions',
      )?.count,
    ).toBe(0);
    expect(
      contribution.db.getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_fact_contributions',
      )?.count,
    ).toBe(1);
  });

  it('deletes a supersession pair without depending on SQLite row order', () => {
    ensureFactSchema();
    const predecessor = createFact('blue');
    const successor = createFact('green');
    const contribution = insertContribution({
      factId: successor.id,
      subjectId: successor.subjectId,
      objectText: successor.objectText,
      producer: { producerId: 'memory_tool', producerEventId: 'pair-delete' },
    });
    contribution.db.runSync(
      'UPDATE memory_facts SET invalid_at = 100, updated_at = 100 WHERE id = ?',
      predecessor.id,
    );
    contribution.db.runSync(
      `INSERT INTO memory_fact_contribution_supersessions(
         contribution_id, predecessor_fact_id, successor_fact_id, superseded_at
       ) VALUES (?, ?, ?, 100)`,
      contribution.id,
      predecessor.id,
      successor.id,
    );

    contribution.db.runSync(
      'DELETE FROM memory_facts WHERE id IN (?, ?)',
      predecessor.id,
      successor.id,
    );

    expect(
      contribution.db.getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_fact_contribution_supersessions',
      )?.count,
    ).toBe(0);
    expect(
      contribution.db.getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_fact_contributions',
      )?.count,
    ).toBe(0);
  });
});
