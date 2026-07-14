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
import { recordFactWithApplicability } from '../../../src/services/memory/facts/mutations';
import type { FactRow, MemoryFact } from '../../../src/services/memory/facts/types';
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
    operation: { kind: 'record' },
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
  sourceSetVersion?: number;
  sourceSetCount?: number;
  sourceSetSha256?: string;
  supersessionSetVersion?: number;
  supersessionSetCount?: number;
  supersessionSetSha256?: string;
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
       producer_id, producer_event_id, source_set_version, source_set_count, source_set_sha256,
       supersession_set_version, supersession_set_count, supersession_set_sha256,
       payload_version, payload_json, payload_sha256, payload_byte_length, contributed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.factId,
    scope.memoryOwnerId,
    scope.memoryConversationId,
    scope.sourceThreadId,
    scope.taskId,
    input.producer.producerId,
    input.producer.producerEventId,
    input.sourceSetVersion ?? 1,
    input.sourceSetCount ?? 1,
    input.sourceSetSha256 ?? '1'.repeat(64),
    input.supersessionSetVersion ?? 1,
    input.supersessionSetCount ?? 0,
    input.supersessionSetSha256 ?? '2'.repeat(64),
    encoded.payloadVersion,
    encoded.payloadJson,
    encoded.payloadSha256,
    encoded.payloadByteLength,
    100,
  );
  return { db, encoded, id, inserted, scope };
}

function insertSupersessionSnapshot(contributionId: string, successor: MemoryFact): void {
  const db = getMemoryDb();
  const row = db.getFirstSync<FactRow>(
    'SELECT * FROM memory_facts WHERE id = ? LIMIT 1',
    successor.id,
  );
  if (!row) throw new Error('test_successor_missing');
  db.runSync(
    `INSERT INTO memory_fact_contribution_supersession_snapshots(
       contribution_id, successor_fact_id, superseded_at, snapshot_version,
       pinned_input_explicit, review_state_input_explicit, successor_pinned_baseline,
       successor_review_state_baseline, successor_sensitivity_floor,
       successor_sensitivity_policy_version
     ) VALUES (?, ?, ?, 1, 0, 0, ?, ?, ?, ?)`,
    contributionId,
    successor.id,
    successor.createdAt,
    row.pinned,
    row.review_state,
    row.sensitivity,
    row.sensitivity_policy_version,
  );
}

