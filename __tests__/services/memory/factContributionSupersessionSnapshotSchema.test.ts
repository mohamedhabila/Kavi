jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/database';
import { upsertEntity } from '../../../src/services/memory/entities';
import { assertFactContributionAdmissionIntegrity } from '../../../src/services/memory/factContributionAdmissionIntegrity';
import { recordCodeOwnedTestFactWithContribution as recordFactWithContribution } from '../../helpers/factContributionWriteFixtures';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { resetCanonicalMemoryForManagement } from '../../../src/services/memory/memoryReset';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
});

afterEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
});

function createContributedFact(input: {
  subjectId: string;
  objectText: string;
  messageId: string;
  eventId: string;
  now: number;
  pinned?: boolean;
  reviewState?: 'auto' | 'verified';
  supersedePrior?: boolean;
}) {
  return recordFactWithContribution(
    {
      subjectId: input.subjectId,
      predicate: 'favorite_color',
      objectText: input.objectText,
      scope: 'global',
      sourceMessageId: input.messageId,
      pinned: input.pinned,
      reviewState: input.reviewState,
      supersedePrior: input.supersedePrior,
      now: input.now,
    },
    { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
    {
      memoryConversationId: 'conversation-1',
      sourceThreadId: 'thread-1',
      producer: { producerId: 'snapshot_schema_test', producerEventId: input.eventId },
      sourceAliases: [{ sourceKind: 'message', sourceId: input.messageId }],
    },
  ).fact;
}

function contributionIdForFact(factId: string): string {
  const row = getMemoryDb().getFirstSync<{ id: string }>(
    'SELECT id FROM memory_fact_contributions WHERE fact_id = ? LIMIT 1',
    factId,
  );
  if (!row) throw new Error('test_contribution_missing');
  return row.id;
}

describe('fact contribution supersession snapshot schema', () => {
  it('uses one strict normalized snapshot header and flag-free predecessor edges', () => {
    const db = getMemoryDb();
    expect(
      db
        .getAllSync<{ name: string }>('PRAGMA table_info(memory_fact_contribution_supersessions)')
        .map((column) => column.name),
    ).toEqual(['contribution_id', 'predecessor_fact_id', 'successor_fact_id', 'superseded_at']);
    expect(
      db
        .getAllSync<{
          name: string;
        }>('PRAGMA table_info(memory_fact_contribution_supersession_snapshots)')
        .map((column) => column.name),
    ).toEqual([
      'contribution_id',
      'successor_fact_id',
      'superseded_at',
      'snapshot_version',
      'pinned_input_explicit',
      'review_state_input_explicit',
      'successor_pinned_baseline',
      'successor_review_state_baseline',
      'successor_sensitivity_floor',
      'successor_sensitivity_policy_version',
    ]);
    expect(
      db.getFirstSync<{ sql: string }>(
        `SELECT sql FROM sqlite_master
          WHERE type = 'table'
            AND name = 'memory_fact_contribution_supersession_snapshots'`,
      )?.sql,
    ).toContain('WITHOUT ROWID');
  });

  it('creates one sealed product aggregate and rejects child mutation', () => {
    const subject = upsertEntity({ type: 'self', name: 'user', now: 50 });
    const firstPredecessor = createContributedFact({
      subjectId: subject.id,
      objectText: 'blue',
      messageId: 'message-1',
      eventId: 'event-1',
      now: 100,
    });
    const secondPredecessor = createContributedFact({
      subjectId: subject.id,
      objectText: 'red',
      messageId: 'message-2',
      eventId: 'event-2',
      now: 110,
    });
    const successor = createContributedFact({
      subjectId: subject.id,
      objectText: 'green',
      messageId: 'message-3',
      eventId: 'event-3',
      now: 200,
      pinned: true,
      reviewState: 'verified',
      supersedePrior: true,
    });
    const db = getMemoryDb();
    const contributionId = contributionIdForFact(successor.id);

    expect(
      db.getFirstSync(
        `SELECT supersession_set_version, supersession_set_count,
                supersession_set_sha256
           FROM memory_fact_contributions
          WHERE id = ?`,
        contributionId,
      ),
    ).toEqual({
      supersession_set_version: 1,
      supersession_set_count: 3,
      supersession_set_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(
      db.getFirstSync(
        `SELECT successor_fact_id, superseded_at, snapshot_version,
                pinned_input_explicit, review_state_input_explicit,
                successor_pinned_baseline, successor_review_state_baseline,
                successor_sensitivity_floor
           FROM memory_fact_contribution_supersession_snapshots
          WHERE contribution_id = ?`,
        contributionId,
      ),
    ).toEqual({
      successor_fact_id: successor.id,
      superseded_at: 200,
      snapshot_version: 1,
      pinned_input_explicit: 1,
      review_state_input_explicit: 1,
      successor_pinned_baseline: 1,
      successor_review_state_baseline: 'verified',
      successor_sensitivity_floor: successor.sensitivity,
    });
    expect(
      db.getAllSync(
        `SELECT predecessor_fact_id, successor_fact_id, superseded_at
           FROM memory_fact_contribution_supersessions
          WHERE contribution_id = ?
          ORDER BY predecessor_fact_id ASC`,
        contributionId,
      ),
    ).toEqual(
      [firstPredecessor.id, secondPredecessor.id].sort().map((predecessorFactId) => ({
        predecessor_fact_id: predecessorFactId,
        successor_fact_id: successor.id,
        superseded_at: 200,
      })),
    );
    expect(() => assertFactContributionAdmissionIntegrity(db)).not.toThrow();
    expect(() =>
      db.runSync(
        `UPDATE memory_fact_contribution_supersession_snapshots
            SET successor_pinned_baseline = 0
          WHERE contribution_id = ?`,
        contributionId,
      ),
    ).toThrow('memory_fact_contribution_supersession_snapshot_immutable');
    expect(() =>
      db.runSync(
        `UPDATE memory_fact_contribution_supersessions
            SET superseded_at = superseded_at + 1
          WHERE contribution_id = ?`,
        contributionId,
      ),
    ).toThrow('memory_fact_contribution_supersession_immutable');
    expect(() =>
      db.runSync(
        `DELETE FROM memory_fact_contribution_supersessions
          WHERE contribution_id = ? AND predecessor_fact_id = ?`,
        contributionId,
        firstPredecessor.id,
      ),
    ).toThrow('memory_fact_contribution_supersession_immutable');
  });

  it('guards committed predecessors until successor teardown removes the aggregate', () => {
    const subject = upsertEntity({ type: 'self', name: 'user', now: 50 });
    const predecessor = createContributedFact({
      subjectId: subject.id,
      objectText: 'blue',
      messageId: 'message-teardown-predecessor',
      eventId: 'event-teardown-predecessor',
      now: 100,
    });
    const successor = createContributedFact({
      subjectId: subject.id,
      objectText: 'green',
      messageId: 'message-teardown-successor',
      eventId: 'event-teardown-successor',
      now: 200,
      supersedePrior: true,
    });
    const db = getMemoryDb();
    const contributionId = contributionIdForFact(successor.id);

    expect(() => db.runSync('DELETE FROM memory_facts WHERE id = ?', predecessor.id)).toThrow(
      'memory_fact_delete_not_authorized',
    );
    expect(
      db.getFirstSync('SELECT id FROM memory_facts WHERE id = ?', predecessor.id),
    ).not.toBeNull();

    expect(() => db.runSync('DELETE FROM memory_facts WHERE id = ?', successor.id)).toThrow(
      'memory_fact_delete_not_authorized',
    );
    resetCanonicalMemoryForManagement();
    expect(
      db.getFirstSync<{ count: number }>(
        `SELECT COUNT(*) AS count
           FROM memory_fact_contribution_supersession_snapshots
          WHERE contribution_id = ?`,
        contributionId,
      )?.count,
    ).toBe(0);
    expect(
      db.getFirstSync<{ count: number }>(
        `SELECT COUNT(*) AS count
           FROM memory_fact_contribution_supersessions
          WHERE contribution_id = ?`,
        contributionId,
      )?.count,
    ).toBe(0);
    expect(
      db.getFirstSync<{ count: number }>(
        'SELECT COUNT(*) AS count FROM memory_fact_contributions WHERE id = ?',
        contributionId,
      )?.count,
    ).toBe(0);

    expect(db.getFirstSync('SELECT id FROM memory_facts WHERE id = ?', predecessor.id)).toBeNull();
    expect(() => assertFactContributionAdmissionIntegrity(db)).not.toThrow();
  });

  it('fails admission while a snapshot has no exact predecessor edge', () => {
    const subject = upsertEntity({ type: 'self', name: 'user', now: 50 });
    const firstPredecessor = createContributedFact({
      subjectId: subject.id,
      objectText: 'blue',
      messageId: 'message-orphan-1',
      eventId: 'event-orphan-1',
      now: 100,
    });
    createContributedFact({
      subjectId: subject.id,
      objectText: 'red',
      messageId: 'message-orphan-2',
      eventId: 'event-orphan-2',
      now: 110,
    });
    const successor = createContributedFact({
      subjectId: subject.id,
      objectText: 'green',
      messageId: 'message-orphan-3',
      eventId: 'event-orphan-3',
      now: 200,
      supersedePrior: true,
    });
    const db = getMemoryDb();
    const contributionId = contributionIdForFact(successor.id);
    db.execSync(
      'DROP TRIGGER IF EXISTS trg_memory_fact_contribution_supersession_delete_immutable;',
    );
    db.runSync(
      `DELETE FROM memory_fact_contribution_supersessions
        WHERE contribution_id = ? AND predecessor_fact_id = ?`,
      contributionId,
      firstPredecessor.id,
    );

    expect(
      db.getFirstSync<{ count: number }>(
        `SELECT COUNT(*) AS count
           FROM memory_fact_contribution_supersession_snapshots
          WHERE contribution_id = ?`,
        contributionId,
      )?.count,
    ).toBe(1);
    expect(
      db.getFirstSync<{ count: number }>(
        `SELECT COUNT(*) AS count
           FROM memory_fact_contribution_supersessions
          WHERE contribution_id = ?`,
        contributionId,
      )?.count,
    ).toBe(1);

    expect(() => assertFactContributionAdmissionIntegrity(db)).toThrow(
      'memory_fact_contribution_admission_integrity_invalid',
    );
  });
});
