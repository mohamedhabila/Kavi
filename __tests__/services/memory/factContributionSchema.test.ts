jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { buildMemoryFactContributionId } from '../../../src/services/memory/factContributionCodec';
import { getLocalMemoryVaultOwnerId } from '../../../src/services/memory/memoryVaultIdentity';
import {
  clearStructuredMemory,
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import {
  createSchemaFact,
  insertSchemaContribution,
  insertSchemaSupersessionSnapshot,
} from '../../helpers/factContributionSchemaFixtures';

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

const createFact = createSchemaFact;
const insertContribution = insertSchemaContribution;
const insertSupersessionSnapshot = insertSchemaSupersessionSnapshot;

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

  it('requires an explicit structured reset for the prior payload version', () => {
    const db = getMemoryDb();
    db.execSync(`
      CREATE TABLE memory_fact_contributions(
        id TEXT PRIMARY KEY,
        source_set_version INTEGER NOT NULL,
        source_set_count INTEGER NOT NULL,
        source_set_sha256 TEXT NOT NULL,
        supersession_set_version INTEGER NOT NULL,
        supersession_set_count INTEGER NOT NULL,
        supersession_set_sha256 TEXT NOT NULL,
        payload_version INTEGER NOT NULL CHECK(payload_version = 1)
      );
    `);

    expect(() => ensureFactSchema()).toThrow('memory_fact_contribution_schema_reset_required');
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

    expect(() =>
      contribution.db.runSync('DELETE FROM memory_facts WHERE id = ?', successor.id),
    ).toThrow('memory_fact_delete_not_authorized');
    clearStructuredMemory();

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
    ).toThrow('memory_fact_delete_not_authorized');

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

    expect(() =>
      contribution.db.runSync('DELETE FROM memory_facts WHERE id = ?', successor.id),
    ).toThrow('memory_fact_delete_not_authorized');
    clearStructuredMemory();

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

  it('requires retirement or privileged cleanup before successor teardown', () => {
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

    expect(() =>
      contribution.db.runSync('DELETE FROM memory_facts WHERE id = ?', successor.id),
    ).toThrow('memory_fact_delete_not_authorized');
    clearStructuredMemory();

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