describe('fact contribution schema', () => {
  it.each([
    ['legacy', ''],
    ['partial', ', source_set_version INTEGER NOT NULL'],
  ])('requires an explicit structured reset for a %s parent shape', (_shape, extraColumn) => {
    const db = getMemoryDb();
    db.execSync(`
      CREATE TABLE memory_fact_contributions(
        id TEXT PRIMARY KEY
        ${extraColumn}
      );
    `);

    expect(() => ensureFactSchema()).toThrow('memory_fact_contribution_schema_reset_required');
    expect(() => clearStructuredMemory()).not.toThrow();
    const columns = db
      .getAllSync<{ name: string }>('PRAGMA table_info(memory_fact_contributions)')
      .map((column) => column.name);
    expect(columns.filter((column) => column.includes('_set_'))).toEqual([
      'source_set_version',
      'source_set_count',
      'source_set_sha256',
      'supersession_set_version',
      'supersession_set_count',
      'supersession_set_sha256',
    ]);
  });

  it('requires bounded immutable child-set commitments on every parent', () => {
    ensureFactSchema();
    const fact = createFact('blue');
    const columns = getMemoryDb()
      .getAllSync<{ name: string }>('PRAGMA table_info(memory_fact_contributions)')
      .map((column) => column.name);
    expect(columns.slice(8, 14)).toEqual([
      'source_set_version',
      'source_set_count',
      'source_set_sha256',
      'supersession_set_version',
      'supersession_set_count',
      'supersession_set_sha256',
    ]);

    const invalidCommitments = [
      { sourceSetVersion: 2 },
      { sourceSetCount: 0 },
      { sourceSetCount: 65 },
      { sourceSetCount: 1.5 },
      { sourceSetSha256: 'A'.repeat(64) },
      { supersessionSetVersion: 2 },
      { supersessionSetCount: 1 },
      { supersessionSetCount: 258 },
      { supersessionSetCount: 2.5 },
      { supersessionSetSha256: 'G'.repeat(64) },
    ];
    for (const [index, commitments] of invalidCommitments.entries()) {
      expect(() =>
        insertContribution({
          factId: fact.id,
          subjectId: fact.subjectId,
          objectText: fact.objectText,
          producer: {
            producerId: 'commitment_schema',
            producerEventId: `invalid-${index}`,
          },
          ...commitments,
        }),
      ).toThrow();
    }

    const noSupersession = insertContribution({
      factId: fact.id,
      subjectId: fact.subjectId,
      objectText: fact.objectText,
      producer: { producerId: 'commitment_schema', producerEventId: 'no-supersession' },
    });
    expect(() => insertSupersessionSnapshot(noSupersession.id, fact)).toThrow(
      'memory_fact_contribution_supersession_snapshot_parent_invalid',
    );
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
      sourceSetCount: 3,
    });
    expect(first.inserted.changes).toBe(1);
    expect(() =>
      insertContribution({
        factId: fact.id,
        subjectId: fact.subjectId,
        objectText: fact.objectText,
        producer,
        sourceSetCount: 3,
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
           producer_id, producer_event_id, source_set_version, source_set_count,
           source_set_sha256, supersession_set_version, supersession_set_count,
           supersession_set_sha256, payload_version, payload_json, payload_sha256,
           payload_byte_length, contributed_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'turn_structural', 'assistant-message:uppercase-sha',
                   1, 1, ?, 1, 0, ?, ?, ?, ?, ?, 100)`,
        uppercaseShaId,
        fact.id,
        first.scope.memoryOwnerId,
        first.scope.memoryConversationId,
        first.scope.sourceThreadId,
        first.scope.taskId,
        '1'.repeat(64),
        '2'.repeat(64),
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
        `INSERT INTO memory_fact_contribution_sources(
           contribution_id, memory_owner_id, memory_conversation_id, source_thread_id,
           task_id, source_kind, source_id
         ) VALUES (?, ?, ?, ?, ?, 'message', 'source-overflow')`,
        first.id,
        first.scope.memoryOwnerId,
        first.scope.memoryConversationId,
        first.scope.sourceThreadId,
        first.scope.taskId,
      ),
    ).toThrow('memory_fact_contribution_source_count_exceeded');
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
           producer_id, producer_event_id, source_set_version, source_set_count,
           source_set_sha256, supersession_set_version, supersession_set_count,
           supersession_set_sha256, payload_version, payload_json, payload_sha256,
           payload_byte_length, contributed_at
         ) SELECT id, fact_id, memory_owner_id, memory_conversation_id, source_thread_id, task_id,
                  producer_id, producer_event_id, source_set_version, source_set_count,
                  source_set_sha256, supersession_set_version, supersession_set_count,
                  supersession_set_sha256, payload_version, payload_json, payload_sha256,
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

  it('owns supersession edges and deletes all ledger dependents with their fact', () => {
    ensureFactSchema();
    const predecessor = createFact('blue');
    const successor = createFact('green');
    const contribution = insertContribution({
      factId: successor.id,
      subjectId: successor.subjectId,
      objectText: successor.objectText,
      producer: { producerId: 'memory_tool', producerEventId: 'tool-call-1' },
      supersessionSetCount: 3,
    });
    insertSupersessionSnapshot(contribution.id, successor);
    const crossOwner = createFact('red');
    const crossPredicate = createFact('yellow');
    const crossScope = createFact('purple');
    const differentMemoryKind = createFact('orange');
    const overflowPredecessor = createFact('black');
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
      'UPDATE memory_facts SET invalid_at = 100, updated_at = 100 WHERE id IN (?, ?, ?)',
      differentMemoryKind.id,
      predecessor.id,
      overflowPredecessor.id,
    );
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
    expect(() =>
      contribution.db.runSync(
        `INSERT INTO memory_fact_contribution_supersessions(
           contribution_id, predecessor_fact_id, successor_fact_id, superseded_at
         ) VALUES (?, ?, ?, 100)`,
        contribution.id,
        overflowPredecessor.id,
        successor.id,
      ),
    ).toThrow('memory_fact_contribution_supersession_parent_invalid');
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
    expect(
      contribution.db.getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_fact_contribution_supersession_snapshots',
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
      'memory_fact_contribution_supersession_snapshots',
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

  it('protects a committed predecessor until its live successor parent is torn down', () => {
    ensureFactSchema();
    const predecessor = createFact('blue');
    const successor = createFact('green');
    const contribution = insertContribution({
      factId: successor.id,
      subjectId: successor.subjectId,
      objectText: successor.objectText,
      producer: { producerId: 'memory_tool', producerEventId: 'predecessor-delete' },
      supersessionSetCount: 2,
    });
    insertSupersessionSnapshot(contribution.id, successor);
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
      'UPDATE memory_facts SET invalid_at = 101, updated_at = 101 WHERE id = ?',
      successor.id,
    );

    expect(() =>
      contribution.db.runSync('DELETE FROM memory_facts WHERE id = ?', predecessor.id),
    ).toThrow('memory_fact_contribution_predecessor_delete_committed');

    expect(
      contribution.db.getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_fact_contribution_supersessions',
      )?.count,
    ).toBe(1);
    expect(
      contribution.db.getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_fact_contributions',
      )?.count,
    ).toBe(1);

    contribution.db.runSync('DELETE FROM memory_facts WHERE id = ?', successor.id);
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
    ).toBe(0);
  });

  it('allows an explicit successor teardown before deleting its predecessor', () => {
    ensureFactSchema();
    const predecessor = createFact('blue');
    const successor = createFact('green');
    const contribution = insertContribution({
      factId: successor.id,
      subjectId: successor.subjectId,
      objectText: successor.objectText,
      producer: { producerId: 'memory_tool', producerEventId: 'pair-delete' },
      supersessionSetCount: 2,
    });
    insertSupersessionSnapshot(contribution.id, successor);
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

    contribution.db.runSync('DELETE FROM memory_facts WHERE id = ?', successor.id);
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
    ).toBe(0);
  });
});
